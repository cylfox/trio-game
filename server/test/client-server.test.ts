// The real client stack (guest.ts over ws-transport.ts) against the room server's logic
// (RoomHost), in one process. A queued fake network sits between them; time, timers and the
// Durable Object alarm are fake. Covers reconnects, a vanished creator, and an evicted object.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findSets } from '../../src/lib/engine/engine.ts';
import type { CardId, PublicView } from '../../src/lib/engine/engine.ts';
import { createGuest } from '../../src/lib/net/guest.ts';
import type { Change, RoomSession } from '../../src/lib/net/session.ts';
import { createWebSocketTransport } from '../../src/lib/net/ws-transport.ts';
import type { SocketLike, WebSocketTransport } from '../../src/lib/net/ws-transport.ts';
import { RoomHost } from '../src/room-host.ts';
import type { RoomSocket, RoomStorage } from '../src/room-host.ts';

function harness() {
  let now = 1_700_000_000_000;
  let nextTimer = 0;
  let timers: Array<{ id: number; at: number; fn: () => void }> = [];
  const queue: Array<() => void> = [];
  const kv = new Map<string, string>();
  let alarm: number | null = null;
  const open = new Set<ServerSide>();
  let peers = 0;
  let serverUp = true;

  const storage: RoomStorage = {
    get: (key) => (kv.has(key) ? JSON.parse(kv.get(key) ?? 'null') : undefined),
    put: (key, value) => void kv.set(key, JSON.stringify(value)),
    deleteAll: () => {
      kv.clear();
      alarm = null;
    },
    setAlarm: (at) => {
      alarm = at;
    },
  };
  const makeHost = () =>
    new RoomHost({ storage, sockets: () => [...open], alarm, clock: () => now, newPeerId: () => `peer-${++peers}`, seed: () => 11, log: (m, e) => assert.fail(`${m}: ${String(e)}`) });
  let host = makeHost();

  class ServerSide implements RoomSocket {
    client: ClientSide;
    private attachment: string | null = null;
    gone = false;
    constructor(client: ClientSide) {
      this.client = client;
    }
    send(message: string): void {
      if (this.gone) throw new Error('closed');
      const c = this.client;
      queue.push(() => c.onmessage?.({ data: message }));
    }
    close(code?: number, reason?: string): void {
      if (this.gone) return;
      this.gone = true;
      open.delete(this);
      const c = this.client;
      queue.push(() => c.onclose?.({ code: code ?? 1000, reason: reason ?? '' }));
    }
    serializeAttachment(value: unknown): void {
      this.attachment = JSON.stringify(value);
    }
    deserializeAttachment(): unknown {
      return this.attachment === null ? null : JSON.parse(this.attachment);
    }
  }

  class ClientSide implements SocketLike {
    onopen: SocketLike['onopen'] = null;
    onmessage: SocketLike['onmessage'] = null;
    onclose: SocketLike['onclose'] = null;
    onerror: SocketLike['onerror'] = null;
    server: ServerSide | null = null;
    send(data: string): void {
      const s = this.server;
      if (s === null || s.gone) return;
      queue.push(() => {
        if (!s.gone) host.message(s, data);
      });
    }
    close(): void {
      const s = this.server;
      if (s === null || s.gone) return;
      // Like a real WebSocket: what was sent before close() (a bye) still arrives first.
      queue.push(() => {
        if (s.gone) return;
        s.gone = true;
        open.delete(s);
        host.closed(s);
      });
    }
  }

  const connect = (_url: string): SocketLike => {
    const client = new ClientSide();
    queue.push(() => {
      if (!serverUp) return client.onclose?.({ code: 1006, reason: '' });
      const server = new ServerSide(client);
      client.server = server;
      open.add(server);
      client.onopen?.({});
      host.connect(server);
    });
    return client;
  };

  const h = {
    get host() {
      return host;
    },
    flush() {
      for (let guard = 0; queue.length > 0; guard++) {
        if (guard > 100_000) throw new Error('network loop');
        queue.shift()?.();
      }
    },
    /** Move time, firing client timers and the room's alarm in order, delivering as we go. */
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        h.flush();
        const timer = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        const alarmDue = alarm !== null && alarm <= target && (timer === undefined || alarm <= timer.at);
        if (alarmDue && alarm !== null) {
          now = Math.max(now, alarm);
          alarm = null;
          host.alarm();
          continue;
        }
        if (timer === undefined) break;
        timers = timers.filter((t) => t !== timer);
        now = Math.max(now, timer.at);
        timer.fn();
      }
      now = target;
      h.flush();
    },
    player(id: string, name = id): { session: RoomSession; transport: WebSocketTransport } {
      const transport = createWebSocketTransport(`ws://room.test/rooms/K7QX/ws`, {
        open: connect,
        schedule: (fn, ms) => {
          const timer = { id: nextTimer++, at: now + ms, fn };
          timers.push(timer);
          return () => {
            timers = timers.filter((t) => t !== timer);
          };
        },
        random: () => 1,
        onWake: () => () => {},
      });
      const session = createGuest({ transport, code: 'K7QX', me: { id, name }, clock: () => now });
      return { session, transport };
    },
    /** The network drops every connection (both sides see it). */
    dropAll() {
      for (const s of [...open]) {
        s.gone = true;
        open.delete(s);
        const c = s.client;
        queue.push(() => c.onclose?.({ code: 1006, reason: '' }));
        queue.push(() => host.closed(s));
      }
    },
    /** The Durable Object is evicted; the next event wakes a new one. */
    hibernate() {
      host = makeHost();
    },
    setServerUp(up: boolean) {
      serverUp = up;
    },
  };
  return h;
}

function view(s: RoomSession): PublicView {
  const v = s.getState().view;
  assert.ok(v !== null, 'has a view');
  return v;
}

function aSet(s: RoomSession): CardId[] {
  return [...findSets(view(s).board.filter((c): c is CardId => c !== null))[0]];
}

function score(s: RoomSession, id: string): number {
  return view(s).players.find((p) => p.id === id)?.score ?? NaN;
}

function inSync(a: RoomSession, b: RoomSession): void {
  assert.equal(a.getState().status, 'online');
  assert.equal(b.getState().status, 'online');
  assert.deepEqual(a.getState().view, b.getState().view);
  assert.deepEqual(a.getState().room, b.getState().room);
  assert.equal(a.getState().seq, b.getState().seq);
}

describe('clients and room server together (guest + WebSocket transport + RoomHost)', () => {
  test('create, play, an alarm timeout, the creator leaving (game paused) and coming back to the same seat', async () => {
    const h = harness();
    h.host.create('K7QX', 'ana');
    const ana = h.player('ana', 'Ana');
    const ben = h.player('ben', 'Ben');
    h.flush();
    inSync(ana.session, ben.session);
    assert.equal(ana.session.getState().room?.hostId, 'ana', 'the creator hosts, as a protocol guest');
    ana.session.act({ type: 'start' });
    h.flush();
    inSync(ana.session, ben.session);

    ben.session.act({ type: 'call' });
    ben.session.act({ type: 'claim', cards: aSet(ben.session) });
    h.flush();
    assert.equal(score(ana.session, 'ben'), 3);

    // Ana calls, then leaves (Leave: she says bye): the server's alarm still expires her call.
    const benHeard: Change[] = [];
    ben.session.subscribe((_state, change) => benHeard.push(change));
    ana.session.act({ type: 'call' });
    h.flush();
    await ana.session.leave();
    h.flush();
    const anaSeat = () => ben.session.getState().room?.seats.find((s) => s.id === 'ana');
    assert.deepEqual([anaSeat()?.connected, anaSeat()?.quit], [false, true], 'left on purpose');
    assert.deepEqual(
      benHeard.filter((c) => c.type === 'leave'),
      [{ type: 'leave', playerId: 'ana', name: 'Ana', quit: true }],
    );
    h.advance(5000);
    assert.equal(view(ben.session).lock, null, 'expired by the alarm with the creator gone');
    assert.equal(score(ben.session, 'ana'), -1);

    // The game is paused without her: Ben can't call.
    ben.session.act({ type: 'call' });
    h.flush();
    assert.equal(view(ben.session).lock, null, 'paused');
    assert.deepEqual(benHeard.at(-1), { type: 'rejected', intent: 'call', reason: 'paused' });

    // A third player can't take her seat.
    const carl = h.player('carl');
    h.flush();
    assert.equal(carl.session.getState().status, 'denied');
    assert.equal(carl.session.getState().denied, 'full');

    // 20 s later she reopens the link: same seat, same score, still the host.
    h.advance(20_000);
    const ana2 = h.player('ana', 'Ana');
    h.flush();
    inSync(ana2.session, ben.session);
    assert.equal(score(ana2.session, 'ana'), -1);
    assert.deepEqual([anaSeat()?.connected, anaSeat()?.quit], [true, false]);
    ben.session.act({ type: 'call' });
    h.flush();
    assert.equal(view(ana2.session).lock?.playerId, 'ben', 'back on: calls work again');
    ana2.session.act({ type: 'start' }); // host powers kept: a new game
    h.flush();
    assert.deepEqual(view(ben.session).players.map((p) => p.score), [0, 0]);
  });

  test('network drop: both reconnect with backoff, resync by snapshot, and play on; also after the object is evicted', () => {
    const h = harness();
    h.host.create('K7QX', 'ana');
    const ana = h.player('ana');
    const ben = h.player('ben');
    h.flush();
    ana.session.act({ type: 'start' });
    h.flush();
    ana.session.act({ type: 'call' });
    ana.session.act({ type: 'claim', cards: aSet(ana.session) });
    h.flush();
    const seq = ana.session.getState().seq;

    h.dropAll();
    h.flush();
    assert.equal(ana.session.getState().status, 'hostAway', 'shown as reconnecting');
    ana.session.act({ type: 'call' });
    h.flush();
    h.advance(500); // first retry
    inSync(ana.session, ben.session);
    assert.ok(ana.session.getState().seq > seq);
    assert.equal(score(ben.session, 'ana'), 3, 'nothing lost');
    assert.deepEqual(ben.session.getState().room?.seats.map((s) => s.connected), [true, true]);

    // The object is evicted and the server is unreachable for a while.
    h.hibernate();
    h.setServerUp(false);
    h.dropAll();
    h.advance(10_000);
    assert.equal(ben.session.getState().status, 'hostAway');
    h.setServerUp(true);
    h.advance(10_000);
    inSync(ana.session, ben.session);
    ben.session.act({ type: 'call' });
    h.flush();
    assert.equal(view(ana.session).lock?.playerId, 'ben');
    h.advance(5000);
    assert.equal(view(ana.session).lock, null, "the new object's alarm expired it");
  });

  test('an unknown room is denied once, without a reconnect loop', () => {
    const h = harness();
    const zoe = h.player('zoe');
    h.flush();
    assert.equal(zoe.session.getState().status, 'denied');
    assert.equal(zoe.session.getState().denied, 'notFound');
    h.advance(60_000);
    assert.equal(zoe.session.getState().status, 'denied');
  });
});
