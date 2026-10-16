import assert from 'node:assert/strict';
import test from 'node:test';
import { REGIONS, species } from '../src/game/data';
import { addPlayer, advance, applyCommand, createGame, startGame } from '../src/game/engine';
import { TUTORIAL_SEATS, createTutorialGame } from '../src/game/tutorial';
import type { Game } from '../src/game/types';
import { playerView } from '../src/game/view';

const NOW = 7_000_000;
const ME = 'you';

const seat = (g: Game, n: number) => g.players.find(p => p.seat === n)!;
const cmd = (g: Game, c: Parameters<typeof applyCommand>[2]) => applyCommand(g, ME, c, NOW);
/** Public lines of a round as `seat:text`. */
const said = (g: Game, round: number) =>
  g.log.filter(l => l.round === round && l.kind === 'public').map(l => `${g.players.find(p => p.id === l.from)!.seat}:${l.text}`);

test('a script fixes the cast, the cover stories and the opening talk', () => {
  const g = createTutorialGame(ME, '学徒', NOW);
  assert.deepEqual(
    g.players.map(p => p.animal),
    ['deer', 'wolf', 'rabbit', 'boar', 'crow', 'fox', 'lynx', 'snake'],
  );
  assert.equal(g.players[0].id, ME);
  assert.equal(g.difficulty, 'easy');
  assert.equal(g.bots[seat(g, 2).id].cover, 'rabbit');
  assert.deepEqual(
    said(g, 1).map(line => line.split(':')[0]),
    ['2', '3', '5'],
  );
  assert.ok(!g.log.some(l => l.kind === 'private'), 'no unscripted approaches on a scripted night');
});

test('the tutorial wolf follows the player, finds them with alertness, and bites the boar once they flee', () => {
  const g = createTutorialGame(ME, '学徒', NOW);
  const me = g.players[0];
  const wolf = seat(g, TUTORIAL_SEATS.wolf);
  const boar = seat(g, TUTORIAL_SEATS.boar);
  // Asking the wolf privately gets its cover story back.
  cmd(g, { type: 'message', target: wolf.id, text: '你是什么动物？' });
  const reply = g.log.find(l => l.kind === 'private' && l.from === wolf.id && l.to === ME);
  assert.ok(reply?.text.includes('野兔'), reply?.text);

  // The camp talks during the drop itself.
  assert.equal(g.phase, 'drop');
  cmd(g, { type: 'drop', region: 'meadow' });
  cmd(g, { type: 'ready' });
  assert.equal(g.phase, 'action');
  assert.equal(wolf.drop, 'meadow');
  assert.equal(boar.drop, 'meadow');
  assert.deepEqual(
    g.players.filter(p => p.drop === 'meadow').map(p => p.seat),
    [1, 2, 4],
    'only the wolf and the boar start beside the player',
  );

  cmd(g, { type: 'skill' });
  assert.ok(
    playerView(g, ME).log.some(l => l.tag === 'skill' && l.amount === 1),
    'alertness senses the wolf',
  );
  cmd(g, { type: 'move', region: 'river' });
  // Both actions are spent, so the night moves on by itself.
  assert.equal(g.phase, 'food');
  assert.equal(wolf.location, 'meadow', 'scripted bots stay put');
  cmd(g, { type: 'food', choice: 'forage' });
  cmd(g, { type: 'ready' });
  assert.equal(g.phase, 'settle');
  assert.equal(me.hp, species('deer').hp);
  assert.equal(me.fed, true);
  assert.equal(boar.hp, species('boar').hp - species('wolf').damage);
  assert.equal(wolf.fed, true);

  cmd(g, { type: 'ready' });
  assert.equal(g.round, 2);
  const lines = said(g, 2);
  assert.ok(lines[0].startsWith('4:') && lines[0].includes('2号'), lines[0]);
});

test('the tutorial keeps the wolf off the player on the second night, then hands over to normal bots', () => {
  const g = createTutorialGame(ME, '学徒', NOW);
  const me = g.players[0];
  for (let guard = 0; g.round < 3 && guard < 40; guard++) {
    if (g.phase === 'drop') cmd(g, { type: 'drop', region: 'forest' });
    if (g.phase === 'food') cmd(g, { type: 'food', choice: 'forage' });
    cmd(g, { type: 'ready' });
  }
  assert.equal(g.round, 3);
  assert.equal(me.alive, true);
  assert.ok(!g.log.some(l => l.tag === 'attacked' && Array.isArray(l.scope) && l.scope.includes(ME)), 'never bitten in the tutorial');
  assert.equal(g.script?.rounds?.[3], undefined);
});

test('every night is recorded and revealed only when the match is over', () => {
  const g = createGame('HIST01', 'solo', 42, NOW);
  addPlayer(g, ME, '记录者');
  startGame(g, 'wolf', NOW);
  while (g.phase !== 'finished') {
    if (g.phase === 'drop' && g.players[0].alive) cmd(g, { type: 'drop', region: REGIONS.find(r => g.resources[r.id] > 0)!.id });
    if (g.phase === 'food' && g.players[0].alive) cmd(g, { type: 'food', choice: 'hunt' });
    assert.equal(playerView(g, ME, NOW).history, null);
    cmd(g, { type: 'ready' });
  }
  const history = playerView(g, ME, NOW).history!;
  assert.deepEqual(
    history.map(n => n.round),
    [1, 2, 3, 4, 5, 6, 7],
  );
  for (const night of history) {
    for (const p of night.players) assert.ok(p.drop && REGIONS.some(r => r.id === p.location), `${p.id} placed on night ${night.round}`);
    for (const h of night.hunts) {
      assert.ok(
        night.players.some(p => p.id === h.hunter),
        'hunters were out that night',
      );
      assert.ok(h.damage >= 1);
    }
  }
  const hits = g.log.filter(l => l.tag === 'hit').length;
  assert.equal(
    history.reduce((n, night) => n + night.hunts.length, 0),
    hits,
  );
  // Nobody appears after the night they died.
  const died = new Map(g.players.filter(p => !p.alive).map(p => [p.id, p.diedRound]));
  for (const night of history) for (const p of night.players) assert.ok(!died.has(p.id) || night.round <= died.get(p.id)!);
});

test('normal matches are unscripted', () => {
  const g = createGame('PLAIN1', 'online', 3, NOW);
  addPlayer(g, 'a', '甲');
  startGame(g, undefined, NOW);
  assert.equal(g.script, undefined);
  assert.equal(g.phase, 'drop');
  advance(g, NOW);
  assert.equal(g.phase, 'action');
});
