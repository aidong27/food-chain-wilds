import assert from 'node:assert/strict';
import test from 'node:test';
import { REGIONS, species } from '../src/game/data';
import { addPlayer, advance, applyCommand, createGame, startGame } from '../src/game/engine';
import { botsAct, botsChat, botsDrop } from '../src/game/bots';
import { chooseAction, chooseDrop, chooseFood, think } from '../src/game/bots/brain';
import { PHRASES, parseStatement } from '../src/game/bots/language';
import { newMemory } from '../src/game/bots/knowledge';
import type { Game } from '../src/game/types';
import { playerView } from '../src/game/view';

const NOW = 5_000_000;

function soloAt(phase: Game['phase'], seed = 11, role: Parameters<typeof startGame>[1] = 'deer') {
  const g = createGame('BOTS01', 'solo', seed, NOW);
  addPlayer(g, 'human', '测试者');
  startGame(g, role, NOW);
  while (g.phase !== phase) advance(g, NOW);
  return g;
}

const fixedRng = (seed: number) => {
  let x = seed;
  return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
};

test('bots decide only from their own view: hidden facts do not change their choices', () => {
  const g = soloAt('action', 21);
  const bot = g.players.find(p => p.bot && p.alive)!;
  const twin: Game = structuredClone(g);
  // Change what the bot cannot know: other players' identities and where they secretly moved.
  const strangers = twin.players.filter(p => p.id !== bot.id && p.alive);
  const [a, b] = strangers;
  [a.animal, b.animal] = [b.animal, a.animal];
  for (const p of strangers) p.location = REGIONS[(REGIONS.findIndex(r => r.id === p.location) + 3) % REGIONS.length].id;
  twin.traces = {};
  const viewA = playerView(g, bot.id, NOW);
  const viewB = playerView(twin, bot.id, NOW);
  assert.deepEqual(viewA, viewB, 'the hidden changes must be invisible to the bot');
  const decide = (view: typeof viewA) => {
    const mind = think(view, structuredClone(g.bots[bot.id]), fixedRng(7));
    return { action: chooseAction(mind), drop: chooseDrop(mind), food: chooseFood(mind) };
  };
  assert.deepEqual(decide(viewA), decide(viewB));
});

test('bot memories never appear in any player view', () => {
  const g = soloAt('food', 3);
  for (const p of g.players) {
    const json = JSON.stringify(playerView(g, p.id, NOW));
    assert.ok(!json.includes('"belief"'));
    assert.ok(!json.includes('"cover"'));
  }
});

test('bots act within the rules for many seeds', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = createGame('BOTS02', 'solo', seed, NOW);
    addPlayer(g, 'human', '测试者');
    startGame(g, undefined, NOW);
    while (g.phase !== 'finished') {
      if (g.phase === 'drop') botsDrop(g);
      advance(g, NOW);
      for (const p of g.players) {
        assert.ok(p.sp >= 0 && p.sp <= species(p.animal).sp);
        assert.ok(p.actions >= 0 && p.privateCount <= 5 && p.publicCount <= 1);
      }
    }
  }
});

test('table talk is understood: claims, denials, plans, accusations and questions', () => {
  const g = soloAt('drop');
  const view = playerView(g, 'human', NOW);
  const seat3 = g.players[2];
  assert.equal(parseStatement('我是麋鹿，别怕', view).claim, 'deer');
  assert.equal(parseStatement('我才是野兔！', view).claim, 'rabbit');
  assert.equal(parseStatement('我不是狼', view).claim, null);
  assert.equal(parseStatement('今晚我去河谷', view).region, 'river');
  assert.equal(parseStatement('今晚去金穗草原吧', view).region, 'meadow');
  assert.deepEqual(parseStatement(`昨晚3号${seat3.name}咬了我`, view).accused, [3]);
  assert.deepEqual(parseStatement(`小心${seat3.name}`, view).accused, [3]);
  assert.equal(parseStatement('你是什么动物？', view).question, 'identity');
  assert.equal(parseStatement('你今晚去哪？', view).question, 'location');
  assert.equal(parseStatement('你觉得谁是狼？', view).question, 'suspect');
  assert.deepEqual(parseStatement('谁是狼？', view).accused, []);
});

test('every line a bot can say reads back the way it is meant', () => {
  const g = soloAt('drop');
  const view = playerView(g, 'human', NOW);
  const other = g.players[2];
  const x = `${other.seat}号${other.name}`;
  const misread: string[] = [];
  const check = (family: string, text: string, ok: (s: ReturnType<typeof parseStatement>) => boolean) => {
    if (!ok(parseStatement(text, view))) misread.push(`${family}: ${text}`);
  };
  const claims = (s: ReturnType<typeof parseStatement>) => s.claim === 'snake';
  const names = (s: ReturnType<typeof parseStatement>) => s.accused.includes(other.seat);
  for (const f of [...PHRASES.claim, ...PHRASES.replyIdentity]) check('claim', f('游蛇'), claims);
  for (const f of PHRASES.liar) check('liar', f(x, '游蛇'), s => claims(s) && names(s));
  for (const f of [...PHRASES.accuse, ...PHRASES.suspect, ...PHRASES.replySuspect]) check('accuse', f(x), s => names(s) && !s.claim);
  for (const f of [...PHRASES.plan, ...PHRASES.replyLocation]) check('plan', f('月影河谷'), s => s.region === 'river' && !s.claim);
  // Nothing else may sound like the speaker claiming an identity.
  for (const f of [...PHRASES.warn, ...PHRASES.ackPlanAvoid, ...PHRASES.ackPlanNote]) check('region', f('月影河谷'), s => !s.claim);
  for (const f of [...PHRASES.mourn]) check('mourn', f(x, '游蛇'), s => !s.claim && !s.accused.length);
  for (const f of PHRASES.saw) check('saw', f(x, '月影河谷'), s => !s.claim);
  for (const f of [...PHRASES.ackPreyClaim, ...PHRASES.ackFriendClaim]) check('ack', f('游蛇'), s => !s.claim);
  const plain = [...PHRASES.idle, ...PHRASES.replyDodge, ...PHRASES.replyNoPlan, ...PHRASES.replyNoSuspect, ...PHRASES.ackOther];
  for (const text of [...plain, ...PHRASES.defend, ...PHRASES.opener]) check('plain', text, s => !s.claim && !s.accused.length);
  assert.deepEqual(misread, []);
});

test('bots answer private questions in context', () => {
  const g = soloAt('drop', 17);
  const bot = g.players.find(p => p.bot && p.alive)!;
  const ask = (text: string) => {
    bot.privateCount = 0;
    g.players[0].privateCount = 0;
    applyCommand(g, 'human', { type: 'message', target: bot.id, text }, NOW);
    const reply = g.log[g.log.length - 1];
    assert.equal(reply.from, bot.id);
    assert.deepEqual(reply.scope, [bot.id, 'human']);
    return reply.text;
  };
  const speciesNames = ['灰狼', '赤狐', '山猫', '游蛇', '野兔', '麋鹿', '野猪', '渡鸦'];
  const identity = ask('你是什么动物？');
  assert.ok(speciesNames.some(n => identity.includes(n)) || /先|早|告诉/.test(identity), identity);
  const place = ask('你今晚去哪？');
  assert.ok(REGIONS.some(r => place.includes(r.name)) || /想好|告诉|危险/.test(place), place);
});

test('a bitten bot names its attacker the next morning', () => {
  let accusations = 0,
    bites = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const g = soloAt('drop', seed, 'wolf');
    const wolf = g.players[0];
    const victim = g.players.find(p => p.bot && species(p.animal).diet === 'plant')!;
    victim.location = wolf.location = 'forest';
    g.phase = 'food';
    wolf.food = 'hunt';
    wolf.target = victim.id;
    victim.food = 'skip';
    for (const p of g.players) if (p !== wolf && p !== victim) p.food = 'skip';
    advance(g, NOW);
    if (!g.log.some(l => l.tag === 'attacked' && l.actor === wolf.id)) continue;
    bites++;
    victim.hp = Math.max(victim.hp, 1);
    victim.alive = true;
    advance(g, NOW); // settle → next round, bots talk
    const said = g.log.filter(l => l.kind === 'public' && l.from === victim.id && l.round === g.round);
    if (said.some(l => l.text.includes(`${wolf.seat}号`))) accusations++;
  }
  assert.ok(bites >= 20, `bites ${bites}`);
  assert.ok(accusations / bites >= 0.75, `${accusations}/${bites} accusations`);
});

test('a lone person can still finish a game while bots chat, act and eat', () => {
  const g = createGame('BOTS03', 'online', 99, NOW);
  addPlayer(g, 'human', '测试者');
  startGame(g, undefined, NOW);
  botsChat(g);
  let guard = 0;
  while (g.phase !== 'finished' && guard++ < 60) {
    if (g.phase === 'drop' && g.players[0].alive) applyCommand(g, 'human', { type: 'drop', region: 'river' }, NOW);
    if (g.phase === 'food' && g.players[0].alive) applyCommand(g, 'human', { type: 'food', choice: 'skip' }, NOW);
    if (g.phase === 'action') botsAct(g);
    applyCommand(g, 'human', { type: 'ready' }, NOW);
  }
  assert.equal(g.phase, 'finished');
  assert.ok(g.log.some(l => l.kind === 'public' && g.players.find(p => p.id === l.from)?.bot));
});

test('new memories start empty and personas vary', () => {
  const personas = new Set<number>();
  for (let seed = 1; seed <= 20; seed++) {
    const g = soloAt('drop', seed);
    for (const mem of Object.values(g.bots)) personas.add(mem.persona);
  }
  assert.equal(personas.size, 4);
  assert.deepEqual(newMemory(1).claims, {});
});
