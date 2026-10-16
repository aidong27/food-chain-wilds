/**
 * What a computer player believes about everyone else.
 *
 * Beliefs are built only from the bot's own GameView: its private log lines,
 * public drops, visible traces, deaths and conversation. Hidden state is never
 * consulted, so bots play by the same information rules as people.
 */
import { REGIONS, SPECIES, canEat, foodRegions, isAdjacent, species, type RegionId, type SpeciesId } from '../data';
import type { BotMemory, Player } from '../types';
import type { GameView, PlayerSummary, ViewEntry } from '../view';
import { parseStatement } from './language';

const N = SPECIES.length;
const INDEX = new Map(SPECIES.map((s, i) => [s.id, i]));
export const indexOf = (id: SpeciesId) => INDEX.get(id)!;

export function newMemory(persona: number): BotMemory {
  return { seen: 0, belief: {}, claims: {}, plans: {}, cover: null, intent: null, persona, attackers: [], danger: [], seenAt: {} };
}

function weights(mem: BotMemory, id: string): number[] {
  return (mem.belief[id] ||= Array(N).fill(1));
}

/** Multiplies the evidence for each identity of a player. */
export function scale(mem: BotMemory, id: string, factor: (s: SpeciesId) => number) {
  const w = weights(mem, id);
  for (let i = 0; i < N; i++) w[i] = Math.max(1e-6, w[i] * factor(SPECIES[i].id));
  // Keep numbers in a comfortable range; only ratios matter.
  const max = Math.max(...w);
  if (max > 1e6 || max < 1e-3) for (let i = 0; i < N; i++) w[i] /= max;
}

/** How likely someone is to claim `claimed` when they really are `actual`. */
function claimLikelihood(claimed: SpeciesId, actual: SpeciesId): number {
  if (claimed === actual) return 0.8;
  const claimedDiet = species(claimed).diet;
  const actualDiet = species(actual).diet;
  // Hunters usually hide behind a harmless identity.
  if (actualDiet === 'hunt' && claimedDiet !== 'hunt') return 0.22;
  if (actualDiet === 'hunt') return 0.04;
  return 0.04;
}

export type Odds = Map<string, number[]>;

/**
 * Turns raw evidence into probabilities that respect the rule that every
 * identity appears exactly once (Sinkhorn balancing of the belief matrix).
 */
export function identityOdds(view: GameView, mem: BotMemory): Odds {
  const me = view.me!;
  const others = view.players.filter(p => p.id !== me.id);
  const known = new Set<SpeciesId>([me.animal, ...others.filter(p => p.animal).map(p => p.animal!)]);
  const rows = others.map(p => {
    if (p.animal) return SPECIES.map(s => (s.id === p.animal ? 1 : 0));
    const w = weights(mem, p.id);
    return SPECIES.map((s, i) => (known.has(s.id) ? 0 : w[i]));
  });
  const columns = SPECIES.map((_, i) => i).filter(i => SPECIES[i].id !== me.animal);
  for (let iteration = 0; iteration < 40; iteration++) {
    for (const row of rows) {
      const total = row.reduce((a, b) => a + b, 0) || 1;
      for (let i = 0; i < N; i++) row[i] /= total;
    }
    for (const c of columns) {
      const total = rows.reduce((sum, row) => sum + row[c], 0);
      if (total > 0) for (const row of rows) row[c] /= total;
    }
  }
  for (const row of rows) {
    const total = row.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < N; i++) row[i] /= total;
  }
  return new Map(others.map((p, i) => [p.id, rows[i]]));
}

export function probabilityOf(odds: Odds, id: string, test: (s: SpeciesId) => boolean): number {
  const row = odds.get(id);
  if (!row) return 0;
  return SPECIES.reduce((sum, s, i) => sum + (test(s.id) ? row[i] : 0), 0);
}

/** Chance that `id` can eat me. */
export const threatOf = (odds: Odds, id: string, me: SpeciesId) => probabilityOf(odds, id, s => canEat(s, me));
/** Chance that `id` is on my menu. */
export const preyOf = (odds: Odds, id: string, me: SpeciesId) => probabilityOf(odds, id, s => canEat(me, s));
/** Chance that `id` competes with me for plant food. */
export const foragerOf = (odds: Odds, id: string) => probabilityOf(odds, id, s => species(s).foods.includes('forage'));

export function mostLikely(odds: Odds, id: string): { animal: SpeciesId; p: number } {
  const row = odds.get(id) || Array(N).fill(1 / N);
  let best = 0;
  for (let i = 1; i < N; i++) if (row[i] > row[best]) best = i;
  return { animal: SPECIES[best].id, p: row[best] };
}

function others(view: GameView): PlayerSummary[] {
  return view.players.filter(p => p.id !== view.me!.id);
}

/** Plant food that existed at the start of the round — public knowledge. */
function hadFood(view: GameView, location: RegionId) {
  return foodRegions(view.round).includes(location);
}

/**
 * Digests every log line and public fact the bot has not seen yet.
 * Safe to call repeatedly; each line is processed once.
 */
export function observe(view: GameView, mem: BotMemory) {
  const me = view.me as Player;
  for (const p of others(view)) {
    weights(mem, p.id)[indexOf(me.animal)] = 1e-6;
    if (p.drop && view.phase !== 'drop') mem.seenAt[p.id] = { region: p.drop, round: view.round };
  }
  for (const [loc, ids] of Object.entries(view.traces) as [RegionId, string[] | null][]) {
    for (const id of ids || []) if (id !== me.id) mem.seenAt[id] = { region: loc, round: view.round };
  }

  const fresh = view.log.filter(l => l.id > mem.seen);
  for (const entry of fresh) digest(view, mem, me, entry, fresh);
  if (fresh.length) mem.seen = fresh[fresh.length - 1].id;
}

function digest(view: GameView, mem: BotMemory, me: Player, entry: ViewEntry, batch: ViewEntry[]) {
  const nameToId = (seat: number) => view.players.find(p => p.seat === seat)?.id;
  switch (entry.tag) {
    case 'attacked':
      if (entry.actor) {
        scale(mem, entry.actor, s => (canEat(s, me.animal) ? 1 : 0.01));
        mem.attackers.push(entry.actor);
      }
      return;
    case 'hit':
      if (entry.target) scale(mem, entry.target, s => (canEat(me.animal, s) ? 1 : 0.01));
      return;
    case 'food-attempt': {
      if (!entry.actor || entry.actor === me.id || !entry.region) return;
      const actor = entry.actor;
      if (!hadFood(view, entry.region)) {
        // Nothing to graze here, so this was almost certainly a hunt.
        scale(mem, actor, s => (species(s).diet === 'hunt' ? 1 : species(s).diet === 'scavenge' ? 0.45 : 0.15));
      } else {
        scale(mem, actor, s => (species(s).diet === 'plant' ? 1.25 : species(s).diet === 'scavenge' ? 1.1 : 0.9));
      }
      // They tried to eat right next to me and did not bite me.
      const bitMe = batch.some(l => l.tag === 'attacked' && l.actor === actor && l.round === entry.round);
      if (me.alive && entry.region === me.location && !bitMe) scale(mem, actor, s => (canEat(s, me.animal) ? 0.45 : 1));
      return;
    }
    case 'skill':
      if (entry.skill === 'deer' && entry.region) {
        const near = others(view)
          .filter(p => p.alive && p.drop === entry.region)
          .map(p => p.id);
        const factor = entry.amount ? 2.5 : 0.3;
        for (const id of near) scale(mem, id, s => (canEat(s, me.animal) ? factor : 1));
        if (entry.amount) mem.danger.push({ region: entry.region, round: entry.round });
      }
      if (entry.skill === 'crow' && entry.region && entry.actor) {
        for (const id of entry.actor.split(',')) if (id && id !== me.id) mem.seenAt[id] = { region: entry.region, round: entry.round };
      }
      return;
  }

  if ((entry.kind === 'public' || (entry.kind === 'private' && entry.to === me.id)) && entry.from && entry.from !== me.id) {
    const said = parseStatement(entry.text, view);
    if (said.claim) {
      mem.claims[entry.from] = said.claim;
      const claimed = said.claim;
      if (claimed === me.animal) scale(mem, entry.from, s => (species(s).diet === 'hunt' ? 3 : 0.5));
      else scale(mem, entry.from, s => claimLikelihood(claimed, s));
    }
    if (said.region) mem.plans[entry.from] = { region: said.region, round: entry.round };
    for (const seat of said.accused) {
      const id = nameToId(seat);
      if (id && id !== entry.from && id !== me.id) scale(mem, id, s => (species(s).diet === 'hunt' ? 1.6 : 0.6));
    }
  }
}

/** A dead player's identity exposes anyone who had claimed it. */
export function exposeLiars(view: GameView, mem: BotMemory) {
  for (const dead of view.players.filter(p => !p.alive && p.animal)) {
    for (const [id, claim] of Object.entries(mem.claims)) {
      if (id !== dead.id && claim === dead.animal) {
        scale(mem, id, s => (species(s).diet === 'hunt' ? 2.5 : 0.4));
        delete mem.claims[id];
      }
    }
  }
}

/** Where each living player probably is during this round's action phase. */
export function positionGuess(view: GameView, mem: BotMemory, id: string): Partial<Record<RegionId, number>> {
  const p = view.players.find(q => q.id === id);
  if (!p?.alive) return {};
  const seen = mem.seenAt[id];
  const anchor = p.drop ?? (seen && seen.round === view.round ? seen.region : null);
  if (anchor) {
    const out: Partial<Record<RegionId, number>> = { [anchor]: 0.62 };
    const next = REGIONS.filter(r => isAdjacent(anchor, r.id));
    for (const r of next) out[r.id] = 0.38 / next.length;
    return out;
  }
  return dropGuess(view, mem, id);
}

/** Before drops are revealed: stated plans first, then the pull of food. */
export function dropGuess(view: GameView, mem: BotMemory, id: string): Partial<Record<RegionId, number>> {
  const plan = mem.plans[id];
  const weightsByRegion = REGIONS.map(r => [r.id, view.resources[r.id] > 0 ? 1 : 0.3] as const);
  const total = weightsByRegion.reduce((sum, [, w]) => sum + w, 0);
  const out: Partial<Record<RegionId, number>> = {};
  for (const [r, w] of weightsByRegion) out[r] = (w / total) * (plan?.round === view.round ? 0.4 : 1);
  if (plan?.round === view.round) out[plan.region] = (out[plan.region] || 0) + 0.6;
  return out;
}
