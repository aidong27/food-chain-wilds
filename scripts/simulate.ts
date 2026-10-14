/**
 * Plays many all-computer matches and prints survival statistics per animal.
 *   npx tsx scripts/simulate.ts [games=400]
 */
import { SPECIES, species, type SpeciesId } from '../src/game/data';
import { advance, createGame, fillWithBots, startGame } from '../src/game/engine';
import type { Game } from '../src/game/types';

export interface Stats {
  games: number;
  survived: number;
  score: number;
  meals: number;
  hunts: number;
  causes: Record<string, number>;
}

export function playAllBots(seed: number): Game {
  const g = createGame('SIM000', 'solo', seed, 0);
  fillWithBots(g);
  startGame(g, undefined, 0);
  for (let steps = 0; g.phase !== 'finished' && steps < 200; steps++) advance(g, 0);
  if (g.phase !== 'finished') throw new Error(`seed ${seed} did not finish`);
  return g;
}

export function simulate(games: number, firstSeed = 1): Record<SpeciesId, Stats> {
  const stats = Object.fromEntries(
    SPECIES.map(s => [s.id, { games: 0, survived: 0, score: 0, meals: 0, hunts: 0, causes: {} as Record<string, number> }]),
  ) as Record<SpeciesId, Stats>;
  for (let seed = firstSeed; seed < firstSeed + games; seed++) {
    const g = playAllBots(seed);
    for (const p of g.players) {
      const s = stats[p.animal];
      s.games++;
      s.survived += Number(p.alive);
      s.score += p.score;
      s.meals += p.meals;
      s.hunts += p.hunts;
      if (!p.alive) {
        const death = g.log.find(l => l.tag === 'death' && l.actor === p.id);
        const cause = death?.text.match(/因(.+?)退出/)?.[1] || '?';
        s.causes[cause] = (s.causes[cause] || 0) + 1;
      }
    }
  }
  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const games = Number(process.argv[2] || 400);
  const started = performance.now();
  const stats = simulate(games);
  const ms = performance.now() - started;
  console.log(`${games} games, ${(ms / games).toFixed(1)} ms per game`);
  console.log('animal   survive  score  meals  hunts  deaths');
  let total = 0;
  for (const s of SPECIES) {
    const r = stats[s.id];
    total += r.survived;
    const pct = ((100 * r.survived) / r.games).toFixed(0).padStart(3);
    const causes = Object.entries(r.causes)
      .map(([k, v]) => `${k}${((100 * v) / r.games).toFixed(0)}%`)
      .join(' ');
    console.log(
      `${species(s.id).name.padEnd(4, '　')}  ${pct}%   ${(r.score / r.games).toFixed(1).padStart(5)}  ${(r.meals / r.games).toFixed(2)}   ${(r.hunts / r.games).toFixed(2)}   ${causes}`,
    );
  }
  console.log(`average survivors per game: ${(total / games).toFixed(2)} / 8`);
}
