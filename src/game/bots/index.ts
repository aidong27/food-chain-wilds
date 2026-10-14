/**
 * Runs computer players. Each bot looks at its own GameView, decides, and acts
 * through the same rule functions people use.
 */
import { RULES, isRegion } from '../data';
import { chance, rand, shuffle } from '../rng';
import { hide, move, postMessage, scream, useSkill } from '../rules';
import type { BotMemory, Command, Game, Player } from '../types';
import { playerView } from '../view';
import { chooseAction, chooseDrop, chooseFood, chooseGuesses, think, type Mind } from './brain';
import { newMemory } from './knowledge';
import { composeOpener, composePublic, composeReaction, composeReply } from './talk';

export function initBotMemory(g: Game, _p: Player): BotMemory {
  return newMemory(Math.floor(rand(g) * 4));
}

function memoryOf(g: Game, p: Player): BotMemory {
  return (g.bots[p.id] ||= newMemory(Math.floor(rand(g) * 4)));
}

function mindOf(g: Game, p: Player): Mind {
  return think(playerView(g, p.id, 0), memoryOf(g, p), () => rand(g));
}

function livingBots(g: Game): Player[] {
  return shuffle(
    g,
    g.players.filter(p => p.bot && p.alive),
  );
}

function say(g: Game, bot: Player, target: string, text: string | null) {
  if (!text) return;
  try {
    postMessage(g, bot, target, text);
  } catch {
    // Out of quota or the listener died; bots simply stay quiet.
  }
}

/** Start of the talk phase: a few bots speak up, some approach people privately. */
export function botsChat(g: Game) {
  const lines: { bot: Player; text: string; urgent: boolean }[] = [];
  for (const bot of livingBots(g)) {
    const m = mindOf(g, bot);
    const line = composePublic(m);
    if (line) lines.push({ bot, ...line });
    const humans = g.players.filter(p => p.alive && !p.bot);
    if (humans.length && g.round <= 4 && chance(g, 0.12)) {
      const to = humans[Math.floor(rand(g) * humans.length)];
      const summary = m.view.players.find(p => p.id === to.id)!;
      say(g, bot, to.id, composeOpener(m, summary));
    }
  }
  // Victims always speak; otherwise only a few voices, so the camp is not a wall of text.
  const urgent = lines.filter(l => l.urgent);
  const rest = lines.filter(l => !l.urgent).slice(0, Math.max(0, 3 - urgent.length));
  for (const line of [...urgent, ...rest]) say(g, line.bot, 'all', line.text);
}

export function botsDrop(g: Game) {
  for (const bot of livingBots(g)) {
    if (bot.drop) continue;
    bot.drop = chooseDrop(mindOf(g, bot));
  }
}

function perform(g: Game, bot: Player, cmd: Command) {
  switch (cmd.type) {
    case 'move':
      return move(g, bot, cmd.region);
    case 'hide':
      return hide(g, bot);
    case 'scream':
      return scream(g, bot);
    case 'skill':
      return useSkill(g, bot, isRegion(cmd.region) ? cmd.region : undefined);
  }
}

export function botsAct(g: Game) {
  for (const bot of livingBots(g)) {
    for (let i = 0; i < RULES.actionsPerRound && bot.alive && bot.actions > 0; i++) {
      const cmd = chooseAction(mindOf(g, bot));
      if (!cmd) break;
      try {
        perform(g, bot, cmd);
      } catch {
        break;
      }
    }
  }
}

export function botsEat(g: Game) {
  for (const bot of livingBots(g)) {
    if (bot.food) continue;
    const { choice, target } = chooseFood(mindOf(g, bot));
    bot.food = choice;
    bot.target = target || '';
  }
}

export function botReply(g: Game, bot: Player, from: Player, text: string) {
  if (!bot.alive || !from.alive) return;
  say(g, bot, from.id, composeReply(mindOf(g, bot), from.id, text));
}

export function botsHearPublic(g: Game, from: Player, text: string) {
  let replies = 0;
  for (const bot of livingBots(g)) {
    if (replies >= 2 || bot.publicCount >= RULES.publicMessages) continue;
    const line = composeReaction(mindOf(g, bot), from.id, text);
    if (line) {
      say(g, bot, 'all', line);
      replies++;
    }
  }
}

export function botsGuess(g: Game) {
  for (const bot of g.players.filter(p => p.bot && p.alive)) {
    bot.guesses = chooseGuesses(mindOf(g, bot));
  }
}
