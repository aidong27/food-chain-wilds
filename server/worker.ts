/**
 * HTTP entry point: static assets, room creation and joining, and the
 * WebSocket upgrade that hands each player to their room's Durable Object.
 */
import { PROTOCOL_VERSION } from '../src/game/view';
import { originPolicy, preflight } from './cors';
import { json, playerName, readBody } from './http';

export { GameRoom } from './room';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function roomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const cors = originPolicy(request, env.PAGES_ORIGIN);
    if (!cors.allowed) return json({ error: '不允许跨站请求。' }, 403);
    if (request.method === 'OPTIONS') return preflight(request, cors.headers);
    const respond = (value: unknown, status = 200) => json(value, status, cors.headers);

    if (url.pathname === '/api/health') return respond({ ok: true, game: 'food-chain', version: '2.4.0', protocol: PROTOCOL_VERSION });
    try {
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        const data = await readBody(request);
        const name = playerName(data.name);
        const mode = data.mode === 'solo' ? 'solo' : 'online';
        for (let tries = 0; tries < 4; tries++) {
          const code = roomCode();
          const created = await env.ROOMS.getByName(code).create(code, mode, name);
          if (created) return respond(created, 201);
        }
        return respond({ error: '房间暂时繁忙，请重新创建。' }, 503);
      }
      const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/(join|ws)$/);
      if (!match) return respond({ error: '找不到这个地址。' }, 404);
      const room = env.ROOMS.getByName(match[1]);
      if (match[2] === 'join' && request.method === 'POST') {
        const data = await readBody(request);
        return respond(await room.join(playerName(data.name)));
      }
      if (match[2] === 'ws' && request.method === 'GET') return room.fetch(request);
      return respond({ error: '请求方式不支持。' }, 405);
    } catch (e) {
      return respond({ error: e instanceof Error ? e.message : '请求未能完成。' }, 400);
    }
  },
} satisfies ExportedHandler<Env>;
