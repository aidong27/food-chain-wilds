/**
 * Runs computer players. Each bot looks at its own GameView, decides, and acts
 * through the same rule functions people use.
 */
import { REGIONS, RULES, isRegion, type RegionId } from '../data';
import { chance, pick, rand, shuffle } from '../rng';
import { hide, move, postMessage, scream, useSkill } from '../rules';
import type { BotMemory, Command, Game, Player, RoundScript } from '../types';
import { playerView } from '../view';
import { chooseAction, chooseDrop, chooseFood, chooseGuesses, think, type Mind } from './brain';
import { newMemory } from './knowledge';
import { composeOpener, composePublic, composeReaction, composeReply } from './talk';

export function initBotMemory(g: Game, p: Player): BotMemory {
  const mem = newMemory(Math.floor(rand(g) * 4));
  const persona = g.script?.personas?.[p.seat];
  if (persona !== undefined) mem.persona = persona;
  mem.cover = g.script?.covers?.[p.seat] ?? null;
  return mem;
}

/** What the match script fixes for this round, if anything. */
function scripted(g: Game): RoundScript | undefined {
  return g.script?.rounds?.[g.round];
}

const bySeat = (g: Game, seat: number | undefined) => g.players.find(p => p.seat === seat);

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
  const script = scripted(g)?.talk;
  if (script) {
    for (const line of script) {
      const bot = bySeat(g, line.seat);
      if (bot?.bot && bot.alive) say(g, bot, line.to ? bySeat(g, line.to)?.id || '' : 'all', line.text);
    }
    return;
  }
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

/** Somewhere with food that is not `avoid`, or anywhere else if food is that scarce. */
function awayFrom(g: Game, avoid: RegionId | null | undefined): RegionId {
  const others = REGIONS.filter(r => r.id !== avoid);
  const fed = others.filter(r => g.resources[r.id] > 0);
  return pick(g, fed.length ? fed : others).id;
}

export function botsDrop(g: Game) {
  const script = scripted(g)?.drop;
  const human = g.players.find(p => !p.bot && p.alive);
  for (const bot of livingBots(g)) {
    if (bot.drop) continue;
    const planned = script?.[bot.seat];
    if (planned === 'human' && human?.drop) bot.drop = human.drop;
    else if (planned === 'away') bot.drop = awayFrom(g, human?.drop);
    else bot.drop = planned && planned !== 'human' ? planned : chooseDrop(mindOf(g, bot));
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
  const idle = scripted(g)?.idle ?? [];
  for (const bot of livingBots(g)) {
    if (idle.includes(bot.seat)) continue;
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
  const script = scripted(g)?.food;
  for (const bot of livingBots(g)) {
    if (bot.food) continue;
    const planned = script?.[bot.seat];
    const { choice, target } = planned ? { choice: planned.choice, target: bySeat(g, planned.target)?.id } : chooseFood(mindOf(g, bot));
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
