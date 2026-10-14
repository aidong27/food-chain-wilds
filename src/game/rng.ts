import type { Game } from './types';

/** Deterministic LCG stored in the game, so a seed replays the same match. */
export function rand(g: Game): number {
  g.seed = (Math.imul(g.seed, 1664525) + 1013904223) >>> 0;
  return g.seed / 4294967296;
}

export function pick<T>(g: Game, values: readonly T[]): T {
  return values[Math.floor(rand(g) * values.length)];
}

export function chance(g: Game, probability: number): boolean {
  return rand(g) < probability;
}

/** Picks a key with probability proportional to its non-negative weight. */
export function weighted<T>(g: Game, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  if (total <= 0) return pick(g, entries)[0];
  let roll = rand(g) * total;
  for (const [value, w] of entries) {
    roll -= Math.max(0, w);
    if (roll < 0) return value;
  }
  return entries[entries.length - 1][0];
}

export function shuffle<T>(g: Game, values: T[]): T[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rand(g) * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
