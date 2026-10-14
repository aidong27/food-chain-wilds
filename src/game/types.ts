import type { FoodChoice, PhaseId, RegionId, SpeciesId } from './data';

export type Mode = 'solo' | 'online';
/** How sharp computer hunters are in solo practice. */
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Stage = 'lobby' | PhaseId | 'finished';

export interface Player {
  id: string;
  name: string;
  seat: number;
  bot: boolean;
  animal: SpeciesId;
  hp: number;
  sp: number;
  alive: boolean;
  /** Round in which the player died, for the night report. */
  diedRound: number;
  location: RegionId;
  drop: RegionId | null;
  actions: number;
  ready: boolean;
  skillUsed: boolean;
  /** Extra damage on the next successful hunt this round. */
  boost: number;
  /** Boar hide: every hunt against this player deals 1 less damage (minimum 1). */
  guard: boolean;
  hunger: number;
  fed: boolean;
  food: FoodChoice | null;
  target: string;
  privateCount: number;
  publicCount: number;
  voice: boolean;
  called: boolean;
  meals: number;
  hunts: number;
  guesses: Record<string, SpeciesId>;
  score: number;
}

export type EntryKind = 'system' | 'private' | 'public' | 'clue';

/**
 * Structured meaning of a log line. The text is for people; tags and the
 * optional fields let the interface and the bots react without parsing text.
 */
export type EntryTag =
  | 'round'
  | 'reveal'
  | 'death'
  | 'finish'
  | 'move'
  | 'hide'
  | 'scream'
  | 'skill'
  | 'overdraw'
  | 'food-attempt'
  | 'hit'
  | 'attacked'
  | 'miss'
  | 'fed'
  | 'starved'
  | 'hunger';

export interface Entry {
  id: number;
  round: number;
  text: string;
  /** Who may read this line: everyone, or only the listed player ids. */
  scope: 'all' | string[];
  kind: EntryKind;
  tag?: EntryTag;
  /** Sender and recipient of a message. */
  from?: string;
  to?: string;
  /** Subject and object of an event, e.g. hunter and prey. */
  actor?: string;
  target?: string;
  region?: RegionId;
  amount?: number;
  animal?: SpeciesId;
  /** Skill that produced the line, for skill results. */
  skill?: SpeciesId;
}

export type EntryInput = Omit<Entry, 'id' | 'round' | 'scope' | 'kind' | 'text'> & {
  scope?: Entry['scope'];
  kind?: EntryKind;
};

export interface Body {
  location: RegionId;
  /** Last round in which the carcass can still be eaten. */
  expires: number;
}

export interface Call {
  from: string;
  to: string;
  accepted: boolean;
}

/** Long-lived memory of a computer player, built only from what that player has seen. */
export interface BotMemory {
  /** Highest log id already processed. */
  seen: number;
  /** Relative weights per player for each species, in SPECIES order. */
  belief: Record<string, number[]>;
  /** Identity each player last claimed in public or to this bot. */
  claims: Record<string, SpeciesId>;
  /** Region each player said they were heading to, with the round. */
  plans: Record<string, { region: RegionId; round: number }>;
  /** Identity this bot tells others it has, so its lies stay consistent. */
  cover: SpeciesId | null;
  /** The accusation this bot is about to make, so it can jump the queue. */
  lastAccusation?: string;
  /** Where this bot said it would go this round. */
  intent: { region: RegionId; round: number } | null;
  /** 0 honest and talkative · 1 cautious · 2 sly · 3 quiet. */
  persona: number;
  /** Who attacked this bot, most recent last. */
  attackers: string[];
  /** Danger reports: region and round where a threat was sensed. */
  danger: { region: RegionId; round: number }[];
  /** Last place each player was seen, from public drops or traces. */
  seenAt: Record<string, { region: RegionId; round: number }>;
}

/**
 * Choices fixed in advance for computer players, by seat. The guided tutorial
 * uses one so its story plays out the same way every time; normal matches have none.
 */
export interface Script {
  /** Identity of every seat, seat 1 first. */
  roles?: SpeciesId[];
  /** The identity a bot claims when it lies, by seat. */
  covers?: Partial<Record<number, SpeciesId>>;
  /** Bot personas by seat (see BotMemory.persona). */
  personas?: Partial<Record<number, number>>;
  rounds?: Partial<Record<number, RoundScript>>;
}

export interface RoundScript {
  /** Replaces the bots' own chatter at the start of the round; `to` is a seat, or everyone. */
  talk?: { seat: number; to?: number; text: string }[];
  /** Where bots start: 'human' is wherever the human chose, 'away' any region with food except that one. */
  drop?: Partial<Record<number, RegionId | 'human' | 'away'>>;
  /** Seats that spend no actions this round. */
  idle?: number[];
  /** Food choices; `target` is a seat. */
  food?: Partial<Record<number, { choice: FoodChoice; target?: number }>>;
}

/** Where one animal was and how it fared in one night, kept for the final reveal. */
export interface NightPlayer {
  id: string;
  drop: RegionId | null;
  /** Where the animal stood when food was resolved. */
  location: RegionId;
  food: FoodChoice | null;
  fed: boolean;
  hp: number;
  alive: boolean;
}

export interface NightRecord {
  round: number;
  /** Everyone who was alive when the night began. */
  players: NightPlayer[];
  hunts: { hunter: string; prey: string; damage: number }[];
}

export interface Game {
  /** Bumped whenever the stored shape changes, so stale rooms can be discarded. */
  version: number;
  code: string;
  mode: Mode;
  difficulty: Difficulty;
  host: string;
  phase: Stage;
  round: number;
  /** Epoch milliseconds when the current phase ends; 0 when the human sets the pace. */
  deadline: number;
  players: Player[];
  traces: Partial<Record<RegionId, string[]>>;
  resources: Record<RegionId, number>;
  bodies: Body[];
  log: Entry[];
  serial: number;
  seed: number;
  callIndex: number;
  call: Call | null;
  event: string;
  createdAt: number;
  bots: Record<string, BotMemory>;
  /** One record per resolved night; secret until the match ends. */
  history?: NightRecord[];
  script?: Script;
}

export type Command =
  | { type: 'start'; animal?: SpeciesId }
  | { type: 'bots' }
  | { type: 'ready' }
  | { type: 'guess'; target: string; animal: SpeciesId | '' }
  | { type: 'message'; target: string; text: string }
  | { type: 'voice'; joined: boolean }
  | { type: 'call'; target: string }
  | { type: 'call-answer'; accept: boolean }
  | { type: 'hangup' }
  | { type: 'drop'; region: RegionId }
  | { type: 'food'; choice: FoodChoice; target?: string }
  | { type: 'move'; region: RegionId }
  | { type: 'hide' }
  | { type: 'scream' }
  | { type: 'skill'; region?: RegionId };

export type CommandType = Command['type'];

export class RuleError extends Error {}
