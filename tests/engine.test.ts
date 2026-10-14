import assert from 'node:assert/strict';
import test from 'node:test';
import { REGIONS, SPECIES, phasesFor, species, type SpeciesId } from '../src/game/data';
import { abandonSeat, addPlayer, advance, applyCommand, createGame, removePlayer, startGame, tick } from '../src/game/engine';
import { pay, resolveFood } from '../src/game/rules';
import type { Game, Player } from '../src/game/types';
import { PROTOCOL_VERSION, playerView } from '../src/game/view';

const NOW = 1_000_000;

function solo(role: SpeciesId = 'wolf', seed = 123) {
  const g = createGame('TEST01', 'solo', seed, NOW);
  addPlayer(g, 'human', '测试玩家');
  startGame(g, role, NOW);
  return g;
}

function online(names: string[], seed = 5) {
  const g = createGame('ONLINE', 'online', seed, NOW);
  names.forEach(n => addPlayer(g, n, n));
  startGame(g, undefined, NOW);
  return g;
}

function asRole(p: Player, id: SpeciesId) {
  Object.assign(p, { animal: id, hp: species(id).hp, sp: species(id).sp, alive: true });
}

/** Parks everyone in an empty region with no plans, so a test controls exactly who acts. */
function isolate(g: Game) {
  for (const p of g.players) Object.assign(p, { location: 'ruins', food: 'skip', bot: false, target: '' });
}

const cmd = (g: Game, id: string, c: Parameters<typeof applyCommand>[2]) => applyCommand(g, id, c, NOW);

test('eight distinct animals and a full seven-round solo game', () => {
  const g = solo();
  assert.equal(new Set(g.players.map(p => p.animal)).size, 8);
  assert.equal(g.players[0].animal, 'wolf');
  let steps = 0;
  while (g.phase !== 'finished' && steps++ < 100) advance(g, NOW);
  assert.equal(g.phase, 'finished');
  assert.equal(g.round, 7);
  assert.ok(steps <= 7 * phasesFor('solo').length);
});

test('solo practice skips the trace and call phases that need other people', () => {
  const g = solo('deer');
  const seen = new Set<string>();
  while (g.phase !== 'finished') {
    seen.add(g.phase);
    advance(g, NOW);
  }
  assert.deepEqual([...seen].sort(), ['action', 'drop', 'food', 'settle', 'talk']);
  assert.equal(g.deadline, 0);
});

test('region adjacency is symmetric, connected, and leaves regions out of sight', () => {
  for (const r of REGIONS) {
    assert.ok(r.adjacent.length < REGIONS.length - 1);
    for (const id of r.adjacent) assert.ok(REGIONS.find(q => q.id === id)!.adjacent.includes(r.id));
  }
  const seen = new Set<string>(['forest']);
  for (let i = 0; i < REGIONS.length; i++) for (const r of REGIONS) if (seen.has(r.id)) r.adjacent.forEach(a => seen.add(a));
  assert.equal(seen.size, REGIONS.length);
});

test('ordinary food restores SP and never restores HP', () => {
  const g = solo('deer');
  isolate(g);
  const p = g.players[0];
  Object.assign(p, { location: 'forest', hp: 2, sp: 1, food: 'forage' });
  g.resources.forest = 1;
  resolveFood(g);
  assert.equal(p.hp, 2);
  assert.equal(p.sp, 1 - 1 + species('deer').gains.forage!);
  assert.equal(p.fed, true);
  assert.equal(g.resources.forest, 0);
});

test('overdraw restores half SP, then pays, and can kill before acting', () => {
  const g = solo('wolf');
  const p = g.players[0];
  Object.assign(p, { sp: 0, hp: 3 });
  assert.equal(pay(g, p), true);
  assert.equal(p.hp, 2);
  assert.equal(p.sp, Math.ceil(species('wolf').sp / 2) - 1);
  Object.assign(p, { sp: 0, hp: 1 });
  assert.equal(pay(g, p), false);
  assert.equal(p.alive, false);
  assert.equal(p.hp, 0);
  assert.equal(g.bodies.length, 1);
});

test('hiding erases local traces but cannot stop predation', () => {
  const g = solo('rabbit');
  isolate(g);
  const [rabbit, wolf] = g.players;
  asRole(wolf, 'wolf');
  rabbit.location = wolf.location = 'forest';
  g.traces = { forest: [rabbit.id], river: [rabbit.id] };
  g.phase = 'action';
  rabbit.ready = false;
  cmd(g, rabbit.id, { type: 'hide' });
  assert.deepEqual(g.traces.forest, []);
  assert.deepEqual(g.traces.river, [rabbit.id]);
  wolf.food = 'hunt';
  wolf.target = rabbit.id;
  resolveFood(g);
  assert.equal(rabbit.hp, species('rabbit').hp - species('wolf').damage);
  assert.equal(wolf.fed, true);
});

test('movement is adjacent only and leaves departure and arrival traces', () => {
  const g = solo();
  const p = g.players[0];
  g.phase = 'action';
  Object.assign(p, { location: 'forest', ready: false });
  const sp = p.sp;
  assert.throws(() => cmd(g, p.id, { type: 'move', region: 'ruins' }), /相邻/);
  assert.equal(p.sp, sp);
  cmd(g, p.id, { type: 'move', region: 'river' });
  assert.ok(g.traces.forest!.includes(p.id));
  assert.ok(g.traces.river!.includes(p.id));
  assert.equal(p.sp, sp - 1);
  assert.equal(p.actions, 1);
});

test('views do not leak other roles, hidden locations, choices, SP, HP, memories or remote traces', () => {
  const g = solo();
  isolate(g);
  const p = g.players[0];
  p.location = 'forest';
  g.phase = 'traces';
  g.players[1].location = 'ruins';
  g.traces = { ruins: ['secret-player'], river: ['visible-trace'] };
  const v = playerView(g, p.id, NOW);
  assert.equal(v.protocol, PROTOCOL_VERSION);
  assert.equal(v.now, NOW);
  assert.equal(v.traces.ruins, null);
  assert.deepEqual(v.traces.river, ['visible-trace']);
  assert.equal(v.players[1].animal, null);
  assert.equal(v.players[1].hp, null);
  const other = v.players[1] as unknown as Record<string, unknown>;
  for (const key of ['location', 'food', 'sp', 'target', 'guesses']) assert.ok(!(key in other) || other[key] === null, key);
  const json = JSON.stringify(v);
  assert.ok(!json.includes('secret-player'));
  assert.ok(!json.includes('belief'));
});

test('initial placements stay secret until every human locks in', () => {
  const g = online(['a', 'b']);
  advance(g, NOW);
  cmd(g, 'a', { type: 'drop', region: 'forest' });
  cmd(g, 'a', { type: 'ready' });
  assert.equal(g.phase, 'drop');
  assert.equal(playerView(g, 'b').players[0].drop, null);
  cmd(g, 'b', { type: 'drop', region: 'river' });
  cmd(g, 'b', { type: 'ready' });
  assert.equal(g.phase, 'action');
  assert.equal(playerView(g, 'b').players[0].drop, 'forest');
});

test('only food attempts expose actors, locally, including failed attempts', () => {
  const g = solo('deer');
  isolate(g);
  const [a, b, c] = g.players;
  a.location = b.location = 'forest';
  c.location = 'meadow';
  a.food = 'forage';
  g.resources.forest = 0;
  g.phase = 'food';
  resolveFood(g);
  const seen = (id: string, text: string) => playerView(g, id).log.some(l => l.text.includes(text));
  assert.ok(seen(b.id, `${a.name} 在雾松林进行了`));
  assert.ok(!seen(c.id, `${a.name} 在雾松林进行了`));
  assert.ok(!seen(a.id, `${b.name} 在寂石荒地进行了`));
});

test('wrong targeted prey fails, guard reduces damage and boost applies once', () => {
  const g = solo('wolf');
  isolate(g);
  const [a, b] = g.players;
  asRole(b, 'lynx');
  a.location = b.location = 'forest';
  a.food = 'hunt';
  a.target = b.id;
  resolveFood(g);
  assert.equal(a.fed, false);
  assert.equal(b.hp, species('lynx').hp);
  asRole(b, 'deer');
  Object.assign(b, { hunger: 0, guard: true });
  Object.assign(a, { boost: 1, sp: 4, fed: false });
  resolveFood(g);
  assert.equal(b.hp, species('deer').hp - (species('wolf').damage + 1 - 1));
  assert.equal(a.boost, 0);
  assert.equal(a.fed, true);
});

test('scarce food has one winner and initiative rotates every round', () => {
  const g = solo('deer');
  isolate(g);
  const [a, b] = g.players;
  asRole(b, 'boar');
  a.location = b.location = 'forest';
  a.food = b.food = 'forage';
  g.resources.forest = 1;
  resolveFood(g);
  assert.equal(a.fed, true);
  assert.equal(b.fed, false);
  g.round = 2;
  g.resources.forest = 1;
  a.fed = b.fed = false;
  a.sp = b.sp = 4;
  resolveFood(g);
  assert.equal(a.fed, false);
  assert.equal(b.fed, true);
});

test('private messages reach only sender and recipient; quotas count code points', () => {
  const g = online(['a', 'b', 'c'], 2);
  cmd(g, 'a', { type: 'message', target: 'b', text: '只有你知道的线索' });
  const has = (id: string, text: string) => playerView(g, id).log.some(l => l.text === text);
  assert.ok(has('a', '只有你知道的线索'));
  assert.ok(has('b', '只有你知道的线索'));
  assert.ok(!has('c', '只有你知道的线索'));
  cmd(g, 'a', { type: 'message', target: 'b', text: '🌲'.repeat(50) });
  assert.throws(() => cmd(g, 'a', { type: 'message', target: 'b', text: '字'.repeat(51) }), /50/);
  for (let i = 0; i < 3; i++) cmd(g, 'a', { type: 'message', target: 'b', text: '额度' });
  assert.throws(() => cmd(g, 'a', { type: 'message', target: 'b', text: '第六条' }), /5/);
  cmd(g, 'a', { type: 'message', target: 'all', text: '公告' });
  assert.throws(() => cmd(g, 'a', { type: 'message', target: 'all', text: '第二条' }), /额度/);
});

test('hunger runs in short cycles and food resets the cycle', () => {
  const g = solo('deer');
  isolate(g);
  const p = g.players[0];
  const hp = species('deer').hp;
  resolveFood(g);
  assert.equal(p.hp, hp);
  assert.equal(p.hunger, 1);
  resolveFood(g);
  assert.equal(p.hp, hp - 1);
  assert.equal(p.hunger, 2);
  resolveFood(g);
  assert.equal(p.hp, hp - 2);
  Object.assign(p, { location: 'forest', food: 'forage' });
  g.resources.forest = 1;
  resolveFood(g);
  assert.equal(p.hunger, 0);
  assert.equal(p.hp, hp - 2);
});

test('calls are ordered, require acceptance and consume both quotas', () => {
  const g = online(['a', 'b', 'c'], 2);
  g.phase = 'traces';
  advance(g, NOW);
  assert.equal(g.phase, 'call');
  assert.equal(g.callIndex, 0);
  assert.throws(() => cmd(g, 'b', { type: 'call', target: 'a' }));
  cmd(g, 'a', { type: 'call', target: 'b' });
  assert.equal(g.players[0].called, false);
  cmd(g, 'b', { type: 'call-answer', accept: true });
  assert.equal(g.players[0].called, true);
  assert.equal(g.players[1].called, true);
  assert.ok(g.deadline >= NOW + 30_000);
  cmd(g, 'a', { type: 'hangup' });
  // Seat 3 has nobody left to call, so the phase moves straight on to food.
  assert.equal(g.phase, 'food');
});

test('the call phase is skipped when fewer than two people can still call', () => {
  const g = online(['a'], 3);
  g.phase = 'traces';
  advance(g, NOW);
  assert.equal(g.phase, 'food');
});

test('dead players cannot act or message and keep only their own visibility', () => {
  const g = solo();
  const p = g.players[0];
  Object.assign(p, { alive: false, hp: 0 });
  assert.throws(() => cmd(g, p.id, { type: 'message', target: 'all', text: '泄露信息' }));
  g.phase = 'action';
  assert.throws(() => cmd(g, p.id, { type: 'move', region: 'river' }));
  assert.equal(playerView(g, p.id).players.filter(q => q.animal !== null).length, 1);
});

test('untrusted clients cannot eat outside their diet, add bots after start or change locked choices', () => {
  const g = solo('wolf');
  const p = g.players[0];
  g.phase = 'food';
  assert.throws(() => cmd(g, p.id, { type: 'food', choice: 'forage' }));
  assert.throws(() => cmd(g, p.id, { type: 'bots' }));
  g.phase = 'drop';
  p.ready = true;
  assert.throws(() => cmd(g, p.id, { type: 'drop', region: 'river' }));
});

test('rabbit jumps without traces, crow surveys any region, fox overhears one nearby message', () => {
  const g = solo('rabbit');
  isolate(g);
  const p = g.players[0];
  p.location = 'forest';
  g.phase = 'action';
  p.ready = false;
  g.traces = { forest: [p.id], river: [p.id], ruins: [p.id] };
  cmd(g, p.id, { type: 'skill', region: 'river' });
  assert.equal(p.location, 'river');
  assert.deepEqual(g.traces.forest, []);
  assert.deepEqual(g.traces.river, []);
  assert.deepEqual(g.traces.ruins, [p.id]);

  asRole(p, 'crow');
  Object.assign(p, { skillUsed: false, actions: 2 });
  cmd(g, p.id, { type: 'skill', region: 'ruins' });
  assert.ok(playerView(g, p.id).log.some(l => l.text.includes('俯瞰 寂石荒地')));

  asRole(p, 'fox');
  Object.assign(p, { skillUsed: false, actions: 2 });
  g.players[1].location = p.location;
  cmd(g, g.players[1].id, { type: 'message', target: g.players[2].id, text: '窃听样本' });
  cmd(g, p.id, { type: 'skill' });
  assert.ok(playerView(g, p.id).log.some(l => l.text.includes('窃听样本')));
  assert.ok(!playerView(g, g.players[3].id).log.some(l => l.text.includes('窃听样本')));
});

test('carrion feeds wolves, foxes and crows; snakes can catch small prey on food regions', () => {
  const g = solo('fox');
  isolate(g);
  const [fox, wolf, snake] = g.players;
  asRole(wolf, 'wolf');
  asRole(snake, 'snake');
  fox.location = wolf.location = 'cliff';
  g.bodies = [{ location: 'cliff', expires: 3 }];
  Object.assign(fox, { sp: 1, food: 'scavenge' });
  Object.assign(wolf, { sp: 1, food: 'scavenge' });
  resolveFood(g);
  assert.equal(fox.fed, true);
  assert.equal(fox.sp, species('fox').gains.scavenge);
  assert.equal(wolf.fed, false, 'only one animal can eat a carcass');
  Object.assign(snake, { location: 'forest', food: 'forage', sp: 1 });
  g.resources.forest = 1;
  resolveFood(g);
  assert.equal(snake.fed, true);
  assert.equal(snake.sp, species('snake').gains.forage);
});

test('leaving the lobby frees the seat and passes the host role; leaving a match hands the seat to a bot', () => {
  const g = createGame('LOBBY1', 'online', 9, NOW);
  addPlayer(g, 'a', '甲');
  addPlayer(g, 'b', '乙');
  removePlayer(g, 'a');
  assert.equal(g.host, 'b');
  assert.equal(g.players[0].seat, 1);
  addPlayer(g, 'c', '丙');
  startGame(g, undefined, NOW);
  abandonSeat(g, 'b');
  assert.equal(g.host, 'c');
  assert.equal(g.players.find(p => p.id === 'b')!.bot, true);
  assert.ok(g.bots.b);
});

test('deadlines advance online phases only once they pass', () => {
  const g = online(['a'], 4);
  assert.equal(g.phase, 'talk');
  assert.equal(tick(g, NOW + 1_000), false);
  assert.equal(tick(g, g.deadline + 1), true);
  assert.equal(g.phase, 'drop');
});

test('every role can finish full games without invalid numbers across seeded runs', () => {
  const summary: Record<string, { survived: number; games: number }> = {};
  for (const role of SPECIES) {
    for (let seed = 1; seed <= 25; seed++) {
      const g = createGame('SIM001', 'solo', seed, NOW);
      addPlayer(g, 'h', '玩家');
      startGame(g, role.id, NOW);
      const p = g.players[0];
      for (let steps = 0; g.phase !== 'finished' && steps < 80; steps++) {
        if (p.alive && g.phase === 'drop') {
          const fertile = REGIONS.filter(r => g.resources[r.id] > 0);
          cmd(g, p.id, { type: 'drop', region: fertile[seed % fertile.length].id });
        }
        if (p.alive && g.phase === 'food') cmd(g, p.id, { type: 'food', choice: role.foods.includes('forage') ? 'forage' : 'hunt' });
        cmd(g, p.id, { type: 'ready' });
        for (const q of g.players) {
          assert.ok(q.sp >= 0 && q.sp <= species(q.animal).sp, `${q.animal} sp ${q.sp}`);
          assert.ok(q.hp >= 0 && q.hp <= species(q.animal).hp, `${q.animal} hp ${q.hp}`);
        }
        assert.ok(Object.values(g.resources).every(x => x >= 0));
      }
      assert.equal(g.phase, 'finished');
      assert.equal(g.round, 7);
      assert.ok(g.players.every(q => Number.isFinite(q.score) && q.score >= 0));
      summary[role.id] ||= { survived: 0, games: 0 };
      summary[role.id].games++;
      summary[role.id].survived += Number(p.alive);
    }
  }
  console.log('200-game baseline (simple forage/hunt strategy):', JSON.stringify(summary));
});
