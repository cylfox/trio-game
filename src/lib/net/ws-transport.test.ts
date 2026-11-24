// WebSocket transport tests: a fake socket and fake timers drive reconnects, backoff, wake-ups,
// the heartbeat and the "don't come back" close codes.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVER_PEER, TIMING, createWebSocketTransport, isFinalClose } from './ws-transport.ts';
import type { SocketLike, WebSocketTransportOptions } from './ws-transport.ts';

function fakeTime(start = 1_000_000) {
  let now = start;
  let nextId = 0;
  let timers: Array<{ id: number; at: number; fn: () => void }> = [];
  return {
    clock: () => now,
    schedule: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (due === undefined) break;
        timers = timers.filter((t) => t !== due);
        now = Math.max(now, due.at);
        due.fn();
      }
      now = target;
    },
    pending: () => timers.map((t) => t.at - now).sort((a, b) => a - b),
  };
}

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  readonly sent: string[] = [];
  closedWith: number | undefined | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number): void {
    this.closedWith = code;
  }
  // Server side of the fake:
  accept(): void {
    this.onopen?.({});
  }
  push(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  hangUp(code = 1006): void {
    this.onclose?.({ code, reason: '' });
  }
}

function setup(extra: Partial<WebSocketTransportOptions> = {}) {
  const time = fakeTime();
  const sockets: FakeSocket[] = [];
  let wake: () => void = () => {};
  const transport = createWebSocketTransport('ws://room.test/rooms/K7QX/ws', {
    open: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    schedule: time.schedule,
    random: () => 1, // no jitter: delays are exactly base × 2^n
    onWake: (fn) => {
      wake = fn;
      return () => {
        wake = () => {};
      };
    },
    ...extra,
  });
  const log: string[] = [];
  transport.onPeerJoin((p) => log.push(`join ${p}`));
  transport.onPeerLeave((p) => log.push(`leave ${p}`));
  transport.onMessage((m, from) => log.push(`msg ${from} ${JSON.stringify(m)}`));
  transport.onError((e) => log.push(`error ${e.code}`));
  return { time, sockets, transport, log, wake: () => wake(), last: () => sockets[sockets.length - 1] };
}

describe('WebSocket transport', () => {
  test('the server is one peer: join on open, messages, leave on close', () => {
    const { sockets, transport, log, last } = setup();
    assert.equal(sockets.length, 1);
    assert.equal(last().url, 'ws://room.test/rooms/K7QX/ws');
    transport.send('anyone', { t: 'hello' });
    assert.deepEqual(last().sent, [], 'nothing is sent before the socket opens');
    last().accept();
    assert.deepEqual(log, [`join ${SERVER_PEER}`]);
    transport.send('server', { t: 'hello' });
    transport.broadcast({ t: 'act' });
    assert.deepEqual(last().sent, ['{"t":"hello"}', '{"t":"act"}']);
    last().push({ t: 'state', seq: 1 });
    last().push('not json');
    last().push('pong');
    assert.deepEqual(log.slice(1), ['msg server {"t":"state","seq":1}'], 'junk and pongs are not messages');
    let replayed = '';
    transport.onPeerJoin((p) => (replayed = p));
    assert.equal(replayed, SERVER_PEER, 'a late subscriber learns the server is there');
  });

  test('reconnects with exponential backoff (capped), and reports the outage once', () => {
    const { time, sockets, log, last } = setup();
    last().accept();
    last().hangUp();
    assert.deepEqual(log, ['join server', 'leave server']);
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      delays.push(time.pending()[0]);
      time.advance(delays[i]);
      last().hangUp(); // still down
    }
    assert.deepEqual(delays, [500, 1000, 2000, 4000, 8000, 10_000, 10_000]);
    assert.equal(sockets.length, 8);
    assert.equal(log.filter((l) => l === 'error server-unreachable').length, 1, 'once per outage');
    time.advance(time.pending()[0]);
    last().accept();
    assert.equal(log.at(-1), 'join server');
    last().hangUp();
    time.advance(500);
    assert.equal(sockets.length, 10, 'backoff resets after a good connection');
  });

  test('jitter spreads retries between half and all of the delay', () => {
    const { time, last } = setup({ random: () => 0 });
    last().hangUp();
    assert.deepEqual(time.pending().slice(0, 1), [250]);
  });

  test('close codes 4400–4499 (not found, full, expired) stop reconnecting', () => {
    assert.equal(isFinalClose(4404), true);
    assert.equal(isFinalClose(1006), false);
    assert.equal(isFinalClose(1008), false);
    const { time, sockets, log, last } = setup();
    last().accept();
    last().push({ t: 'deny', reason: 'notFound' });
    last().hangUp(4404);
    time.advance(60_000);
    assert.equal(sockets.length, 1);
    assert.deepEqual(log, ['join server', 'msg server {"t":"deny","reason":"notFound"}', 'leave server']);
  });

  test('a socket that never opens is dropped after the connect timeout', () => {
    const { time, sockets, log } = setup();
    time.advance(TIMING.connectTimeoutMs);
    assert.equal(sockets[0].closedWith, undefined, 'closed');
    assert.equal(sockets.length, 1);
    time.advance(500);
    assert.equal(sockets.length, 2, 'and retried');
    assert.deepEqual(log, []);
  });

  test('heartbeat: a silent socket is dropped and replaced', () => {
    const { time, sockets, log, last } = setup();
    last().accept();
    time.advance(TIMING.pingEveryMs);
    assert.deepEqual(last().sent, ['ping']);
    last().push('pong');
    time.advance(TIMING.pongTimeoutMs);
    assert.equal(sockets.length, 1, 'answered: kept');
    time.advance(TIMING.pingEveryMs - TIMING.pongTimeoutMs);
    assert.deepEqual(last().sent, ['ping', 'ping']);
    time.advance(TIMING.pongTimeoutMs); // no answer
    assert.equal(log.at(-1), 'leave server');
    time.advance(500);
    assert.equal(sockets.length, 2, 'reconnected');
  });

  test('wake-up: reconnect at once when down, ping when up', () => {
    const { time, sockets, wake, last } = setup();
    last().accept();
    last().hangUp();
    for (let i = 0; i < 4; i++) {
      time.advance(time.pending()[0]);
      last().hangUp();
    }
    assert.equal(sockets.length, 5);
    wake(); // the tab is visible again / the network is back
    assert.equal(sockets.length, 6, 'no waiting for the backoff');
    last().accept();
    wake();
    assert.deepEqual(last().sent, ['ping'], 'an open socket is checked');
    time.advance(TIMING.pongTimeoutMs);
    assert.equal(sockets.length, 6);
    time.advance(500);
    assert.equal(sockets.length, 7, 'it was dead: replaced');
  });

  test('leave() closes the socket and stops everything', async () => {
    const { time, sockets, transport, wake, last } = setup();
    last().accept();
    await transport.leave();
    assert.equal(last().closedWith, 1000);
    wake();
    time.advance(120_000);
    assert.equal(sockets.length, 1);
    assert.deepEqual(time.pending(), []);
  });
});
