/**
 * Decisions of a computer player. Every function here sees only the bot's
 * GameView and its memory — never the hidden game state.
 */
import { REGIONS, SPECIES, isAdjacent, predatorsOf, region, species, type FoodChoice, type RegionId, type SpeciesId } from '../data';
import type { BotMemory, Command, Player } from '../types';
import type { GameView, PlayerSummary } from '../view';
import { visibleRegions } from '../view';
import { dropGuess, exposeLiars, foragerOf, identityOdds, mostLikely, observe, preyOf, threatOf, type Odds } from './knowledge';

export type Rng = () => number;

export interface Mind {
  view: GameView;
  mem: BotMemory;
  me: Player;
  odds: Odds;
  rng: Rng;
  /** Hunters are clumsier on easy and sharper on hard; prey always play well. */
  sharpness: number;
}

const SHARPNESS = { easy: 0.35, normal: 1, hard: 1.5 } as const;

/** Reads fresh evidence and prepares the bot's current beliefs. */
export function think(view: GameView, mem: BotMemory, rng: Rng): Mind {
  observe(view, mem);
  exposeLiars(view, mem);
  return { view, mem, me: view.me!, odds: identityOdds(view, mem), rng, sharpness: SHARPNESS[view.difficulty] ?? 1 };
}

const others = (m: Mind): PlayerSummary[] => m.view.players.filter(p => p.alive && p.id !== m.me.id);
const diet = (m: Mind) => species(m.me.animal).diet;

/** Seat order for this round's food resolution; earlier seats eat first. */
function feedingOrder(m: Mind, seat: number): number {
  const count = m.view.players.length;
  const rotation = (m.view.round - 1) % count;
  return (seat - 1 - rotation + count) % count;
}

function softmax<T>(m: Mind, options: [T, number][], temperature: number): T {
  const best = Math.max(...options.map(([, v]) => v));
  const weights = options.map(([value, v]) => [value, Math.exp((v - best) / temperature)] as const);
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let roll = m.rng() * total;
  for (const [value, w] of weights) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return weights[weights.length - 1][0];
}

/** Penalty for places where this bot was hurt or warned recently. */
function badMemories(m: Mind, r: RegionId): number {
  return m.mem.danger.filter(d => d.region === r && m.view.round - d.round <= 1).length * 0.8;
}

// ---------------------------------------------------------------- drop

function dropValue(m: Mind, r: RegionId): number {
  const food = m.view.resources[r] > 0 ? 1 : 0;
  let danger = 0,
    prey = 0,
    rivals = 0;
  for (const p of others(m)) {
    const at = dropGuess(m.view, m.mem, p.id)[r] || 0;
    danger += threatOf(m.odds, p.id, m.me.animal) * at;
    prey += preyOf(m.odds, p.id, m.me.animal) * at;
    rivals += foragerOf(m.odds, p.id) * at;
  }
  const bodies = m.view.bodies.filter(b => b.location === r).length;
  switch (diet(m)) {
    case 'plant':
      return 3 * food * (1 - 0.3 * Math.min(2, rivals)) - 3.4 * danger - badMemories(m, r);
    case 'scavenge':
      return 2.6 * bodies + 1.6 * food * (1 - 0.3 * Math.min(2, rivals)) - 3 * danger - badMemories(m, r);
    case 'hunt':
      return 3 * prey + 0.3 * food - 2.2 * danger;
  }
}

/** Hunters on easy pick spots almost at random; on hard they commit to the best read. */
function dropTemperature(m: Mind) {
  return diet(m) === 'hunt' ? 0.45 / m.sharpness : 0.45;
}

export function chooseDrop(m: Mind): RegionId {
  // A bot sticks to the plan it made while talking, whether or not it told the truth about it.
  const intent = m.mem.intent;
  if (intent && intent.round === m.view.round) return intent.region;
  return softmax(
    m,
    REGIONS.map(r => [r.id, dropValue(m, r.id)] as [RegionId, number]),
    dropTemperature(m),
  );
}

/**
 * Settles where the bot will really go this round and returns what it tells
 * others: the plan itself when honest, another region when bluffing.
 */
export function planDrop(m: Mind, honest: boolean): RegionId {
  const options = REGIONS.map(r => [r.id, dropValue(m, r.id)] as [RegionId, number]);
  if (m.mem.intent?.round !== m.view.round) {
    m.mem.intent = { region: softmax(m, options, dropTemperature(m)), round: m.view.round };
  }
  const real = m.mem.intent.region;
  return honest
    ? real
    : softmax(
        m,
        options.filter(([r]) => r !== real),
        0.8,
      );
}

// ---------------------------------------------------------------- actions

interface Spot {
  danger: number;
  prey: number;
  rivalsBefore: number;
  food: number;
  bodies: number;
}

/** What the bot expects at a region, based on public drops this round. */
function spot(m: Mind, r: RegionId): Spot {
  const mySeatOrder = feedingOrder(m, m.me.seat);
  let danger = 0,
    prey = 0,
    rivalsBefore = 0;
  for (const p of others(m)) {
    const here = p.drop === r ? 1 : p.drop && isAdjacent(p.drop, r) ? 0.18 : 0;
    if (!here) continue;
    danger += threatOf(m.odds, p.id, m.me.animal) * here;
    prey += preyOf(m.odds, p.id, m.me.animal) * here;
    if (feedingOrder(m, p.seat) < mySeatOrder) rivalsBefore += foragerOf(m.odds, p.id) * here;
  }
  return { danger, prey, rivalsBefore, food: m.view.resources[r], bodies: m.view.bodies.filter(b => b.location === r).length };
}

function spotValue(m: Mind, s: Spot): number {
  switch (diet(m)) {
    case 'plant': {
      const eat = s.food > 0 ? Math.max(0, 1 - (0.7 * s.rivalsBefore) / s.food) : 0;
      return 2.4 * eat - 3.2 * s.danger;
    }
    case 'scavenge': {
      const eat = s.bodies > 0 ? 1.3 : s.food > 0 ? 0.8 * Math.max(0, 1 - (0.7 * s.rivalsBefore) / s.food) : 0;
      return 2.2 * eat - 3 * s.danger;
    }
    case 'hunt':
      return 2.6 * Math.min(1.4, s.prey) - 2.2 * s.danger;
  }
}

function usedSkillThisRound(m: Mind) {
  return m.me.skillUsed;
}

/** One action at a time, so a bot can react to what its own skill revealed. */
export function chooseAction(m: Mind): Command | null {
  const me = m.me;
  if (!me.alive || me.actions <= 0) return null;
  // Never spend the last stamina on actions: eating also costs 1 SP.
  if (me.sp <= 1) return null;
  const here = me.location;
  const s = species(me.animal);
  const current = spot(m, here);
  const stay = spotValue(m, current);
  const moves = region(here).adjacent.map(r => [r, spotValue(m, spot(m, r))] as [RegionId, number]);
  const [bestMove, bestValue] = moves.reduce((a, b) => (b[1] > a[1] ? b : a));
  const chasing = diet(m) === 'hunt' && m.sharpness < 1 ? m.rng() < m.sharpness : true;
  const wantsToMove = chasing && bestValue > stay + 0.45;

  switch (me.animal) {
    case 'deer':
      if (!usedSkillThisRound(m) && current.danger >= 0.12 && current.danger <= 0.9) return { type: 'skill' };
      break;
    case 'rabbit':
      if (wantsToMove && !usedSkillThisRound(m)) return { type: 'skill', region: bestMove };
      break;
    case 'boar':
      if (!wantsToMove && !usedSkillThisRound(m) && current.danger >= 0.25) return { type: 'skill' };
      break;
    case 'lynx':
    case 'snake':
      if (!wantsToMove && !usedSkillThisRound(m) && current.prey >= 0.35 && me.sp >= 3) return { type: 'skill' };
      break;
    case 'wolf':
      if (!usedSkillThisRound(m) && me.sp >= 3 && m.rng() < 0.3) return { type: 'skill' };
      break;
    case 'fox':
      if (!usedSkillThisRound(m) && me.sp >= 3 && m.rng() < 0.25) return { type: 'skill' };
      break;
    case 'crow':
      if (!usedSkillThisRound(m) && me.sp >= 4 && m.rng() < 0.3) {
        const unseen = REGIONS.filter(r => !visibleRegions(here).includes(r.id));
        return { type: 'skill', region: unseen[Math.floor(m.rng() * unseen.length)]?.id ?? here };
      }
      break;
  }
  if (wantsToMove) return { type: 'move', region: bestMove };
  if (s.diet !== 'hunt' && current.danger >= 0.4 && me.sp >= 3 && m.rng() < 0.25) return { type: 'hide' };
  return null;
}

// ---------------------------------------------------------------- food

export function chooseFood(m: Mind): { choice: FoodChoice; target?: string } {
  const me = m.me;
  const s = species(me.animal);
  // Overdrawing at 1 HP would be fatal.
  if (me.sp === 0 && me.hp <= 1) return { choice: 'skip' };
  const here = me.location;
  // A sure meal on the ground beats a hunt on a guess: prey seen at the drop may already have fled.
  if (s.foods.includes('scavenge') && m.view.bodies.some(b => b.location === here)) return { choice: 'scavenge' };
  if (s.foods.includes('forage') && m.view.resources[here] > 0) return { choice: 'forage' };
  if (s.foods.includes('hunt')) {
    const nearby = new Set([
      ...(m.view.traces[here] || []),
      ...others(m)
        .filter(p => p.drop === here)
        .map(p => p.id),
    ]);
    const prey = [...nearby].reduce((sum, id) => sum + preyOf(m.odds, id, me.animal), 0);
    const starving = me.hunger + 1 >= s.hunger;
    // On easy, hunters only bite when hunger forces them to.
    if (m.sharpness < 1 && !starving && m.rng() > m.sharpness) return { choice: 'skip' };
    if (prey >= 0.15 || starving || me.sp >= 3) return { choice: 'hunt' };
  }
  return { choice: 'skip' };
}

// ---------------------------------------------------------------- reasoning helpers for talk

/** The living player this bot considers most dangerous to itself, if any stands out. */
export function topThreat(m: Mind, minimum = 0.45): PlayerSummary | null {
  const list = others(m);
  const threats = list.map(p => threatOf(m.odds, p.id, m.me.animal));
  // Only someone clearly above the background risk counts as a suspect.
  const baseline = threats.reduce((a, b) => a + b, 0) / Math.max(1, threats.length);
  let best: PlayerSummary | null = null,
    value = Math.max(minimum, baseline + 0.2);
  list.forEach((p, i) => {
    if (threats[i] > value) [best, value] = [p, threats[i]];
  });
  return best;
}

/** The living player most likely to be any kind of hunter. */
export function topHunter(m: Mind, minimum = 0.5): PlayerSummary | null {
  const list = others(m);
  const hunterChance = list.map(p => {
    const row = m.odds.get(p.id)!;
    return SPECIES.reduce((sum, s, i) => sum + (s.diet === 'hunt' ? row[i] : 0), 0);
  });
  const baseline = hunterChance.reduce((a, b) => a + b, 0) / Math.max(1, hunterChance.length);
  let best: PlayerSummary | null = null,
    value = Math.max(minimum, baseline + 0.2);
  list.forEach((p, i) => {
    if (hunterChance[i] > value) [best, value] = [p, hunterChance[i]];
  });
  return best;
}

/** Final identity guesses for scoring, only where the bot is fairly sure. */
export function chooseGuesses(m: Mind): Record<string, SpeciesId> {
  const out: Record<string, SpeciesId> = {};
  for (const p of others(m)) {
    const best = mostLikely(m.odds, p.id);
    if (best.p >= 0.55) out[p.id] = best.animal;
  }
  return out;
}

/** The identity a bot presents to others. Hunters hide; most others tell the truth. */
export function coverStory(m: Mind): SpeciesId {
  if (m.mem.cover) return m.mem.cover;
  const me = m.me.animal;
  const claimed = new Set(Object.values(m.mem.claims));
  const dead = new Set(m.view.players.filter(p => !p.alive && p.animal).map(p => p.animal!));
  let cover: SpeciesId = me;
  const lieAmong = (pool: SpeciesId[]) => {
    const fresh = pool.filter(s => s !== me && !claimed.has(s) && !dead.has(s));
    const list = fresh.length ? fresh : pool.filter(s => s !== me);
    return list[Math.floor(m.rng() * list.length)];
  };
  if (species(me).diet === 'hunt') cover = lieAmong(['rabbit', 'deer', 'boar', 'crow']);
  // A rabbit is everyone's prey; some pretend to be bigger.
  else if (me === 'rabbit' && m.rng() < 0.5) cover = lieAmong(['deer', 'boar']);
  m.mem.cover = cover;
  return cover;
}

/** Whether the bot tells the truth about its plans: hunters and much-hunted prey bluff. */
export function honestAbout(m: Mind): boolean {
  return species(m.me.animal).diet !== 'hunt' && m.mem.persona !== 2 && predatorsOf(m.me.animal).length <= 2;
}
