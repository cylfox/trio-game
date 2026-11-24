// Worker route tests: origin allowlist, CORS, create with collision retry, the existence probe and
// the WebSocket forward, over a fake room namespace.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, originAllowed } from '../src/http.ts';
import type { RoomStub, Routes } from '../src/http.ts';

const ORIGINS = 'https://cylfox.github.io,http://localhost:*,http://127.0.0.1:*';
const BASE = 'https://trio-game.example.workers.dev';

function fakeRooms(inUse: string[] = []) {
  const rooms = new Map<string, string | null>(inUse.map((code) => [code, 'someone']));
  const forwarded: string[] = [];
  const created: Array<[string, string | null]> = [];
  const room = (code: string): RoomStub => ({
    async create(hostId) {
      if (rooms.has(code)) return false;
      rooms.set(code, hostId);
      created.push([code, hostId]);
      return true;
    },
    async exists() {
      return rooms.has(code);
    },
    async fetch(request) {
      forwarded.push(new URL(request.url).pathname);
      return new Response('forwarded', { status: 200 });
    },
  });
  return { rooms, forwarded, created, room };
}

function routes(rooms: ReturnType<typeof fakeRooms>, codes?: string[]): Routes {
  const queue = [...(codes ?? [])];
  return { origins: ORIGINS, room: rooms.room, ...(codes ? { newCode: () => queue.shift() ?? 'ZZZZ' } : {}) };
}

function req(method: string, path: string, init: { origin?: string | null; body?: string; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { ...init.headers };
  const origin = init.origin === undefined ? 'https://cylfox.github.io' : init.origin;
  if (origin !== null) headers.Origin = origin;
  return new Request(`${BASE}${path}`, { method, headers, body: init.body });
}

describe('room server routes', () => {
  test('origin allowlist: the Pages site and any localhost / 127.0.0.1 port', () => {
    for (const ok of ['https://cylfox.github.io', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost']) {
      assert.equal(originAllowed(ok, ORIGINS), true, ok);
    }
    for (const bad of [null, '', 'https://evil.example', 'http://cylfox.github.io', 'https://cylfox.github.io.evil.example', 'http://localhost:5173.evil', 'http://localhost:abc']) {
      assert.equal(originAllowed(bad, ORIGINS), false, String(bad));
    }
  });

  test('POST /rooms creates a room for the caller, retrying codes in use', async () => {
    const rooms = fakeRooms(['AAAA']);
    const res = await handle(req('POST', '/rooms', { body: JSON.stringify({ playerId: 'player-1' }) }), routes(rooms, ['AAAA', 'BBBB']));
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { code: 'BBBB' });
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://cylfox.github.io');
    assert.equal(res.headers.get('Vary'), 'Origin');
    assert.deepEqual(rooms.created, [['BBBB', 'player-1']]);

    const anonymous = await handle(req('POST', '/rooms'), routes(rooms, ['CCCC']));
    assert.equal(anonymous.status, 201);
    assert.deepEqual(rooms.created.at(-1), ['CCCC', null], 'no body: the first player to join hosts');

    const busy = await handle(req('POST', '/rooms'), routes(fakeRooms(['ZZZZ'])));
    assert.equal(busy.status, 201, 'real codes are random');
    const allTaken = await handle(req('POST', '/rooms'), routes(fakeRooms(['QQQQ']), Array(8).fill('QQQQ')));
    assert.equal(allTaken.status, 503);
  });

  test('POST /rooms refuses other origins and bad bodies', async () => {
    const rooms = fakeRooms();
    assert.equal((await handle(req('POST', '/rooms', { origin: 'https://evil.example' }), routes(rooms))).status, 403);
    assert.equal((await handle(req('POST', '/rooms', { origin: null }), routes(rooms))).status, 403);
    for (const body of ['{not json', '[]', JSON.stringify({ playerId: 'x'.repeat(65) }), JSON.stringify({ playerId: 7 }), 'x'.repeat(2000)]) {
      assert.equal((await handle(req('POST', '/rooms', { body }), routes(rooms))).status, 400, body.slice(0, 20));
    }
    assert.equal(rooms.created.length, 0);
    assert.equal((await handle(req('PUT', '/rooms'), routes(rooms))).status, 405);
  });

  test('CORS preflight', async () => {
    const ok = await handle(req('OPTIONS', '/rooms', { origin: 'http://localhost:5173' }), routes(fakeRooms()));
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
    assert.match(ok.headers.get('Access-Control-Allow-Methods') ?? '', /POST/);
    const bad = await handle(req('OPTIONS', '/rooms', { origin: 'https://evil.example' }), routes(fakeRooms()));
    assert.equal(bad.status, 403);
  });

  test('GET /rooms/:code says whether the room exists', async () => {
    const rooms = fakeRooms(['K7QX']);
    const yes = await handle(req('GET', '/rooms/K7QX'), routes(rooms));
    assert.equal(yes.status, 200);
    assert.deepEqual(await yes.json(), { code: 'K7QX', exists: true });
    assert.equal(yes.headers.get('Access-Control-Allow-Origin'), 'https://cylfox.github.io');
    const no = await handle(req('GET', '/rooms/M4ZE'), routes(rooms));
    assert.equal(no.status, 200, 'not a 404: browsers log those as console errors');
    assert.deepEqual(await no.json(), { code: 'M4ZE', exists: false });
    for (const bad of ['k7qx', 'K0QX', 'TOOLONG', 'K7Q']) assert.equal((await handle(req('GET', `/rooms/${bad}`), routes(rooms))).status, 404, bad);
    assert.equal((await handle(req('GET', '/rooms/K7QX', { origin: 'https://evil.example' }), routes(rooms))).status, 403);
  });

  test('GET /rooms/:code/ws forwards WebSocket upgrades from allowed origins', async () => {
    const rooms = fakeRooms(['K7QX']);
    const upgrade = { Upgrade: 'websocket' };
    const ok = await handle(req('GET', '/rooms/K7QX/ws', { headers: upgrade }), routes(rooms));
    assert.equal(await ok.text(), 'forwarded');
    assert.deepEqual(rooms.forwarded, ['/rooms/K7QX/ws']);
    assert.equal((await handle(req('GET', '/rooms/K7QX/ws'), routes(rooms))).status, 426, 'not an upgrade');
    assert.equal((await handle(req('GET', '/rooms/K7QX/ws', { headers: upgrade, origin: 'https://evil.example' }), routes(rooms))).status, 403);
    assert.equal((await handle(req('GET', '/rooms/K7QX/ws', { headers: upgrade, origin: null }), routes(rooms))).status, 403);
    assert.equal((await handle(req('GET', '/rooms/k7qx/ws', { headers: upgrade }), routes(rooms))).status, 404);
    assert.equal(rooms.forwarded.length, 1);
  });

  test('over the rate limit: 429 with Retry-After (and CORS, so the client can fall back to P2P)', async () => {
    const rooms = fakeRooms(['K7QX']);
    const seen: string[] = [];
    let ok = false;
    const limited: Routes = {
      ...routes(rooms),
      limit: async (kind, request) => {
        seen.push(`${kind} ${request.headers.get('CF-Connecting-IP')}`);
        return ok ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: 37 };
      },
    };
    const ip = { 'CF-Connecting-IP': '203.0.113.5' };
    const create = await handle(req('POST', '/rooms', { headers: ip }), limited);
    assert.equal(create.status, 429);
    assert.equal(create.headers.get('Retry-After'), '37');
    assert.equal(create.headers.get('Access-Control-Allow-Origin'), 'https://cylfox.github.io');
    assert.deepEqual(await create.json(), { error: 'rateLimited' });
    assert.equal(rooms.created.length, 0, 'no room was made');

    const probe = await handle(req('GET', '/rooms/K7QX', { headers: ip }), limited);
    assert.equal(probe.status, 429);
    assert.equal(probe.headers.get('Retry-After'), '37');
    const ws = await handle(req('GET', '/rooms/K7QX/ws', { headers: { ...ip, Upgrade: 'websocket' } }), limited);
    assert.equal(ws.status, 429);
    assert.equal(rooms.forwarded.length, 0, 'not forwarded to the room');
    assert.deepEqual(seen, ['create 203.0.113.5', 'connect 203.0.113.5', 'connect 203.0.113.5']);

    // Refused before counting: other origins, bad codes, non-upgrades.
    await handle(req('POST', '/rooms', { origin: 'https://evil.example' }), limited);
    await handle(req('GET', '/rooms/k0qx/ws', { headers: { Upgrade: 'websocket' } }), limited);
    await handle(req('GET', '/rooms/K7QX/ws'), limited);
    await handle(req('GET', '/health'), limited);
    assert.equal(seen.length, 3);

    ok = true;
    assert.equal((await handle(req('POST', '/rooms', { headers: ip }), limited)).status, 201);
  });

  test('health and unknown paths', async () => {
    const health = await handle(req('GET', '/health', { origin: null }), routes(fakeRooms()));
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    assert.equal((await handle(req('GET', '/nope'), routes(fakeRooms()))).status, 404);
    assert.equal((await handle(req('GET', '/rooms/K7QX/ws/extra'), routes(fakeRooms()))).status, 404);
  });
});
