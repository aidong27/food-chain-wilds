/**
 * The per-player projection of a game. This is the only game data that leaves
 * the server for a player, and the only data a computer player may reason on.
 */
import { REGIONS, RULES, region, type RegionId, type SpeciesId } from './data';
import type { Body, Call, Difficulty, Entry, Game, Mode, NightRecord, Player, Stage } from './types';

/**
 * Raised whenever mixed versions could not play together, including rule changes the client displays
 * (3: rabbit hunger from 2.1 and the shorter round of 2.3, where talk and drop share a phase).
 */
export const PROTOCOL_VERSION = 3;

export interface PlayerSummary {
  id: string;
  name: string;
  seat: number;
  bot: boolean;
  alive: boolean;
  ready: boolean;
  voice: boolean;
  called: boolean;
  /** Public after every drop is locked in. */
  drop: RegionId | null;
  /** Known only for yourself, the dead, and everyone at the end. */
  animal: SpeciesId | null;
  diedRound: number | null;
  score: number | null;
  hp: number | null;
  meals: number | null;
  hunts: number | null;
  guesses: Record<string, SpeciesId> | null;
}

export type ViewEntry = Omit<Entry, 'scope'>;

export interface GameView {
  protocol: number;
  code: string;
  mode: Mode;
  difficulty: Difficulty;
  host: string;
  phase: Stage;
  round: number;
  deadline: number;
  /** Server clock when the view was made, so clients can correct for skew. */
  now: number;
  me: Player | null;
  players: PlayerSummary[];
  /** Trace lists for regions you can see, null for the rest. */
  traces: Record<RegionId, string[] | null>;
  resources: Record<RegionId, number>;
  bodies: Body[];
  log: ViewEntry[];
  callIndex: number;
  call: Call | null;
  event: string;
  /** Every night as it really happened, revealed once the match is over. */
  history: NightRecord[] | null;
}

/** Traces appear once everyone has moved: from the calls (online) or the meal (solo) onwards. */
const TRACE_STAGES: Stage[] = ['call', 'food', 'settle', 'finished'];

export function visibleRegions(location: RegionId): RegionId[] {
  return [location, ...region(location).adjacent];
}

export function playerView(g: Game, id: string, now = Date.now()): GameView {
  const me = g.players.find(p => p.id === id);
  const started = g.phase !== 'lobby';
  const finished = g.phase === 'finished';
  const visible = me && started ? visibleRegions(me.location) : [];
  const showTraces = TRACE_STAGES.includes(g.phase);
  const dropsPublic = !['lobby', 'drop'].includes(g.phase);
  return {
    protocol: PROTOCOL_VERSION,
    code: g.code,
    mode: g.mode,
    difficulty: g.difficulty,
    host: g.host,
    phase: g.phase,
    round: g.round,
    deadline: g.deadline,
    now,
    me: me && started ? structuredClone(me) : null,
    players: g.players.map(p => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      bot: p.bot,
      alive: p.alive,
      ready: p.ready,
      voice: p.voice,
      called: p.called,
      drop: dropsPublic ? p.drop : null,
      animal: finished || (started && (!p.alive || p.id === id)) ? p.animal : null,
      diedRound: started && !p.alive ? p.diedRound : null,
      score: finished ? p.score : null,
      hp: finished ? p.hp : null,
      meals: finished ? p.meals : null,
      hunts: finished ? p.hunts : null,
      guesses: finished ? { ...p.guesses } : null,
    })),
    traces: Object.fromEntries(
      REGIONS.map(r => [r.id, showTraces && visible.includes(r.id) ? [...(g.traces[r.id] || [])] : null]),
    ) as Record<RegionId, string[] | null>,
    resources: { ...g.resources },
    bodies: g.bodies.filter(b => visible.includes(b.location)).map(b => ({ ...b })),
    log: g.log
      .filter(l => l.scope === 'all' || l.scope.includes(id))
      .slice(-RULES.viewLogLimit)
      .map(({ scope: _scope, ...entry }) => entry),
    callIndex: g.callIndex,
    call: g.call ? { ...g.call } : null,
    event: g.event,
    history: finished ? structuredClone(g.history ?? []) : null,
  };
}
