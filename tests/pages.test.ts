import assert from 'node:assert/strict';
import test from 'node:test';
import { gameUrls } from '../src/urls';
import { originPolicy, preflight } from '../server/cors';

const pagesOrigin = 'https://aidong27.github.io';
const backend = 'https://food-chain-wilds.food-chain-game.workers.dev';

test('Pages navigation and invitations retain the repository path while API and WebSocket use the Worker', () => {
  const urls = gameUrls(pagesOrigin, '/food-chain-wilds/', backend);
  assert.equal(urls.home, '/food-chain-wilds/');
  assert.equal(urls.asset('favicon.svg'), '/food-chain-wilds/favicon.svg');
  assert.equal(urls.invite('ABC234'), `${pagesOrigin}/food-chain-wilds/?room=ABC234`);
  assert.equal(urls.api('/api/rooms'), `${backend}/api/rooms`);
  const ws = new URL(urls.socket('ABC234', 'seat', 'a+&/token'));
  assert.equal(ws.origin, backend.replace('https:', 'wss:'));
  assert.equal(ws.searchParams.get('token'), 'a+&/token');
  assert.equal(ws.searchParams.get('id'), 'seat');
});

test('original Worker and local dev retain same-origin requests', () => {
  for (const origin of [backend, 'http://127.0.0.1:5173']) {
    const urls = gameUrls(origin, '/');
    assert.equal(urls.home, '/');
    assert.equal(urls.api('/api/rooms'), `${origin}/api/rooms`);
    assert.equal(new URL(urls.socket('ABC234', 'seat', 'token')).protocol, origin.startsWith('https:') ? 'wss:' : 'ws:');
  }
  assert.throws(() => gameUrls(pagesOrigin, '/', 'https://user:password@example.com'));
});

test('CORS permits only the exact Pages origin and original site', () => {
  for (const origin of [pagesOrigin, backend]) {
    const policy = originPolicy(new Request(`${backend}/api/rooms`, { headers: { Origin: origin } }), pagesOrigin);
    assert.equal(policy.allowed, true);
    assert.equal(policy.headers['Access-Control-Allow-Origin'], origin);
    assert.equal(policy.headers.Vary, 'Origin');
    assert.equal(policy.headers['Access-Control-Allow-Credentials'], undefined);
  }
  for (const origin of ['https://evil.invalid', `${pagesOrigin}.evil.invalid`, 'http://aidong27.github.io', 'null']) {
    const policy = originPolicy(new Request(`${backend}/api/rooms/ABC234/ws`, { headers: { Origin: origin } }), pagesOrigin);
    assert.equal(policy.allowed, false);
    assert.equal(policy.headers['Access-Control-Allow-Origin'], undefined);
  }
  assert.equal(originPolicy(new Request(`${backend}/api/rooms`), pagesOrigin).allowed, true);
});

test('preflight accepts JSON POST but rejects unexpected methods and headers', () => {
  const request = (method: string, headers: string) => new Request(`${backend}/api/rooms`, {
    method: 'OPTIONS',
    headers: { Origin: pagesOrigin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': headers },
  });
  const allowed = request('POST', 'content-type');
  const response = preflight(allowed, originPolicy(allowed, pagesOrigin).headers);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), pagesOrigin);
  assert.equal(preflight(request('DELETE', 'content-type'), {}).status, 403);
  assert.equal(preflight(request('POST', 'authorization'), {}).status, 403);
});
