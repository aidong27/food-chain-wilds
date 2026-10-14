/**
 * Lifetime results kept on this device: how many nights you have survived, your
 * best score, and which animals you have already brought through all seven nights.
 */
import { SPECIES, type SpeciesId } from '../game/data';
import type { GameView } from '../game/view';
import { KEYS, readJson, writeJson } from './storage';

export interface SpeciesRecord {
  games: number;
  survived: number;
  best: number;
}

export interface Records {
  games: number;
  survived: number;
  best: number;
  species: Partial<Record<SpeciesId, SpeciesRecord>>;
}

export interface MatchResult {
  animal: SpeciesId;
  survived: boolean;
  score: number;
  /** The first time you survived as this animal. */
  firstSurvival: boolean;
  /** Beat an earlier best score. */
  newBest: boolean;
}

export const emptyRecords = (): Records => ({ games: 0, survived: 0, best: 0, species: {} });

export function loadRecords(): Records {
  const saved = readJson<Records>('local', KEYS.records);
  return saved && typeof saved.games === 'number' && saved.species && typeof saved.species === 'object' ? saved : emptyRecords();
}

/** Adds one finished match to the records. */
export function addResult(
  records: Records,
  animal: SpeciesId,
  survived: boolean,
  score: number,
): { records: Records; result: MatchResult } {
  const before = records.species[animal] ?? { games: 0, survived: 0, best: 0 };
  return {
    records: {
      games: records.games + 1,
      survived: records.survived + Number(survived),
      best: Math.max(records.best, score),
      species: {
        ...records.species,
        [animal]: { games: before.games + 1, survived: before.survived + Number(survived), best: Math.max(before.best, score) },
      },
    },
    result: {
      animal,
      survived,
      score,
      firstSurvival: survived && before.survived === 0,
      newBest: records.games > 0 && score > records.best,
    },
  };
}

/** Saves the match that just ended from your own view of it. */
export function recordMatch(view: GameView): { records: Records; result: MatchResult } | null {
  const me = view.me;
  const score = view.players.find(p => p.id === me?.id)?.score;
  if (!me || score === null || score === undefined) return null;
  const out = addResult(loadRecords(), me.animal, me.alive, score);
  writeJson('local', KEYS.records, out.records);
  return out;
}

/** Animals you have survived all seven nights with. */
export const survivedAs = (records: Records): SpeciesId[] => SPECIES.filter(s => (records.species[s.id]?.survived ?? 0) > 0).map(s => s.id);
