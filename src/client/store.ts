/**
 * Application state and the actions the interface can take. Components read
 * state through useApp(); everything else goes through the exported actions.
 */
import { useEffect, useReducer } from 'preact/hooks';
import { phaseInfo, type PhaseId, type RegionId, type SpeciesId } from '../game/data';
import type { Command, Difficulty } from '../game/types';
import type { GameView, ViewEntry } from '../game/view';
import {
  LocalLink,
  OnlineLink,
  checkServer,
  postJson,
  savedSolo,
  storedSession,
  type Link,
  type LinkEvents,
  type ServerStatus,
  type Session,
} from './links';
import { loadRecords, recordMatch, type MatchResult, type Records } from './records';
import { play, setSound, soundEnabled } from './sound';
import { KEYS, readText, writeText } from './storage';
import { gameUrls } from './urls';
import { Voice } from './voice';

export const urls = gameUrls(location.origin, import.meta.env.BASE_URL, import.meta.env.VITE_BACKEND_ORIGIN || location.origin);

export interface Banner {
  id: number;
  /** A new night gets the full-screen title; other phases a small notice. */
  kind: 'night' | 'phase';
  title: string;
  detail: string;
}

export interface TutorialProgress {
  /** Index into the tutorial's steps. */
  step: number;
  /** The step on screen, for components that help with it. */
  id: string | null;
}

export type TutorialStatus = 'offered' | 'skipped' | 'done' | null;

export interface AppState {
  view: GameView | null;
  link: 'local' | 'online' | null;
  /** Your seat id in the current match. */
  playerId: string;
  connected: boolean;
  busy: boolean;
  selected: RegionId;
  toast: { id: number; text: string } | null;
  banner: Banner | null;
  sound: boolean;
  server: ServerStatus;
  /** Server clock minus local clock, for accurate countdowns. */
  clockOffset: number;
  hasSave: boolean;
  /** First solo game: show one short tip per phase. */
  coach: boolean;
  /** Entries that arrived since the player last looked at the chat tab. */
  unreadChat: number;
  /** The guided tutorial, while it runs. */
  tutorial: TutorialProgress | null;
  /** A brief full-screen cue when you are bitten or eat. */
  flash: { id: number; kind: 'hurt' | 'fed' } | null;
  records: Records;
  /** How the match that just ended changed your records. */
  result: MatchResult | null;
}

let state: AppState = {
  view: null,
  link: null,
  playerId: '',
  connected: false,
  busy: false,
  selected: 'forest',
  toast: null,
  banner: null,
  sound: soundEnabled(),
  server: 'checking',
  clockOffset: 0,
  hasSave: !!savedSolo(),
  coach: !readText('local', KEYS.welcomed),
  unreadChat: 0,
  tutorial: null,
  flash: null,
  records: loadRecords(),
  result: null,
};

const listeners = new Set<() => void>();

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export const getState = () => state;

export function useApp(): AppState {
  const [, force] = useReducer((n: number, _: void) => n + 1, 0);
  useEffect(() => {
    const listener = () => force();
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return state;
}

// ---------------------------------------------------------------- feedback

let toastTimer = 0;
export function toast(text: string) {
  clearTimeout(toastTimer);
  set({ toast: { id: Date.now(), text } });
  toastTimer = window.setTimeout(() => set({ toast: null }), 4200);
}

let bannerTimer = 0;
function showBanner(kind: Banner['kind'], title: string, detail: string) {
  clearTimeout(bannerTimer);
  set({ banner: { id: Date.now(), kind, title, detail } });
  bannerTimer = window.setTimeout(() => set({ banner: null }), kind === 'night' ? 1400 : 1100);
}

let flashTimer = 0;
function flash(kind: 'hurt' | 'fed') {
  clearTimeout(flashTimer);
  set({ flash: { id: Date.now(), kind } });
  flashTimer = window.setTimeout(() => set({ flash: null }), 900);
}

export function toggleSound() {
  setSound(!state.sound);
  set({ sound: !state.sound });
  if (state.sound) play('phase');
}

// ---------------------------------------------------------------- links

let link: Link | null = null;
let chatOpen = false;
const voice = new Voice(
  (to, signal) => (link instanceof OnlineLink ? link.signal(to, signal) : undefined),
  message => toast(message),
);

/** Reacts to what changed between two views: banners, sounds and alerts. */
function noticeChanges(before: GameView | null, after: GameView) {
  const phaseKey = (v: GameView | null) => (v ? `${v.round}:${v.phase}` : '');
  if (phaseKey(before) !== phaseKey(after)) {
    if (after.me) set({ selected: after.me.location });
    if (after.phase !== 'lobby' && after.phase !== 'finished') {
      const info = phaseInfo(after.phase as PhaseId);
      if (before?.round !== after.round) showBanner('night', `第 ${after.round} 回合`, after.event);
      else showBanner('phase', info.name, info.hint);
    } else {
      clearTimeout(bannerTimer);
      set({ banner: null });
      if (after.phase === 'finished' && after.mode === 'solo' && state.coach) dismissCoach();
    }
    // Only a match seen ending here counts, so reloading the final screen records nothing twice.
    if (before && before.phase !== 'finished' && after.phase === 'finished') {
      const saved = recordMatch(after);
      if (saved) set({ records: saved.records, result: saved.result });
    }
    if (before) play('phase');
  }
  // Online, once everyone else is ready the last person's timer is cut short; say why.
  const hurried =
    before &&
    phaseKey(before) === phaseKey(after) &&
    after.mode === 'online' &&
    after.phase !== 'call' &&
    after.me?.alive &&
    !after.me.ready &&
    after.deadline &&
    after.deadline < before.deadline - 5000;
  if (hurried) toast(`其他人都准备好了，还剩 ${Math.max(1, Math.round((after.deadline - after.now) / 1000))} 秒。`);
  const lastSeen = before?.log.at(-1)?.id ?? Infinity;
  const fresh: ViewEntry[] = before ? after.log.filter(l => l.id > lastSeen) : [];
  const me = after.me?.id;
  for (const entry of fresh) {
    if (entry.tag === 'attacked') {
      play('hurt');
      flash('hurt');
      toast(entry.text);
    } else if (entry.tag === 'death' && entry.actor === me) play('death');
    else if (entry.tag === 'fed') {
      play('good');
      flash('fed');
    }
  }
  const chat = fresh.filter(l => (l.kind === 'public' || l.kind === 'private') && l.from !== me);
  if (chat.length) {
    if (!chatOpen) set({ unreadChat: state.unreadChat + chat.length });
    if (chat.some(l => l.kind === 'private')) play('message');
  }
}

const events: LinkEvents = {
  view(view) {
    const before = state.view;
    set({ view, clockOffset: view.now ? view.now - Date.now() : 0 });
    noticeChanges(before, view);
    if (link instanceof OnlineLink) void voice.sync(view, link.playerId);
  },
  error: toast,
  status(connected) {
    set({ connected });
  },
  ended(reason) {
    toast(reason);
    reset();
  },
  signal(from, signal) {
    void voice.receive(from, signal);
  },
};

function attach(next: Link) {
  link?.close();
  link = next;
  const tutorial = next instanceof LocalLink && next.tutorial !== null ? { step: next.tutorial, id: null } : null;
  set({ link: next.kind, playerId: next.playerId, view: null, connected: false, unreadChat: 0, tutorial, result: null });
}

function reset() {
  link?.close();
  link = null;
  voice.stop();
  set({
    view: null,
    link: null,
    playerId: '',
    connected: false,
    busy: false,
    hasSave: !!savedSolo(),
    unreadChat: 0,
    tutorial: null,
    result: null,
  });
  history.replaceState(null, '', urls.home);
}

export function send(cmd: Command) {
  if (!link) return toast('当前没有进行中的对局。');
  link.send(cmd);
}

export function select(region: RegionId) {
  set({ selected: region });
}

export function setChatOpen(open: boolean) {
  chatOpen = open;
  if (open && state.unreadChat) set({ unreadChat: 0 });
}

// ---------------------------------------------------------------- entry points

export interface SoloChoice {
  name: string;
  animal: SpeciesId | '';
  difficulty: Difficulty;
}

let lastSolo: SoloChoice | null = null;

function rememberName(name: string) {
  writeText('local', KEYS.name, name);
}

export function startSolo(choice: SoloChoice) {
  rememberName(choice.name);
  writeText('local', KEYS.difficulty, choice.difficulty);
  lastSolo = choice;
  attach(LocalLink.start(choice, events));
  window.scrollTo({ top: 0 });
}

export function resumeSolo() {
  const resumed = LocalLink.resume(events);
  if (!resumed) {
    set({ hasSave: false });
    return toast('没有可以继续的练习。');
  }
  attach(resumed);
}

export function playAgain() {
  if (!(link instanceof LocalLink)) return leave();
  const settings = lastSolo ?? { ...link.settings, animal: '' as const };
  link.leave();
  startSolo(settings);
}

export function skipToEnd() {
  if (link instanceof LocalLink) link.skipToEnd();
}

function goOnline(session: Session, onOpen?: () => void) {
  history.replaceState(null, '', `${urls.home}?room=${session.code}`);
  attach(new OnlineLink(session, urls, events, onOpen));
}

export async function createRoom(name: string) {
  if (state.busy) return;
  rememberName(name);
  set({ busy: true });
  try {
    goOnline(await postJson<Session>(urls.api('/api/rooms'), { name, mode: 'online' }));
  } catch (e) {
    toast((e as Error).message);
  } finally {
    set({ busy: false });
  }
}

export async function joinRoom(code: string, name: string) {
  if (state.busy) return;
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(clean)) return toast('请输入 6 位房间码。');
  rememberName(name);
  set({ busy: true });
  try {
    goOnline(await postJson<Session>(urls.api(`/api/rooms/${clean}/join`), { name }));
  } catch (e) {
    toast((e as Error).message);
  } finally {
    set({ busy: false });
  }
}

export function leave() {
  link?.leave();
  reset();
  window.scrollTo({ top: 0 });
}

export async function joinVoice(join: boolean) {
  if (!join) {
    send({ type: 'voice', joined: false });
    voice.stop();
    return;
  }
  try {
    await voice.startMicrophone();
    send({ type: 'voice', joined: true });
  } catch (e) {
    toast((e as Error).message);
  }
}

export async function answerCall(accept: boolean) {
  if (!accept) return send({ type: 'call-answer', accept: false });
  try {
    await voice.startMicrophone();
    send({ type: 'call-answer', accept: true });
  } catch (e) {
    toast((e as Error).message);
  }
}

export async function refreshServer() {
  set({ server: 'checking' });
  set({ server: await checkServer(urls.api('/api/health')) });
}

export function dismissCoach() {
  writeText('local', KEYS.welcomed, '1');
  set({ coach: false });
}

// ---------------------------------------------------------------- tutorial

export function tutorialStatus(): TutorialStatus {
  const status = readText('local', KEYS.tutorial);
  return status === 'offered' || status === 'skipped' || status === 'done' ? status : null;
}

/** Whether this browser has played before the tutorial existed. */
export const playedBefore = () => !!(readText('local', KEYS.name) || readText('local', KEYS.welcomed));

export function markTutorial(status: Exclude<TutorialStatus, null>) {
  // Finishing it once is what matters; a later skip of a replay keeps that.
  if (tutorialStatus() === 'done' && status !== 'done') return;
  writeText('local', KEYS.tutorial, status);
}

export function startTutorial(name = savedName()) {
  rememberName(name);
  if (!tutorialStatus()) markTutorial('offered');
  lastSolo = null;
  attach(LocalLink.tutorial(name, events));
  window.scrollTo({ top: 0 });
}

export function setTutorialStep(step: number, id: string | null) {
  if (state.tutorial?.step === step && state.tutorial.id === id) return;
  if (link instanceof LocalLink && link.tutorial !== step) link.setTutorial(step);
  set({ tutorial: { step, id } });
}

/** Stops the guidance; the match itself goes on as ordinary practice. */
export function endTutorial(done: boolean) {
  markTutorial(done ? 'done' : 'skipped');
  if (done && state.coach) dismissCoach();
  if (link instanceof LocalLink) link.setTutorial(null);
  set({ tutorial: null });
}

export const savedName = () => readText('local', KEYS.name) || '林间旅人';
export const savedDifficulty = (): Difficulty => {
  const d = readText('local', KEYS.difficulty);
  return d === 'easy' || d === 'hard' || d === 'normal' ? d : 'easy';
};

/** Restores whatever this tab was doing before a reload. */
export function boot() {
  const session = storedSession();
  if (session) return goOnline(session);
  if (readText('session', KEYS.soloActive) && savedSolo()) return resumeSolo();
}

window.addEventListener('pagehide', () => voice.stop());
