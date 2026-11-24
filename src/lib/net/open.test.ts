// Hybrid networking tests: which network a room uses (server first, P2P fallback), link parsing
// for P2P rooms (#p-CODE), and the typed-code fallback. The server is a fake fetch.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deniedSession, isUnavailable, openOnline, parseRoomHash, probeRoom, requestCreate, roomHash, serverUrls } from './open.ts';
import type { Fetch, OpenDeps } from './open.ts';
import { inviteLink } from './room-code.ts';
import type { RoomSession } from './session.ts';

const SERVER = { http: 'https://trio-game.cylfox.workers.dev', ws: 'wss://trio-game.cylfox.workers.dev' };
const ME = { id: 'player-ana', name: 'Ana' };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fake server: answers by method + path, records the calls. */
function fakeFetch(answer: (method: string, path: string) => Response | Error | 'hang') {
  const calls: string[] = [];
  const fetch: Fetch = (input, init) => {
    const method = init?.method ?? 'GET';
    const path = new URL(input).pathname;
    calls.push(`${method} ${path}${init?.body ? ` ${String(init.body)}` : ''}`);
    const a = answer(method, path);
    if (a === 'hang') {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  };
  return { fetch, calls };
}

function stubSession(tag: string): RoomSession {
  return { ...deniedSession(tag, 'x'), role: 'guest' };
}

function deps(fetch: Fetch, server: OpenDeps['server'] = SERVER) {
  const opened: string[] = [];
  const d: OpenDeps = {
    server,
    fetch,
    timeoutMs: 50,
    openServer: (code) => {
      opened.push(`server ${code}`);
      return stubSession(`server-${code}`);
    },
    openP2P: async (code) => {
      opened.push(`p2p ${code ?? 'new'}`);
      return { session: stubSession('p2p'), code: code ?? 'P2PN' };
    },
  };
  return { d, opened };
}

describe('room links', () => {
  test('#CODE is a plain (server-first) code, #p-CODE a P2P room', () => {
    assert.deepEqual(parseRoomHash('#K7QX'), { code: 'K7QX', mode: null });
    assert.deepEqual(parseRoomHash('#k7qx'), { code: 'K7QX', mode: null });
    assert.deepEqual(parseRoomHash('#p-K7QX'), { code: 'K7QX', mode: 'p2p' });
    assert.deepEqual(parseRoomHash('#P-k7qx'), { code: 'K7QX', mode: 'p2p' });
    assert.deepEqual(parseRoomHash('p-M4ZE'), { code: 'M4ZE', mode: 'p2p' });
    for (const bad of ['', '#', '#debug', '#p-', '#p-K7Q', '#p-K0QX', '#pK7QX', '#K7QXZ', '#x-K7QX', '#p-K7QX-']) assert.equal(parseRoomHash(bad), null, bad);
    assert.equal(roomHash('K7QX', 'server'), 'K7QX');
    assert.equal(roomHash('K7QX', 'p2p'), 'p-K7QX');
    assert.equal(inviteLink('https://cylfox.github.io/trio-game/', roomHash('K7QX', 'p2p')), 'https://cylfox.github.io/trio-game/#p-K7QX');
    assert.deepEqual(parseRoomHash(new URL(inviteLink('https://cylfox.github.io/trio-game/', roomHash('K7QX', 'p2p'))).hash), { code: 'K7QX', mode: 'p2p' }, 'round trip');
  });

  test('VITE_ROOM_SERVER: ws(s) or http(s) bases; placeholders and junk mean P2P only', () => {
    assert.deepEqual(serverUrls('wss://trio-game.cylfox.workers.dev'), SERVER);
    assert.deepEqual(serverUrls('https://trio-game.cylfox.workers.dev/'), SERVER);
    assert.deepEqual(serverUrls(' ws://127.0.0.1:8787 '), { http: 'http://127.0.0.1:8787', ws: 'ws://127.0.0.1:8787' });
    for (const bad of [undefined, null, '', '  ', 'wss://trio-game.<account>.workers.dev', 'ftp://x.test', 'not a url', 'trio-game.workers.dev']) {
      assert.equal(serverUrls(bad), null, String(bad));
    }
  });
});

describe('server or P2P: the decisions', () => {
  test('create: 201 → server room; unreachable, timeout, 5xx, 429 → P2P; a 4xx refusal → error', async () => {
    const created = await requestCreate(SERVER, 'player-ana', fakeFetch(() => json(201, { code: 'K7QX' })).fetch, 50);
    assert.deepEqual(created, { kind: 'created', code: 'K7QX' });

    const down = await requestCreate(SERVER, 'p', fakeFetch(() => new TypeError('Failed to fetch')).fetch, 50);
    assert.equal(down.kind, 'unreachable');
    const slow = await requestCreate(SERVER, 'p', fakeFetch(() => 'hang').fetch, 30);
    assert.deepEqual(slow, { kind: 'unreachable', why: 'timeout' });
    for (const status of [500, 502, 503, 429, 408]) {
      assert.equal((await requestCreate(SERVER, 'p', fakeFetch(() => json(status, { error: 'busy' })).fetch, 50)).kind, 'unreachable', String(status));
    }
    assert.deepEqual(await requestCreate(SERVER, 'p', fakeFetch(() => json(400, { error: 'body' })).fetch, 50), { kind: 'error', status: 400 });
    assert.deepEqual(await requestCreate(SERVER, 'p', fakeFetch(() => json(403, { error: 'origin' })).fetch, 50), { kind: 'error', status: 403 });
    const notOurs = await requestCreate(SERVER, 'p', fakeFetch(() => new Response('<html>no such worker</html>', { status: 404 })).fetch, 50);
    assert.equal(notOurs.kind, 'unreachable', "a 4xx that isn't the room server's answer");
    assert.equal((await requestCreate(SERVER, 'p', fakeFetch(() => json(201, { code: 'nope!' })).fetch, 50)).kind, 'unreachable');
    assert.equal(isUnavailable(404), false);
  });

  test('probe: exists → server; not found → not found; unreachable, 5xx, 429 → P2P; a 4xx refusal → error', async () => {
    assert.deepEqual(await probeRoom(SERVER, 'K7QX', fakeFetch(() => json(200, { code: 'K7QX', exists: true })).fetch, 50), { kind: 'exists' });
    assert.deepEqual(await probeRoom(SERVER, 'K7QX', fakeFetch(() => json(200, { code: 'K7QX', exists: false })).fetch, 50), { kind: 'notFound' });
    assert.deepEqual(await probeRoom(SERVER, 'K7QX', fakeFetch(() => json(404, { error: 'notFound' })).fetch, 50), { kind: 'notFound' }, 'a malformed code');
    assert.equal((await probeRoom(SERVER, 'K7QX', fakeFetch(() => new Response('<html>hi</html>', { status: 200 })).fetch, 50)).kind, 'unreachable', 'not the room server');
    assert.equal((await probeRoom(SERVER, 'K7QX', fakeFetch(() => new TypeError('offline')).fetch, 50)).kind, 'unreachable');
    assert.equal((await probeRoom(SERVER, 'K7QX', fakeFetch(() => 'hang').fetch, 30)).kind, 'unreachable');
    assert.equal((await probeRoom(SERVER, 'K7QX', fakeFetch(() => json(503, {})).fetch, 50)).kind, 'unreachable');
    assert.equal((await probeRoom(SERVER, 'K7QX', fakeFetch(() => json(429, { error: 'quota' })).fetch, 50)).kind, 'unreachable');
    assert.equal((await probeRoom(SERVER, 'K7QX', fakeFetch(() => new Response('gone', { status: 404 })).fetch, 50)).kind, 'unreachable');
    assert.deepEqual(await probeRoom(SERVER, 'K7QX', fakeFetch(() => json(400, { error: 'bad' })).fetch, 50), { kind: 'error', status: 400 });
  });
});

describe('opening rooms (hybrid)', () => {
  test('create with the server up: a server room, the creator joins as a guest', async () => {
    const { fetch, calls } = fakeFetch(() => json(201, { code: 'K7QX' }));
    const { d, opened } = deps(fetch);
    const result = await openOnline(null, ME, d);
    assert.ok(result.ok);
    assert.deepEqual([result.room.code, result.room.mode, result.room.fallback], ['K7QX', 'server', false]);
    assert.deepEqual(opened, ['server K7QX']);
    assert.deepEqual(calls, ['POST /rooms {"playerId":"player-ana"}'], 'the creator is named');
  });

  test('create with the server down or out of quota: a P2P room, flagged as a fallback', async () => {
    for (const answer of [() => new TypeError('Failed to fetch'), () => json(503, {}), () => json(429, { error: 'quota' }), () => 'hang' as const]) {
      const { d, opened } = deps(fakeFetch(answer).fetch);
      const result = await openOnline(null, ME, d);
      assert.ok(result.ok);
      assert.deepEqual([result.room.mode, result.room.fallback, result.room.code], ['p2p', true, 'P2PN']);
      assert.deepEqual(opened, ['p2p new']);
    }
  });

  test('create refused with a 4xx: an error, no fallback', async () => {
    const { d, opened } = deps(fakeFetch(() => json(400, { error: 'body' })).fetch);
    assert.deepEqual(await openOnline(null, ME, d), { ok: false, status: 400 });
    assert.deepEqual(opened, []);
  });

  test('typed code: server room if it exists; "not found" without trying P2P; P2P if the server is down', async () => {
    const up = deps(fakeFetch(() => json(200, { code: 'K7QX', exists: true })).fetch);
    const joined = await openOnline({ code: 'K7QX', mode: null }, ME, up.d);
    assert.ok(joined.ok);
    assert.deepEqual([joined.room.mode, joined.room.fallback], ['server', false]);
    assert.deepEqual(up.opened, ['server K7QX']);

    const missing = deps(fakeFetch(() => json(200, { code: 'M4ZE', exists: false })).fetch);
    const nf = await openOnline({ code: 'M4ZE', mode: null }, ME, missing.d);
    assert.ok(nf.ok);
    assert.deepEqual(nf.room.session.getState().status, 'denied');
    assert.deepEqual(nf.room.session.getState().denied, 'notFound');
    assert.deepEqual(missing.opened, [], 'no P2P, no socket');

    const down = deps(fakeFetch(() => new TypeError('offline')).fetch);
    const fb = await openOnline({ code: 'K7QX', mode: null }, ME, down.d);
    assert.ok(fb.ok);
    assert.deepEqual([fb.room.mode, fb.room.fallback, fb.room.code], ['p2p', true, 'K7QX']);
    assert.deepEqual(down.opened, ['p2p K7QX'], 'the same code over P2P');
  });

  test('a known server room (Try again) stays on the server, even if it is unreachable', async () => {
    const { fetch, calls } = fakeFetch(() => new TypeError('offline'));
    const { d, opened } = deps(fetch);
    const r = await openOnline({ code: 'K7QX', mode: 'server' }, ME, d);
    assert.ok(r.ok);
    assert.deepEqual([r.room.mode, r.room.fallback], ['server', false]);
    assert.deepEqual(opened, ['server K7QX'], 'no P2P: the transport keeps retrying the server');
    assert.deepEqual(calls, []);
  });

  test('#p- links go straight to P2P; with no server configured everything is P2P', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, {}));
    const linked = deps(fetch);
    const r = await openOnline({ code: 'K7QX', mode: 'p2p' }, ME, linked.d);
    assert.ok(r.ok);
    assert.deepEqual([r.room.mode, r.room.fallback], ['p2p', false]);
    assert.deepEqual(linked.opened, ['p2p K7QX']);
    assert.deepEqual(calls, [], 'the server is not asked');

    const none = deps(fetch, null);
    const created = await openOnline(null, ME, none.d);
    const joined = await openOnline({ code: 'K7QX', mode: null }, ME, none.d);
    assert.ok(created.ok && joined.ok);
    assert.deepEqual([created.room.mode, created.room.fallback, joined.room.mode, joined.room.fallback], ['p2p', false, 'p2p', false]);
    assert.deepEqual(none.opened, ['p2p new', 'p2p K7QX']);
    assert.deepEqual(calls, []);
  });
});
