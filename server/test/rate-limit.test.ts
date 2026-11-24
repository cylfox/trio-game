// Rate limit tests: the sliding windows, the two-layer limiter (isolate memory, then the per-IP
// Durable Object), failing open, and IP hashing.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { RATE_LIMITS, SlidingWindows, clientIp, createLimiter, ipKey } from '../src/rate-limit.ts';
import type { LimitKind, LimitResult } from '../src/rate-limit.ts';

describe('rate limits', () => {
  test('about 10 creates and 30 joins per minute per IP', () => {
    assert.deepEqual(RATE_LIMITS, { create: { limit: 10, windowMs: 60_000 }, connect: { limit: 30, windowMs: 60_000 } });
  });

  test('sliding window: the limit, Retry-After, and recovery one window later', () => {
    const w = new SlidingWindows();
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) assert.equal(w.hit('create', 'ip-a', t0 + i * 1000).ok, true, `create ${i + 1}`);
    assert.deepEqual(w.hit('create', 'ip-a', t0 + 10_000), { ok: false, retryAfter: 50 }, 'the 11th within a minute');
    assert.equal(w.hit('create', 'ip-b', t0 + 10_000).ok, true, 'another IP is not affected');
    assert.equal(w.hit('connect', 'ip-a', t0 + 10_000).ok, true, 'kinds are counted apart');
    // Refused calls don't count: the oldest slot frees at t0 + 60 s.
    for (let i = 0; i < 100; i++) assert.equal(w.hit('create', 'ip-a', t0 + 20_000).ok, false);
    assert.deepEqual(w.hit('create', 'ip-a', t0 + 59_999), { ok: false, retryAfter: 1 });
    assert.equal(w.hit('create', 'ip-a', t0 + 60_001).ok, true);
  });

  test('a reconnecting client stays well under the join limit', () => {
    // The client backs off 0.5, 1, 2, 4, 8, 10, 10 … s: at most ~10 attempts a minute, plus a probe.
    const w = new SlidingWindows();
    let t = 0;
    const delays = [500, 1000, 2000, 4000, 8000, ...Array(20).fill(10_000)];
    let refused = 0;
    for (const d of delays) {
      t += d;
      if (!w.hit('connect', 'phone', t).ok) refused++;
    }
    assert.equal(refused, 0);
  });

  test('memory stays bounded: least recently used keys go first', () => {
    const w = new SlidingWindows(RATE_LIMITS, 3);
    for (const ip of ['a', 'b', 'c']) w.hit('create', ip, 0);
    w.hit('create', 'a', 1); // a is fresh again
    w.hit('create', 'd', 2); // evicts b
    assert.equal(w.size, 3);
    for (let i = 0; i < 9; i++) w.hit('create', 'a', 3);
    assert.equal(w.hit('create', 'a', 4).ok, false, "a's count survived");
  });

  test('two layers: the isolate refuses floods without asking the Durable Object; the Durable Object has the last word', async () => {
    const asked: string[] = [];
    let remoteAnswer: LimitResult = { ok: true, retryAfter: 0 };
    const limit = createLimiter({
      local: new SlidingWindows(),
      remote: async (kind: LimitKind, key: string) => {
        asked.push(`${kind}:${key}`);
        return remoteAnswer;
      },
      clock: () => 5000,
    });
    for (let i = 0; i < 10; i++) assert.equal((await limit('create', '203.0.113.7')).ok, true);
    assert.equal(asked.length, 10);
    const local = await limit('create', '203.0.113.7');
    assert.equal(local.ok, false);
    assert.equal(asked.length, 10, 'refused locally: no Durable Object request');
    assert.match(asked[0], /^create:[0-9a-f]{24}$/, 'keyed by a hash, not the address');
    assert.ok(!asked[0].includes('203.0.113.7'));

    remoteAnswer = { ok: false, retryAfter: 42 };
    assert.deepEqual(await limit('connect', '198.51.100.1'), { ok: false, retryAfter: 42 }, 'another isolate already counted this IP');
  });

  test('fails open when the limiter object is unavailable', async () => {
    const errors: string[] = [];
    const limit = createLimiter({
      local: new SlidingWindows(),
      remote: async () => {
        throw new Error('quota exceeded');
      },
      log: (message) => errors.push(message),
    });
    assert.deepEqual(await limit('connect', '192.0.2.1'), { ok: true, retryAfter: 0 });
    assert.equal(errors.length, 1);
  });

  test('IP keys: stable, distinct, and the IP comes from CF-Connecting-IP', async () => {
    assert.equal(await ipKey('192.0.2.1'), await ipKey('192.0.2.1'));
    assert.notEqual(await ipKey('192.0.2.1'), await ipKey('192.0.2.2'));
    assert.equal(clientIp(new Request('https://x.test/', { headers: { 'CF-Connecting-IP': '192.0.2.9', 'X-Forwarded-For': '6.6.6.6' } })), '192.0.2.9');
    assert.equal(clientIp(new Request('https://x.test/')), 'unknown');
  });
});
