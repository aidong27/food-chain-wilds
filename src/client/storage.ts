/**
 * Browser storage that never throws: private windows, blocked site data and
 * full quotas just behave like an empty store.
 */
type Area = 'local' | 'session';

function area(kind: Area): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readText(kind: Area, key: string): string | null {
  try {
    return area(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeText(kind: Area, key: string, value: string | null) {
  try {
    if (value === null) area(kind)?.removeItem(key);
    else area(kind)?.setItem(key, value);
  } catch {
    // Storage is a convenience only.
  }
}

export function readJson<T>(kind: Area, key: string): T | null {
  const text = readText(kind, key);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    writeText(kind, key, null);
    return null;
  }
}

export function writeJson(kind: Area, key: string, value: unknown) {
  writeText(kind, key, value === null ? null : JSON.stringify(value));
}

export const KEYS = {
  name: 'foodchain-name',
  sound: 'foodchain-sound',
  difficulty: 'foodchain-difficulty',
  /** Seat credentials for an online room; one per tab. */
  session: 'foodchain-session',
  /** The solo match in progress, kept across reloads. */
  solo: 'foodchain-solo',
  /** Marks that this tab was in a solo match, so a reload resumes it directly. */
  soloActive: 'foodchain-solo-active',
  welcomed: 'foodchain-welcomed',
} as const;
