/**
 * Game lifecycle: lobby, the seven-phase round loop and player commands.
 * The same engine runs inside the Cloudflare room, in the browser for solo
 * practice, and in tests.
 */
import {
  BOT_NAMES,
  REGIONS,
  RULES,
  SCORE,
  SPECIES,
  foodRegions,
  isAdjacent,
  isSpecies,
  phaseInfo,
  phasesFor,
  roundEvent,
  species,
  type PhaseId,
  type RegionId,
  type SpeciesId,
} from './data';
import { botsAct, botsChat, botsDrop, botsEat, botsGuess, botsHearPublic, botReply, initBotMemory } from './bots';
import { pick, randomSeed, shuffle } from './rng';
import { allowedFoods, fail, findPlayer, hide, leaveTrace, log, move, postMessage, resolveFood, scream, useSkill } from './rules';
import type { Command, Game, Mode, NightRecord, Player } from './types';

/** Stored games with another version are discarded instead of misread. */
export const STATE_VERSION = 2;

export function createGame(code: string, mode: Mode, seed = randomSeed(), now = Date.now()): Game {
  return {
    version: STATE_VERSION,
    code,
    mode,
    difficulty: 'normal',
    host: '',
    phase: 'lobby',
    round: 0,
    deadline: 0,
    players: [],
    traces: {},
    resources: { forest: 0, river: 0, cliff: 0, meadow: 0, shrub: 0, ruins: 0 },
    bodies: [],
    log: [],
    serial: 0,
    seed,
    callIndex: 0,
    call: null,
    event: '',
    createdAt: now,
    bots: {},
  };
}

export function cleanName(value: string): string {
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return [...name].slice(0, RULES.nameLength).join('') || '无名旅人';
}

export function addPlayer(g: Game, id: string, name: string, bot = false): Player {
  if (g.phase !== 'lobby') fail('对局已经开始，请等待下一局。');
  if (g.players.length >= RULES.maxPlayers) fail(`房间已满，最多 ${RULES.maxPlayers} 名玩家。`);
  const p: Player = {
    id,
    name: cleanName(name),
    seat: g.players.length + 1,
    bot,
    animal: 'rabbit',
    hp: 0,
    sp: 0,
    alive: true,
    diedRound: 0,
    location: 'forest',
    drop: null,
    actions: 0,
    ready: false,
    skillUsed: false,
    boost: 0,
    guard: false,
    hunger: 0,
    fed: false,
    food: null,
    target: '',
    privateCount: 0,
    publicCount: 0,
    voice: false,
    called: false,
    meals: 0,
    hunts: 0,
    guesses: {},
    score: 0,
  };
  g.players.push(p);
  if (!g.host && !bot) g.host = p.id;
  return p;
}

/** Leaving the lobby frees the seat; the host role passes to the next human. */
export function removePlayer(g: Game, id: string) {
  if (g.phase !== 'lobby') fail('对局已经开始。');
  g.players = g.players.filter(p => p.id !== id);
  g.players.forEach((p, i) => (p.seat = i + 1));
  if (g.host === id) g.host = g.players.find(p => !p.bot)?.id || '';
}

/** Leaving a running match hands the seat to a computer player. */
export function abandonSeat(g: Game, id: string) {
  const p = findPlayer(g, id);
  if (!p) return;
  p.bot = true;
  p.voice = false;
  p.ready = true;
  g.bots[p.id] ||= initBotMemory(g, p);
  if (g.host === id) g.host = g.players.find(q => !q.bot)?.id || '';
}

export function fillWithBots(g: Game) {
  const usedNames = new Set(g.players.map(p => p.name));
  const names = BOT_NAMES.filter(n => !usedNames.has(n));
  const usedIds = new Set(g.players.map(p => p.id));
  let k = 1;
  for (let n = 0; g.players.length < RULES.maxPlayers; n++) {
    while (usedIds.has(`bot-${k}`)) k++;
    usedIds.add(`bot-${k}`);
    addPlayer(g, `bot-${k}`, names[n] || `林客${n + 1}`, true);
  }
}

/** A scripted cast is used only if it gives every seat a different animal. */
function scriptedRoles(g: Game): SpeciesId[] | null {
  const roles = g.script?.roles;
  if (!roles || roles.length !== g.players.length || new Set(roles).size !== roles.length) return null;
  return roles.every(isSpecies) ? [...roles] : null;
}

function randomRoles(g: Game, preferred?: SpeciesId): SpeciesId[] {
  const roles = shuffle(
    g,
    SPECIES.map(s => s.id),
  );
  // Solo practice may pick an identity; the human always holds seat 1.
  if (g.mode === 'solo' && preferred && roles.includes(preferred)) {
    const i = roles.indexOf(preferred);
    [roles[0], roles[i]] = [roles[i], roles[0]];
  }
  return roles;
}

export function startGame(g: Game, preferred?: SpeciesId, now = Date.now()) {
  if (g.phase !== 'lobby') fail('游戏已经开始。');
  fillWithBots(g);
  const roles = scriptedRoles(g) ?? randomRoles(g, preferred);
  g.players.forEach((p, i) => {
    p.animal = roles[i];
    p.hp = species(p.animal).hp;
    p.sp = species(p.animal).sp;
  });
  for (const p of g.players) if (p.bot) g.bots[p.id] = initBotMemory(g, p);
  g.round = 1;
  beginRound(g, now);
}

function enterPhase(g: Game, phase: PhaseId, now: number) {
  g.phase = phase;
  g.call = null;
  for (const p of g.players) {
    p.ready = p.bot || !p.alive;
    p.voice = false;
  }
  g.deadline = g.mode === 'solo' ? 0 : now + phaseInfo(phase).seconds * 1000;
}

function beginRound(g: Game, now: number) {
  g.traces = {};
  g.bodies = g.bodies.filter(b => b.expires >= g.round);
  for (const r of Object.keys(g.resources) as (keyof Game['resources'])[]) g.resources[r] = 0;
  for (const r of foodRegions(g.round)) g.resources[r]++;
  g.event = roundEvent(g.round);
  for (const p of g.players) {
    Object.assign(p, {
      actions: RULES.actionsPerRound,
      drop: null,
      skillUsed: false,
      boost: 0,
      guard: false,
      fed: false,
      food: null,
      target: '',
      privateCount: 0,
      publicCount: 0,
      called: false,
    });
  }
  enterPhase(g, 'talk', now);
  log(g, `第 ${g.round} 回合开始。${g.event}。`, { tag: 'round' });
  botsChat(g);
}

function defaultDrop(g: Game): RegionId {
  const withFood = REGIONS.filter(r => g.resources[r.id] > 0);
  return pick(g, withFood.length ? withFood : REGIONS).id;
}

function nextPhaseAfter(g: Game, phase: PhaseId): PhaseId {
  const order = phasesFor(g.mode).map(p => p.id);
  return order[order.indexOf(phase) + 1] ?? 'settle';
}

/** Ends the current phase: on deadline, when every living human is ready, or on demand in solo. */
export function advance(g: Game, now = Date.now()) {
  switch (g.phase) {
    case 'talk':
      enterPhase(g, 'drop', now);
      break;
    case 'drop':
      botsDrop(g);
      for (const p of g.players.filter(p => p.alive)) {
        // Anyone who did not choose in time is placed on a random food region.
        p.drop ||= defaultDrop(g);
        p.location = p.drop;
        leaveTrace(g, p);
      }
      log(g, '投放完成。所有人的初始地区现已公开，之后的移动不会全图广播。', { tag: 'reveal' });
      enterPhase(g, 'action', now);
      break;
    case 'action':
      botsAct(g);
      enterOrSkip(g, nextPhaseAfter(g, 'action'), now);
      break;
    case 'traces':
      enterOrSkip(g, 'call', now);
      break;
    case 'call':
      nextCaller(g, now, true);
      break;
    case 'food':
      botsEat(g);
      resolveFood(g);
      recordNight(g);
      enterPhase(g, 'settle', now);
      break;
    case 'settle':
      if (g.round >= RULES.rounds) finish(g);
      else {
        g.round++;
        beginRound(g, now);
      }
      break;
  }
}

/** Keeps the night's positions, meals and hunts for the reveal at the end. */
function recordNight(g: Game) {
  const night: NightRecord = {
    round: g.round,
    players: g.players
      .filter(p => p.alive || p.diedRound === g.round)
      .map(p => ({ id: p.id, drop: p.drop, location: p.location, food: p.food, fed: p.fed, hp: p.hp, alive: p.alive })),
    hunts: g.log
      .filter(l => l.round === g.round && l.tag === 'hit' && Array.isArray(l.scope) && l.target)
      .map(l => ({ hunter: (l.scope as string[])[0], prey: l.target!, damage: l.amount ?? 0 })),
  };
  (g.history ||= []).push(night);
}

function enterOrSkip(g: Game, phase: PhaseId, now: number) {
  if (phase === 'call') {
    enterPhase(g, 'call', now);
    g.callIndex = -1;
    nextCaller(g, now, true);
  } else enterPhase(g, phase, now);
}

/** A human can call someone only if another living human has not used their call yet. */
function canCall(g: Game, p: Player) {
  return p.alive && !p.bot && !p.called && g.players.some(q => q.id !== p.id && q.alive && !q.bot && !q.called);
}

function nextCaller(g: Game, now: number, step: boolean) {
  if (step) g.callIndex++;
  g.call = null;
  while (g.callIndex < g.players.length && !canCall(g, g.players[g.callIndex])) g.callIndex++;
  if (g.callIndex >= g.players.length) {
    enterPhase(g, 'food', now);
    return;
  }
  g.deadline = g.mode === 'solo' ? 0 : now + RULES.callChooseSeconds * 1000;
}

/** Advances if the phase deadline has passed. Returns true when the state changed. */
export function tick(g: Game, now = Date.now()): boolean {
  if (!g.deadline || g.deadline > now || g.phase === 'lobby' || g.phase === 'finished') return false;
  advance(g, now);
  return true;
}

function finish(g: Game) {
  botsGuess(g);
  g.phase = 'finished';
  g.deadline = 0;
  g.call = null;
  for (const p of g.players) {
    p.voice = false;
    p.ready = true;
    const deduction = Object.entries(p.guesses).reduce(
      (sum, [id, guess]) => sum + (findPlayer(g, id)?.animal === guess ? SCORE.rightGuess : SCORE.wrongGuess),
      0,
    );
    p.score = Math.max(0, (p.alive ? SCORE.alive : 0) + p.hp * SCORE.hp + p.meals * SCORE.meal + p.hunts * SCORE.hunt + deduction);
  }
  log(g, `${RULES.rounds} 回合结束。所有动物身份揭晓；存活者共同获得生存胜利。`, { tag: 'finish' });
}

function requirePhase(g: Game, phase: PhaseId) {
  if (g.phase !== phase) fail('这个操作不属于当前阶段。');
}

function livingHumansReady(g: Game) {
  return g.players.filter(q => !q.bot && q.alive).every(q => q.ready);
}

/** Applies a validated command from a human seat. */
export function applyCommand(g: Game, playerId: string, cmd: Command, now = Date.now()) {
  const p = findPlayer(g, playerId);
  if (!p) fail('玩家不存在。');

  if (cmd.type === 'start') {
    if (g.host !== p.id) fail('只有房主能开始游戏。');
    startGame(g, cmd.animal, now);
    return;
  }
  if (cmd.type === 'bots') {
    if (g.host !== p.id) fail('只有房主能添加电脑玩家。');
    if (g.phase !== 'lobby') fail('这个操作不属于当前阶段。');
    fillWithBots(g);
    return;
  }
  if (g.phase === 'lobby' || g.phase === 'finished') fail('当前阶段不可执行此操作。');

  switch (cmd.type) {
    case 'guess': {
      if (!p.alive) fail('观战时不能修改推理。');
      if (!g.players.some(q => q.id === cmd.target && q.id !== p.id && q.alive)) fail('请选择仍存活的其他玩家。');
      if (cmd.animal === '') delete p.guesses[cmd.target];
      else p.guesses[cmd.target] = cmd.animal;
      return;
    }
    case 'ready': {
      if (g.phase === 'call') {
        if (g.players[g.callIndex]?.id !== p.id || g.call) fail('还没轮到你选择通话。');
        nextCaller(g, now, true);
        return;
      }
      if (g.phase === 'drop' && p.alive && !p.drop) fail('请先选择投放地区。');
      if (g.phase === 'food' && p.alive && !p.food) fail('请先选择获取食物的方式。');
      p.ready = true;
      if (livingHumansReady(g)) advance(g, now);
      return;
    }
  }

  if (!p.alive) fail('你已进入观战，无法干预对局。');

  switch (cmd.type) {
    case 'message': {
      postMessage(g, p, cmd.target, cmd.text);
      const q = findPlayer(g, cmd.target);
      if (q?.bot) botReply(g, q, p, cmd.text);
      else if (cmd.target === 'all') botsHearPublic(g, p, cmd.text);
      return;
    }
    case 'voice':
      requirePhase(g, 'talk');
      p.voice = cmd.joined;
      return;
    case 'call': {
      requirePhase(g, 'call');
      if (g.players[g.callIndex]?.id !== p.id || p.called || g.call) fail('现在无法发起通话。');
      const q = g.players.find(q => q.id === cmd.target && q.id !== p.id && q.alive && !q.called && !q.bot);
      if (!q) fail('请选择尚未使用通话机会的真人玩家。');
      g.call = { from: p.id, to: q.id, accepted: false };
      g.deadline = g.mode === 'solo' ? 0 : now + RULES.callChooseSeconds * 1000;
      return;
    }
    case 'call-answer': {
      requirePhase(g, 'call');
      if (!g.call || g.call.to !== p.id || g.call.accepted) fail('没有待接听的邀请。');
      if (!cmd.accept) {
        nextCaller(g, now, true);
        return;
      }
      const caller = findPlayer(g, g.call.from)!;
      p.called = caller.called = true;
      g.call.accepted = true;
      g.deadline = now + RULES.callTalkSeconds * 1000;
      return;
    }
    case 'hangup':
      requirePhase(g, 'call');
      if (!g.call || ![g.call.from, g.call.to].includes(p.id)) fail('你没有正在进行的通话。');
      nextCaller(g, now, true);
      return;
    case 'drop':
      requirePhase(g, 'drop');
      if (p.ready) fail('已锁定选择。');
      p.drop = cmd.region;
      return;
    case 'food': {
      requirePhase(g, 'food');
      if (p.ready) fail('已锁定选择。');
      if (!allowedFoods(p).includes(cmd.choice)) fail('这个食物来源不适合你的动物。');
      if (cmd.target && !g.players.some(q => q.id === cmd.target && q.id !== p.id && q.alive)) fail('无效的捕食目标。');
      p.food = cmd.choice;
      p.target = cmd.choice === 'hunt' ? cmd.target || '' : '';
      return;
    }
  }

  requirePhase(g, 'action');
  if (p.ready || p.actions <= 0) fail('本回合行动已结束。');
  switch (cmd.type) {
    case 'move':
      if (!isAdjacent(p.location, cmd.region)) fail('只能移动到相邻地区。');
      move(g, p, cmd.region);
      return;
    case 'hide':
      hide(g, p);
      return;
    case 'scream':
      scream(g, p);
      return;
    case 'skill':
      useSkill(g, p, cmd.region);
      return;
  }
}
