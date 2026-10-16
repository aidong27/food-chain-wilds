/**
 * One Durable Object per room: the authoritative game, seat credentials and
 * every player's WebSocket. State lives in a single SQLite row.
 */
import { DurableObject } from 'cloudflare:workers';
import { timingSafeEqual } from 'node:crypto';
import { parseCommand } from '../src/game/commands';
import { STATE_VERSION, abandonSeat, addPlayer, applyCommand, createGame, removePlayer, tick } from '../src/game/engine';
import type { Game, Mode } from '../src/game/types';
import { PROTOCOL_VERSION, playerView } from '../src/game/view';
import { json, sha256 } from './http';

interface StoredRoom {
  game: Game;
  /** SHA-256 of each seat's secret token. */
  credentials: Record<string, string>;
  expires: number;
}

type Attachment = { id: string; window: number; count: number };

const ROOM_LIFETIME = 24 * 60 * 60 * 1000;
const MAX_MESSAGE = 18000;
const MAX_COMMAND = 2048;
const RATE_PER_SECOND = 30;
/** Close codes 4000–4999 tell clients to stop reconnecting and show the reason. */
const CLOSE_FINAL = 4001;
const CLOSE_EXPIRED = 4004;

const newToken = () => crypto.randomUUID() + crypto.randomUUID();

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** Rooms saved by an older version of the game are treated as gone. */
  private load(): StoredRoom | null {
    const row = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM room WHERE id=1').toArray()[0];
    if (!row) return null;
    const room = JSON.parse(row.data) as StoredRoom;
    return room.game?.version === STATE_VERSION ? room : null;
  }

  private save(room: StoredRoom) {
    this.ctx.storage.sql.exec(
      'INSERT INTO room (id,data) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      JSON.stringify(room),
    );
  }

  private async schedule(room: StoredRoom) {
    const next = room.game.deadline || room.expires;
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, Math.min(next, room.expires)));
  }

  private broadcast(game: Game) {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const { id } = ws.deserializeAttachment() as Attachment;
      try {
        ws.send(JSON.stringify({ type: 'state', state: playerView(game, id, now) }));
      } catch {
        // Disconnected clients recover from persisted state when they return.
      }
    }
  }

  private async commit(room: StoredRoom) {
    this.save(room);
    this.broadcast(room.game);
    await this.schedule(room);
  }

  async create(code: string, mode: Mode, name: string) {
    if (this.ctx.storage.sql.exec('SELECT 1 FROM room WHERE id=1').toArray().length) return null;
    const token = newToken();
    const id = crypto.randomUUID();
    const game = createGame(code, mode);
    addPlayer(game, id, name);
    const room: StoredRoom = { game, credentials: { [id]: await sha256(token) }, expires: Date.now() + ROOM_LIFETIME };
    this.save(room);
    await this.schedule(room);
    return { code, id, token };
  }

  async join(name: string) {
    const room = this.load();
    if (!room || room.expires <= Date.now()) throw new Error('房间不存在或已过期，请检查房间码。');
    if (room.game.mode === 'solo') throw new Error('这是单人练习房间，请创建联机房间邀请朋友。');
    const token = newToken();
    const id = crypto.randomUUID();
    addPlayer(room.game, id, name);
    room.credentials[id] = await sha256(token);
    this.save(room);
    this.broadcast(room.game);
    return { code: room.game.code, id, token };
  }

  /** Accepts a socket and closes it right away with a reason the client will show. */
  private refuse(reason: string, code = CLOSE_FINAL): Response {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.close(code, reason);
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: '需要实时连接。' }, 426);
    const url = new URL(request.url);
    const id = url.searchParams.get('id') || '';
    const token = url.searchParams.get('token') || '';
    if (url.searchParams.get('v') !== String(PROTOCOL_VERSION)) return this.refuse('游戏已经更新，请刷新页面后重新进入。');
    if (token.length > 200) return json({ error: '无效会话。' }, 401);
    const digest = await sha256(token);
    const room = this.load();
    if (!room || room.expires <= Date.now()) return this.refuse('房间已过期，请创建新的房间。', CLOSE_EXPIRED);
    const stored = room.credentials[id];
    const encoder = new TextEncoder();
    if (!stored || !timingSafeEqual(encoder.encode(stored), encoder.encode(digest))) return json({ error: '会话验证失败。' }, 401);
    // One live connection per seat prevents duplicated commands during a reconnect.
    for (const ws of this.ctx.getWebSockets(id)) {
      try {
        ws.close(CLOSE_FINAL, '这个席位已在另一个连接中打开。');
      } catch {
        // Already closed.
      }
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [id]);
    server.serializeAttachment({ id, window: Date.now(), count: 0 } satisfies Attachment);
    if (tick(room.game)) await this.commit(room);
    server.send(JSON.stringify({ type: 'state', state: playerView(room.game, id) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const attachment = ws.deserializeAttachment() as Attachment;
    try {
      if (typeof message !== 'string' || message.length > MAX_MESSAGE) throw new Error('消息格式无效。');
      const now = Date.now();
      if (now - attachment.window > 1000) Object.assign(attachment, { window: now, count: 0 });
      attachment.count++;
      ws.serializeAttachment(attachment);
      if (attachment.count > RATE_PER_SECOND) throw new Error('操作过快，请稍候。');

      const parsed: unknown = JSON.parse(message);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('无效操作。');
      const raw = parsed as { type?: unknown; target?: unknown; signal?: unknown };
      const room = this.load();
      if (!room || room.expires <= now) {
        ws.close(CLOSE_EXPIRED, '房间已过期。');
        return;
      }
      const game = room.game;

      if (raw.type === 'leave') return await this.leave(room, attachment.id, ws);
      if (raw.type === 'signal') return this.relaySignal(game, attachment.id, raw.target, raw.signal);

      if (message.length > MAX_COMMAND) throw new Error('操作数据过长。');
      const command = parseCommand(parsed);
      // A phase that ran out of time ends before the command is judged.
      const advanced = tick(game, now);
      let rejected: unknown = null;
      try {
        applyCommand(game, attachment.id, command, now);
      } catch (e) {
        rejected = e;
      }
      if (advanced || !rejected) await this.commit(room);
      if (rejected) throw rejected;
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e instanceof Error ? e.message : '操作未能完成。' }));
    }
  }

  private async leave(room: StoredRoom, id: string, ws: WebSocket) {
    if (!room.game.players.some(p => p.id === id)) throw new Error('玩家不存在。');
    if (room.game.phase === 'lobby') removePlayer(room.game, id);
    else abandonSeat(room.game, id);
    delete room.credentials[id];
    await this.commit(room);
    ws.close(CLOSE_FINAL, '已离开房间。');
  }

  /** Voice signalling only flows between two people who share a channel right now. */
  private relaySignal(game: Game, from: string, target: unknown, signal: unknown) {
    const p = game.players.find(q => q.id === from);
    const q = game.players.find(r => r.id === target);
    const inCamp = game.phase === 'drop' && p?.voice && q?.voice;
    const call = game.call;
    const inCall =
      game.phase === 'call' &&
      call?.accepted &&
      p &&
      q &&
      p.id !== q.id &&
      [call.from, call.to].includes(p.id) &&
      [call.from, call.to].includes(q.id);
    if (!p?.alive || !q?.alive || !(inCamp || inCall)) throw new Error('你们不在同一个语音频道。');
    for (const socket of this.ctx.getWebSockets(q.id)) socket.send(JSON.stringify({ type: 'signal', from, signal }));
  }

  async webSocketClose(ws: WebSocket, code: number) {
    const { id } = ws.deserializeAttachment() as Attachment;
    const room = this.load();
    if (room && !this.ctx.getWebSockets(id).some(other => other !== ws)) {
      const p = room.game.players.find(q => q.id === id);
      if (p?.voice) {
        p.voice = false;
        this.save(room);
        this.broadcast(room.game);
      }
    }
    try {
      ws.close(code);
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1011);
  }

  async alarm() {
    const room = this.load();
    if (!room) {
      // Nothing usable remains (expired or written by an older version).
      for (const ws of this.ctx.getWebSockets()) ws.close(CLOSE_EXPIRED, '房间已到期。');
      await this.ctx.storage.deleteAll();
      return;
    }
    if (Date.now() >= room.expires) {
      for (const ws of this.ctx.getWebSockets()) ws.close(CLOSE_EXPIRED, '房间已到期。');
      await this.ctx.storage.deleteAll();
      return;
    }
    if (tick(room.game)) {
      this.save(room);
      this.broadcast(room.game);
    }
    await this.schedule(room);
  }
}
