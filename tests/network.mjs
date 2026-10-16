/**
 * End-to-end checks against a running Worker with real WebSocket clients.
 *   npm run preview:worker            # in one terminal
 *   npm run test:network              # in another
 * GAME_BASE_URL targets another deployment; GAME_ORIGIN checks the Pages CORS path.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const base = process.env.GAME_BASE_URL || 'http://127.0.0.1:8787';
const origin = process.env.GAME_ORIGIN;
const PROTOCOL = 3;
const results = [];
const sessions = [];
const pass = text => results.push(text);
const requester = base.startsWith('https') ? httpsRequest : httpRequest;

const socketUrl = (session, version = PROTOCOL) =>
  `${base.replace(/^http/, 'ws')}/api/rooms/${session.code}/ws?id=${session.id}&token=${encodeURIComponent(session.token)}${version ? `&v=${version}` : ''}`;

/** Raw handshake status, to check origin and token rules without a full client. */
function handshake(session, { token = session.token, requestOrigin } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/rooms/${session.code}/ws`, base);
    url.search = new URLSearchParams({ id: session.id, token, v: String(PROTOCOL) }).toString();
    const headers = {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      'Sec-WebSocket-Version': '13',
    };
    if (requestOrigin) headers.Origin = requestOrigin;
    const req = requester(url, { headers }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(Error('WebSocket handshake timed out')));
    req.end();
  });
}

async function post(path, data) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(data),
  });
  if (origin) assert.equal(res.headers.get('access-control-allow-origin'), origin);
  return { status: res.status, body: await res.json() };
}

class Client {
  constructor(session, version = PROTOCOL) {
    this.session = session;
    this.view = null;
    this.version = 0;
    this.errors = [];
    this.signals = [];
    this.closed = null;
    this.ws = new WebSocket(socketUrl(session, version));
    this.ws.addEventListener('message', e => {
      if (e.data === 'pong') return;
      const m = JSON.parse(e.data);
      if (m.type === 'state') {
        this.view = m.state;
        this.version++;
      }
      if (m.type === 'error') this.errors.push(m.message);
      if (m.type === 'signal') this.signals.push(m);
    });
    this.ws.addEventListener('close', e => (this.closed = { code: e.code, reason: e.reason }));
    sessions.push(this);
  }
  async wait(predicate = () => this.view) {
    const limit = Date.now() + 15000;
    while (!predicate()) {
      if (Date.now() > limit) throw Error(`Timed out waiting for ${this.session.code} (${this.view?.phase}).`);
      await new Promise(r => setTimeout(r, 25));
    }
    return this.view;
  }
  async send(cmd, expectError = false) {
    await this.wait(() => this.ws.readyState === WebSocket.OPEN);
    const version = this.version;
    const errors = this.errors.length;
    this.ws.send(JSON.stringify(cmd));
    await this.wait(() => (expectError ? this.errors.length > errors : this.version > version));
    if (!expectError) assert.equal(this.errors.length, errors, this.errors.at(-1));
    return this.view;
  }
  close() {
    this.ws.close();
  }
}

const me = c => c.view.players.find(p => p.id === c.session.id);

try {
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.protocol, PROTOCOL);
  pass(`health reports protocol ${PROTOCOL}`);

  if (origin) {
    const options = await fetch(`${base}/api/rooms`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('access-control-allow-origin'), origin);
    assert.equal((await post('/api/rooms', { name: '', mode: 'online' })).status, 400);
    pass('Pages JSON preflight and readable error responses use the exact allowed origin');
  }

  // Lobby host hand-over.
  const transfer = await post('/api/rooms', { name: '房主离开测试', mode: 'online' });
  const ta = new Client(transfer.body);
  await ta.wait();
  const tb = new Client((await post(`/api/rooms/${ta.session.code}/join`, { name: '继任房主' })).body);
  await tb.wait();
  ta.ws.send(JSON.stringify({ type: 'leave' }));
  await tb.wait(() => tb.view.host === tb.session.id && tb.view.players.length === 1);
  assert.equal(tb.view.players[0].seat, 1);
  ta.close();
  tb.close();
  pass('leaving the lobby removes the seat and transfers host to the remaining human');

  // Clients from before the update are told to refresh instead of looping.
  const stale = new Client(transfer.body, 0);
  await stale.wait(() => stale.closed);
  assert.equal(stale.closed.code, 4001);
  assert.match(stale.closed.reason, /更新|刷新/);
  pass('clients speaking an older protocol are closed with a refresh message');

  // Three people in one room.
  const created = await post('/api/rooms', { name: '网络测试甲', mode: 'online' });
  assert.equal(created.status, 201);
  const a = new Client(created.body);
  await a.wait();
  assert.equal(a.view.phase, 'lobby');
  const b = new Client((await post(`/api/rooms/${created.body.code}/join`, { name: '网络测试乙' })).body);
  await b.wait();
  await a.wait(() => a.view.players.length === 2);
  const c = new Client((await post(`/api/rooms/${created.body.code}/join`, { name: '网络测试丙' })).body);
  await c.wait();
  await b.send({ type: 'start' }, true);
  assert.equal(b.view.phase, 'lobby');
  await a.send({ type: 'start' });
  await b.wait(() => b.view.phase === 'drop');
  await c.wait(() => c.view.phase === 'drop');
  assert.equal(a.view.players.length, 8);
  assert.equal(a.view.players.filter(p => p.animal !== null).length, 1);
  assert.ok(!JSON.stringify(a.view).includes('credentials'));
  assert.ok(!JSON.stringify(a.view).includes('belief'));
  pass('3 clients share one authoritative 8-seat room; non-host cannot start; roles and bot minds stay hidden');

  await a.send({ type: 'message', target: b.session.id, text: '私有网络验证消息' });
  await b.wait(() => b.view.log.some(l => l.text === '私有网络验证消息'));
  assert.ok(!c.view.log.some(l => l.text === '私有网络验证消息'));
  pass('private message visible only to sender and recipient');

  await a.send({ type: 'signal', target: b.session.id, signal: { test: 'forbidden' } }, true);
  assert.equal(b.signals.length, 0);
  pass('voice signaling denied outside an authorized channel');
  await a.send({ type: 'voice', joined: true });
  await b.send({ type: 'voice', joined: true });
  a.ws.send(JSON.stringify({ type: 'signal', target: b.session.id, signal: { test: 'authorized' } }));
  await b.wait(() => b.signals.length === 1);
  assert.equal(c.signals.length, 0);
  pass('voice signaling routes only between opted-in participants');

  await a.send({ type: 'guess', target: c.session.id, animal: 'deer' });
  await a.send({ type: 'guess', target: c.session.id, animal: 'dragon' }, true);
  pass('identity notes accept real animals only');

  // Talk and drop share the first phase: locking in a start is how you say you are done talking.
  await a.send({ type: 'ready' }, true);
  await a.send({ type: 'drop', region: 'forest' });
  await a.send({ type: 'ready' });
  assert.equal(b.view.players.find(p => p.id === a.session.id).drop, null);
  await b.send({ type: 'drop', region: 'river' });
  await b.send({ type: 'ready' });
  await c.wait(() => c.view.deadline - c.view.now <= 20_000);
  pass('once everyone else is ready, the last person gets a short final countdown');
  await c.send({ type: 'drop', region: 'meadow' });
  await c.send({ type: 'ready' });
  await a.wait(() => a.view.phase === 'action');
  assert.equal(b.view.players.find(p => p.id === a.session.id).drop, 'forest');
  pass('placement remains secret until all humans lock choices');

  await a.send({ type: 'move', region: 'ruins' }, true);
  await a.send({ type: 'move', region: 'nowhere' }, true);
  await a.send({ type: 'move', region: 'river' });
  assert.equal(a.view.me.location, 'river');
  assert.ok(!('location' in b.view.players.find(p => p.id === a.session.id)));
  pass('invalid movement rejected; valid movement stays private');

  for (const client of [a, b, c]) await client.send({ type: 'ready' });
  // Traces show from the calls on; there is no separate phase just for looking.
  await a.wait(() => a.view.phase === 'call');
  assert.equal(a.view.traces.ruins, null);
  assert.ok(Array.isArray(a.view.traces.river));
  await a.send({ type: 'call', target: b.session.id });
  await b.send({ type: 'call-answer', accept: true });
  await a.wait(() => a.view.call?.accepted);
  assert.equal(a.view.me.called, true);
  assert.equal(b.view.me.called, true);
  await a.send({ type: 'hangup' });
  // The third person has nobody left to call, so food starts right away.
  await c.wait(() => c.view.phase === 'food');
  pass('ordered accepted calls consume both quotas and skip seats with nobody to call');

  for (const client of [a, b, c]) {
    await client.send({ type: 'food', choice: 'skip' });
    await client.send({ type: 'ready' });
  }
  await a.wait(() => a.view.phase === 'settle');
  pass('simultaneous food choices resolve consistently for all clients');

  const old = a.view;
  const reconnect = new Client(a.session);
  await reconnect.wait();
  await a.wait(() => a.closed);
  assert.deepEqual(reconnect.view.me, old.me);
  pass('reconnect restores persisted private state and retires the older socket');

  const forbidden = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { origin: 'https://evil.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ name: '伪造', mode: 'online' }),
  });
  assert.equal(forbidden.status, 403);
  pass('cross-origin mutation rejected');

  assert.equal(await handshake(a.session, { token: 'bad' }), 401);
  pass('invalid seat token rejected');

  if (origin) {
    assert.equal(await handshake(a.session, { requestOrigin: 'https://evil.invalid' }), 403);
    assert.equal(await handshake(a.session, { requestOrigin: origin }), 101);
    pass('WebSocket handshake accepts Pages origin and rejects untrusted origins');
  }

  // One person against seven computer players, all the way to the end.
  const lone = new Client((await post('/api/rooms', { name: '七回合验证', mode: 'online' })).body);
  await lone.wait();
  await lone.send({ type: 'start' });
  let steps = 0;
  while (lone.view.phase !== 'finished' && steps++ < 85) {
    const alive = lone.view.me.alive;
    if (alive && lone.view.phase === 'drop') {
      const region = Object.keys(lone.view.resources).find(r => lone.view.resources[r] > 0);
      await lone.send({ type: 'drop', region });
    }
    if (alive && lone.view.phase === 'food') await lone.send({ type: 'food', choice: 'skip' });
    await lone.send({ type: 'ready' });
    // Real users cannot exceed the production rate limit; keep this stress run bounded.
    await new Promise(r => setTimeout(r, 55));
  }
  assert.equal(lone.view.phase, 'finished');
  assert.equal(lone.view.round, 7);
  assert.ok(lone.view.players.every(p => p.animal !== null && Number.isFinite(p.score)));
  assert.ok(lone.view.log.some(l => l.kind === 'public' && lone.view.players.find(p => p.id === l.from)?.bot));
  assert.ok(me(lone));
  pass('a lone player finishes 7 rounds against talking bots and sees the revealed scoreboard');

  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(
    'artifacts/network-results.json',
    JSON.stringify(
      { base, date: new Date().toISOString(), checks: results, finalRound: lone.view.round, players: lone.view.players },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ base, passed: results.length, checks: results }, null, 2));
} finally {
  for (const client of sessions) client.close();
}
