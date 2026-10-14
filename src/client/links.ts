/**
 * A Link connects the interface to a match: either the engine running right
 * here in the browser (solo practice, no server needed) or a room on the
 * Cloudflare backend over a WebSocket.
 */
import { advance, applyCommand, createGame, addPlayer, startGame, STATE_VERSION } from '../game/engine';
import type { SpeciesId } from '../game/data';
import type { Command, Difficulty, Game } from '../game/types';
import { PROTOCOL_VERSION, playerView, type GameView } from '../game/view';
import { KEYS, readJson, writeJson, writeText } from './storage';
import type { gameUrls } from './urls';

export interface LinkEvents {
  view(view: GameView): void;
  error(message: string): void;
  status(connected: boolean): void;
  /** The seat is gone for good: left, expired or opened elsewhere. */
  ended(reason: string): void;
  signal(from: string, signal: unknown): void;
}

export interface Link {
  readonly kind: 'local' | 'online';
  readonly playerId: string;
  send(cmd: Command): void;
  /** Disconnect without giving up the seat. */
  close(): void;
  /** Give up the seat for good. */
  leave(): void;
}

// ---------------------------------------------------------------- solo

interface SavedSolo {
  v: number;
  game: Game;
  playerId: string;
}

export interface SoloSettings {
  name: string;
  animal: SpeciesId | '';
  difficulty: Difficulty;
}

const HUMAN = 'you';

export function savedSolo(): SavedSolo | null {
  const saved = readJson<SavedSolo>('local', KEYS.solo);
  if (!saved || saved.v !== STATE_VERSION || saved.game?.version !== STATE_VERSION) return null;
  return saved;
}

export class LocalLink implements Link {
  readonly kind = 'local';
  readonly playerId: string;
  private game: Game;
  /** Chat lines from computer players waiting to appear, so the camp feels alive. */
  private pending: number[] = [];
  private known: number;
  private timer = 0;

  private constructor(
    game: Game,
    playerId: string,
    private events: LinkEvents,
  ) {
    this.game = game;
    this.playerId = playerId;
    this.known = game.serial;
    queueMicrotask(() => {
      events.status(true);
      this.publish();
    });
  }

  static start(settings: SoloSettings, events: LinkEvents): LocalLink {
    const code = 'SOLO' + String(Math.floor(Math.random() * 90 + 10));
    const game = createGame(code, 'solo');
    game.difficulty = settings.difficulty;
    addPlayer(game, HUMAN, settings.name);
    startGame(game, settings.animal || undefined);
    const link = new LocalLink(game, HUMAN, events);
    link.known = 0;
    link.queueChat();
    link.save();
    writeText('session', KEYS.soloActive, '1');
    return link;
  }

  static resume(events: LinkEvents): LocalLink | null {
    const saved = savedSolo();
    if (!saved) return null;
    writeText('session', KEYS.soloActive, '1');
    return new LocalLink(saved.game, saved.playerId, events);
  }

  get settings(): SoloSettings {
    const me = this.game.players.find(p => p.id === this.playerId)!;
    return { name: me.name, animal: '', difficulty: this.game.difficulty };
  }

  send(cmd: Command) {
    try {
      applyCommand(this.game, this.playerId, cmd);
    } catch (e) {
      this.events.error(e instanceof Error ? e.message : '操作未能完成。');
      return;
    }
    this.afterChange();
  }

  /** After the player's animal dies, watch the rest of the match play out at once. */
  skipToEnd() {
    for (let guard = 0; this.game.phase !== 'finished' && guard < 200; guard++) advance(this.game);
    // Everything that happened is shown at once; nothing is left to trickle in.
    this.flushChat();
    this.known = this.game.serial;
    this.save();
    this.publish();
  }

  close() {
    clearTimeout(this.timer);
  }

  leave() {
    this.close();
    writeJson('local', KEYS.solo, null);
    writeText('session', KEYS.soloActive, null);
  }

  private afterChange() {
    this.queueChat();
    this.save();
    this.publish();
  }

  private save() {
    writeJson('local', KEYS.solo, { v: STATE_VERSION, game: this.game, playerId: this.playerId } satisfies SavedSolo);
  }

  private queueChat() {
    const fresh = this.game.log.filter(l => l.id > this.known && (l.kind === 'public' || l.kind === 'private') && l.from !== this.playerId);
    this.known = this.game.serial;
    if (!fresh.length) return;
    this.pending.push(...fresh.map(l => l.id));
    if (!this.timer) this.revealNext(450);
  }

  private revealNext(delay: number) {
    this.timer = window.setTimeout(() => {
      this.pending.shift();
      this.publish();
      this.timer = 0;
      if (this.pending.length) this.revealNext(550 + Math.random() * 500);
    }, delay);
  }

  private flushChat() {
    clearTimeout(this.timer);
    this.timer = 0;
    this.pending = [];
  }

  private publish() {
    const view = playerView(this.game, this.playerId);
    if (this.pending.length) {
      const hidden = new Set(this.pending);
      view.log = view.log.filter(l => !hidden.has(l.id));
    }
    this.events.view(view);
  }
}

// ---------------------------------------------------------------- online

export interface Session {
  code: string;
  id: string;
  token: string;
}

type Urls = ReturnType<typeof gameUrls>;

export class OnlineLink implements Link {
  readonly kind = 'online';
  private socket: WebSocket | null = null;
  private retry = 0;
  private timer = 0;
  private stopped = false;

  constructor(
    private session: Session,
    private urls: Urls,
    private events: LinkEvents,
    private onOpen?: () => void,
  ) {
    writeJson('session', KEYS.session, session);
    this.connect();
  }

  get playerId() {
    return this.session.id;
  }

  get code() {
    return this.session.code;
  }

  private connect() {
    clearTimeout(this.timer);
    const ws = new WebSocket(this.urls.socket(this.session.code, this.session.id, this.session.token, PROTOCOL_VERSION));
    this.socket = ws;
    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.retry = 0;
      this.events.status(true);
      const first = this.onOpen;
      this.onOpen = undefined;
      first?.();
    };
    ws.onmessage = e => {
      if (this.socket !== ws || typeof e.data !== 'string' || e.data === 'pong') return;
      try {
        const message = JSON.parse(e.data);
        if (message.type === 'state') {
          if (message.state?.protocol !== PROTOCOL_VERSION) {
            this.end('游戏已更新，请刷新页面后重新加入。');
            return;
          }
          this.events.view(message.state as GameView);
        } else if (message.type === 'error') this.events.error(String(message.message));
        else if (message.type === 'signal') this.events.signal(String(message.from), message.signal);
      } catch {
        this.events.error('收到异常数据，正在重新同步。');
      }
    };
    ws.onclose = e => {
      if (this.socket !== ws) return;
      this.events.status(false);
      if (this.stopped) return;
      if (e.code >= 4000 && e.code < 5000) {
        this.end(e.reason || '会话已失效，请重新加入。');
        return;
      }
      this.timer = window.setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** this.retry++));
    };
  }

  private end(reason: string) {
    this.stopped = true;
    this.socket?.close();
    writeJson('session', KEYS.session, null);
    this.events.ended(reason);
  }

  send(cmd: Command) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.events.error('正在重新连接，请稍候。');
      return;
    }
    this.socket.send(JSON.stringify(cmd));
  }

  signal(target: string, signal: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'signal', target, signal }));
  }

  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
  }

  leave() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'leave' }));
    this.close();
    writeJson('session', KEYS.session, null);
  }
}

export function storedSession(): Session | null {
  const s = readJson<Session>('session', KEYS.session);
  return s && typeof s.code === 'string' && typeof s.id === 'string' && typeof s.token === 'string' ? s : null;
}

export async function postJson<T>(url: string, data: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  } catch {
    throw new Error('无法连接联机服务器。单人练习不需要网络，仍可正常游玩。');
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || '暂时无法连接，请稍后重试。');
  return body;
}

export type ServerStatus = 'checking' | 'ok' | 'outdated' | 'offline';

export async function checkServer(url: string): Promise<ServerStatus> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timeout);
    if (!res.ok) return 'offline';
    const body = (await res.json()) as { protocol?: number };
    return body.protocol === PROTOCOL_VERSION ? 'ok' : 'outdated';
  } catch {
    return 'offline';
  }
}
