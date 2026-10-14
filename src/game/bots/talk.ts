/** What computer players say: public chatter, replies and the occasional private approach. */
import { canEat, species, type SpeciesId } from '../data';
import type { PlayerSummary } from '../view';
import { coverStory, honestAbout, planDrop, topHunter, topThreat, type Mind } from './brain';
import { threatOf } from './knowledge';
import { PHRASES, choose, clip, parseStatement, regionName, speciesName, tag } from './language';

const find = (m: Mind, id: string | undefined): PlayerSummary | undefined => m.view.players.find(p => p.id === id);

/** How eager each persona is to speak in public each round. */
const TALKATIVE = [0.75, 0.5, 0.6, 0.25];

export interface Line {
  text: string;
  /** Urgent news (being bitten) is always said, whatever the crowd. */
  urgent: boolean;
}

/** One public line for the start of the talk phase, or null to stay silent. */
export function composePublic(m: Mind): Line | null {
  const text = chooseLine(m);
  if (!text) return null;
  return { text, urgent: text === m.mem.lastAccusation };
}

function chooseLine(m: Mind): string | null {
  const { view, mem, rng } = m;
  const round = view.round;
  const lastRound = (r: number) => r === round - 1 || r === round;

  // Someone bit me last night: say so, loudly.
  const attacker = find(
    m,
    [...mem.attackers].reverse().find(id => find(m, id)?.alive),
  );
  const bitten = attacker && view.log.some(l => l.tag === 'attacked' && l.actor === attacker.id && lastRound(l.round));
  if (bitten && rng() < 0.9) return (mem.lastAccusation = clip(choose(rng, PHRASES.accuse)(tag(attacker))));

  if (rng() > TALKATIVE[mem.persona]) return null;

  const warning = mem.danger.find(d => d.round === round - 1);
  if (warning && species(m.me.animal).diet !== 'hunt' && rng() < 0.7) return clip(choose(rng, PHRASES.warn)(regionName(warning.region)));

  const cover = coverStory(m);
  const impostor = Object.entries(mem.claims).find(([id, s]) => s === cover && find(m, id)?.alive);
  if (impostor && rng() < 0.75) return clip(choose(rng, PHRASES.liar)(tag(find(m, impostor[0])!), speciesName(cover)));

  const fresh = view.players.find(p => !p.alive && p.animal && p.diedRound === round - 1);
  if (fresh && rng() < 0.25) return clip(choose(rng, PHRASES.mourn)(tag(fresh), speciesName(fresh.animal!)));

  const roll = rng();
  if (round <= 2 && roll < 0.45) return clip(choose(rng, PHRASES.claim)(speciesName(cover)));
  if (roll < 0.62) {
    const honest = honestAbout(m);
    return clip(choose(rng, PHRASES.plan)(regionName(planDrop(m, honest))));
  }
  const suspect =
    species(m.me.animal).diet === 'hunt'
      ? // Hunters muddy the water by pointing at someone they plan to eat.
        m.view.players.find(p => p.alive && p.id !== m.me.id && mem.claims[p.id] && canEat(m.me.animal, mem.claims[p.id]))
      : topThreat(m) || topHunter(m);
  if (suspect && roll < 0.85) return clip(choose(rng, PHRASES.suspect)(tag(suspect)));
  const sighting = Object.entries(mem.seenAt).find(([id, s]) => s.round === round - 1 && find(m, id)?.alive && id !== m.me.id);
  if (sighting && rng() < 0.5) return clip(choose(rng, PHRASES.saw)(tag(find(m, sighting[0])!), regionName(sighting[1].region)));
  return choose(rng, PHRASES.idle);
}

/** Reply to a private message from another player. */
export function composeReply(m: Mind, fromId: string, text: string): string | null {
  const { rng } = m;
  const from = find(m, fromId);
  if (!from) return null;
  const said = parseStatement(text, m.view);
  const me = m.me.animal;
  // Nobody hands their whereabouts to someone they think could eat them.
  const wary = threatOf(m.odds, fromId, me) >= 0.4;

  if (said.question === 'identity') {
    if ((m.mem.persona === 3 || wary) && rng() < 0.5) return choose(rng, PHRASES.replyDodge);
    return clip(choose(rng, PHRASES.replyIdentity)(speciesName(coverStory(m))));
  }
  if (said.question === 'location') {
    if ((m.mem.persona === 3 || wary) && rng() < 0.4) return choose(rng, PHRASES.replyNoPlan);
    return clip(choose(rng, PHRASES.replyLocation)(regionName(planDrop(m, honestAbout(m) && !wary))));
  }
  if (said.question === 'suspect') {
    const suspect = topThreat(m) || topHunter(m, 0.45);
    return suspect ? clip(choose(rng, PHRASES.replySuspect)(tag(suspect))) : choose(rng, PHRASES.replyNoSuspect);
  }
  if (said.claim) return clip(acknowledgeClaim(m, said.claim));
  if (said.region) {
    const friendly = species(me).diet !== 'hunt';
    return clip(choose(rng, friendly ? PHRASES.ackPlanAvoid : PHRASES.ackPlanNote)(regionName(said.region)));
  }
  if (said.accused.includes(m.me.seat)) return choose(rng, PHRASES.defend);
  return choose(rng, PHRASES.ackOther);
}

function acknowledgeClaim(m: Mind, claim: SpeciesId): string {
  const { rng } = m;
  if (canEat(m.me.animal, claim)) return choose(rng, PHRASES.ackPreyClaim)(speciesName(claim));
  if (species(claim).diet !== 'hunt' && species(m.me.animal).diet !== 'hunt')
    return choose(rng, PHRASES.ackFriendClaim)(speciesName(claim));
  return choose(rng, PHRASES.ackOther);
}

/** Public reaction when a person speaks to everyone. */
export function composeReaction(m: Mind, fromId: string, text: string): string | null {
  const { rng } = m;
  const from = find(m, fromId);
  if (!from) return null;
  const said = parseStatement(text, m.view);
  const cover = coverStory(m);
  if (said.claim && said.claim === cover && rng() < 0.8) return clip(choose(rng, PHRASES.liar)(tag(from), speciesName(cover)));
  if (said.accused.includes(m.me.seat)) return choose(rng, PHRASES.defend);
  if (said.question === 'suspect' && rng() < 0.5) {
    const suspect = topThreat(m) || topHunter(m, 0.45);
    if (suspect && suspect.id !== fromId) return clip(choose(rng, PHRASES.suspect)(tag(suspect)));
  }
  return null;
}

/** A private approach to a person: hunters fish for locations, others look for allies. */
export function composeOpener(m: Mind, to: PlayerSummary): string | null {
  const claim = m.mem.claims[to.id];
  if (claim) return clip(acknowledgeClaim(m, claim));
  return choose(m.rng, PHRASES.opener);
}
