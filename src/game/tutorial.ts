/**
 * The guided first match. You are the deer; seat 2 is a wolf that claims to be
 * a rabbit. On the first night it follows you to your starting region, so
 * the deer's alertness has something real to find, and bites the boar
 * instead if you get away. On the second night the bitten boar names it in
 * public. After that the match continues as ordinary easy practice.
 */
import type { SpeciesId } from './data';
import { addPlayer, createGame, startGame } from './engine';
import type { Game, Script } from './types';

export const TUTORIAL_CODE = 'LEARN1';
const SEED = 20261014;

/** Seat 1 is the player. */
const CAST: SpeciesId[] = ['deer', 'wolf', 'rabbit', 'boar', 'crow', 'fox', 'lynx', 'snake'];

export const TUTORIAL_SEATS = { you: 1, wolf: 2, rabbit: 3, boar: 4 } as const;

const SCRIPT: Script = {
  roles: CAST,
  covers: { 2: 'rabbit' },
  // Talkative and straightforward, so replies to the player stay on script.
  personas: { 2: 0, 3: 0, 4: 0 },
  rounds: {
    1: {
      talk: [
        { seat: 2, text: '我是野兔，只想安安静静找口吃的。' },
        { seat: 3, text: '我才是野兔！2号，你为什么要冒充我？' },
        { seat: 5, text: '痕迹可能是旧的，我不会只凭足迹判断。' },
      ],
      // Only the wolf and the boar share your first starting region.
      drop: { 2: 'human', 4: 'human', 3: 'away', 5: 'away', 6: 'away', 7: 'away', 8: 'away' },
      idle: [2, 4],
      food: { 2: { choice: 'hunt', target: 4 }, 4: { choice: 'forage' } },
    },
    2: {
      talk: [
        { seat: 4, text: '昨夜2号咬了我！Ta 根本不是野兔，是捕食者。' },
        { seat: 2, text: '血口喷人。看痕迹再说话。' },
        { seat: 3, text: '我早说过，2号不是野兔。' },
      ],
      // Far from food, hunting someone else: the second night is yours to play.
      drop: { 2: 'cliff' },
      idle: [2],
      food: { 2: { choice: 'hunt', target: 3 } },
    },
  },
};

export function createTutorialGame(playerId: string, name: string, now = Date.now()): Game {
  const g = createGame(TUTORIAL_CODE, 'solo', SEED, now);
  g.difficulty = 'easy';
  g.script = structuredClone(SCRIPT);
  addPlayer(g, playerId, name);
  startGame(g, undefined, now);
  return g;
}
