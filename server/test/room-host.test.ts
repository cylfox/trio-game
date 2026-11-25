// Room server tests: RoomHost (the Durable Object's logic) driven through fake sockets, storage and
// alarm, with a fake clock. "Hibernation" throws the RoomHost away and builds a new one from the
// same storage and sockets, like a Durable Object waking up.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findSets, isSet } from '../../src/lib/engine/engine.ts';
import type { CardId, GameEventType, PublicView } from '../../src/lib/engine/engine.ts';
import { PROTOCOL_VERSION } from '../../src/lib/net/protocol.ts';
import type { RoomInfo, StateMessage } from '../../src/lib/net/protocol.ts';
import { CLOSE, LIMITS, RoomHost } from '../src/room-host.ts';
import type { RoomSocket, RoomStorage } from '../src/room-host.ts';

// ── Harness ──────────────────────────────────────────────────────────────────────────────────

type Wire = Record<string, unknown> & { t?: string };

class FakeSocket implements RoomSocket {
  readonly received: Wire[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private attachment: string | null = null;
  private readonly onClose: (ws: FakeSocket) => void;
  constructor(onClose: (ws: FakeSocket) => void) {
    this.onClose = onClose;
  }
  send(message: string): void {
    if (this.closed !== null) throw new Error('send on a closed socket');
    this.received.push(message === 'pong' ? { t: 'pong' } : (JSON.parse(message) as Wire));
  }
  close(code?: number, reason?: string): void {
    if (this.closed !== null) return;
    this.closed = { code, reason };
    this.onClose(this);
  }
  serializeAttachment(value: unknown): void {
    this.attachment = JSON.stringify(value); // structured clone, like the runtime
  }
  deserializeAttachment(): unknown {
    return this.attachment === null ? null : JSON.parse(this.attachment);
  }
  /** The close code, if the server closed it (a method, so assertions don't narrow `closed`). */
  closeCode(): number | undefined {
    return this.closed?.code;
  }
  states(): StateMessage[] {
    return this.received.filter((m) => m.t === 'state') as unknown as StateMessage[];
  }
  last(): StateMessage {
    const s = this.states().at(-1);
    assert.ok(s !== undefined, 'has a state');
    return s;
  }
  view(): PublicView {
    const v = this.last().view;
    assert.ok(v !== null, 'has a view');
    return v;
  }
  room(): RoomInfo {
    return this.last().room;
  }
  of(t: string): Wire[] {
    return this.received.filter((m) => m.t === t);
  }
}

function world(start = 1_700_000_000_000) {
  let now = start;
  const kv = new Map<string, string>();
  let alarm: number | null = null;
  const open = new Set<FakeSocket>();
  let peers = 0;
  let writes = 0;
  const storage: RoomStorage = {
    get: (key) => (kv.has(key) ? JSON.parse(kv.get(key) ?? 'null') : undefined),
    put: (key, value) => {
      writes++;
      kv.set(key, JSON.stringify(value));
    },
    deleteAll: () => {
      kv.clear();
      alarm = null;
    },
    setAlarm: (at) => {
      alarm = at;
    },
  };
  const make = () =>
    new RoomHost({
      storage,
      sockets: () => [...open],
      alarm,
      clock: () => now,
      newPeerId: () => `peer-${++peers}`,
      seed: () => 7,
      log: (message, error) => {
        throw new Error(`${message}: ${String(error)}`);
      },
    });
  let host = make();
  const w = {
    kv,
    get host() {
      return host;
    },
    get alarm() {
      return alarm;
    },
    get writes() {
      return writes;
    },
    now: () => now,
    /** The object was evicted from memory; the next event wakes a new one. */
    hibernate() {
      host = make();
    },
    connect(): FakeSocket {
      assert.ok(host.canAccept(), 'room for a socket');
      const ws = new FakeSocket((s) => open.delete(s));
      open.add(ws);
      host.connect(ws);
      return ws;
    },
    send(ws: FakeSocket, message: unknown) {
      host.message(ws, typeof message === 'string' ? message : JSON.stringify(message));
    },
    hello(ws: FakeSocket, playerId: string, name = playerId) {
      w.send(ws, { t: 'hello', v: PROTOCOL_VERSION, playerId, name });
    },
    act(ws: FakeSocket, intent: unknown) {
      w.send(ws, { t: 'act', intent });
    },
    join(playerId: string, name = playerId): FakeSocket {
      const ws = w.connect();
      w.hello(ws, playerId, name);
      return ws;
    },
    /** The socket is gone without a close event (the runtime no longer lists it). */
    vanish(ws: FakeSocket) {
      open.delete(ws);
    },
    /** The client went away (tab killed, network gone). */
    drop(ws: FakeSocket) {
      open.delete(ws);
      host.closed(ws);
    },
    /** Move the clock, firing the alarm whenever it is due. */
    advance(ms: number) {
      const target = now + ms;
      while (alarm !== null && alarm <= target) {
        now = Math.max(now, alarm);
        alarm = null;
        host.alarm();
      }
      now = target;
    },
  };
  return w;
}

type World = ReturnType<typeof world>;

const CODE = 'K7QX';

function aSet(view: PublicView): CardId[] {
  const board = view.board.filter((c): c is CardId => c !== null);
  return [...findSets(board)[0]];
}

function nonSet(view: PublicView): CardId[] {
  const b = view.board.filter((c): c is CardId => c !== null);
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++) for (let k = j + 1; k < b.length; k++) if (!isSet(b[i], b[j], b[k])) return [b[i], b[j], b[k]];
  throw new Error('no non-set');
}

function score(view: PublicView, id: string): number {
  const p = view.players.find((x) => x.id === id);
  assert.ok(p !== undefined, `player ${id}`);
  return p.score;
}

function eventsOf(ws: FakeSocket): GameEventType[] {
  return ws.states().flatMap((s) => s.events.map((e) => e.type));
}

/** Both sockets hold the same latest state. */
function inSync(a: FakeSocket, b: FakeSocket): void {
  assert.deepEqual(a.last().view, b.last().view, 'same view');
  assert.deepEqual(a.last().room, b.last().room, 'same room');
  assert.equal(a.last().seq, b.last().seq, 'same seq');
}

/** A room created by Ana with Ben joined and the game started. */
function playing(): { w: World; ana: FakeSocket; ben: FakeSocket } {
  const w = world();
  assert.equal(w.host.create(CODE, 'ana'), true);
  const ana = w.join('ana', 'Ana');
  const ben = w.join('ben', 'Ben');
  w.act(ana, { type: 'start' });
  assert.equal(ben.room().phase, 'playing');
  return { w, ana, ben };
}

// ── Tests ────────────────────────────────────────────────────────────────────────────────────

describe('room server (RoomHost over fake sockets, storage and alarms)', () => {
  test('create claims a code once; joining gets a snapshot; the first call wins', () => {
    const w = world();
    assert.equal(w.host.exists(), false);
    assert.equal(w.host.create(CODE, 'ana'), true);
    assert.equal(w.host.create(CODE, 'eve'), false, 'the code is in use');
    assert.equal(w.host.exists(), true);
    assert.ok(w.kv.has('room'), 'saved on create');
    assert.equal(w.alarm, w.now() + LIMITS.idleMs, 'idle alarm armed');

    const ana = w.join('ana', 'Ana');
    assert.equal(ana.last().kind, 'snapshot');
    assert.deepEqual(ana.room(), {
      code: CODE,
      hostId: 'ana',
      maxPlayers: 2,
      phase: 'lobby',
      seats: [{ id: 'ana', name: 'Ana', connected: true, rematch: false, quit: false }],
    });
    assert.equal(ana.last().view, null);

    const ben = w.join('ben', 'Ben');
    assert.equal(ben.last().kind, 'snapshot');
    assert.equal(ana.last().kind, 'update');
    inSync(ana, ben);
    assert.deepEqual(ana.room().seats.map((s) => s.id), ['ana', 'ben']);

    w.act(ana, { type: 'start' });
    inSync(ana, ben);
    assert.equal(eventsOf(ben).includes('newGame'), true);
    assert.equal(ben.view().board.length >= 12, true);
    assert.equal(ben.last().at, w.now(), 'at = server clock');

    // Both press SET!: arrival order decides.
    w.act(ben, { type: 'call' });
    w.act(ana, { type: 'call' });
    inSync(ana, ben);
    assert.equal(ana.view().lock?.playerId, 'ben', 'first call wins');
    assert.ok(eventsOf(ana).includes('locked'), 'the loser gets the locked cue');
    assert.equal(score(ana.view(), 'ana'), 0, 'losing the race costs nothing');
  });

  test('claims: +3 for a set, −1 for a wrong pick; a claim without a call is refused', () => {
    const { w, ana, ben } = playing();
    w.act(ben, { type: 'call' });
    w.act(ben, { type: 'claim', cards: aSet(ben.view()) });
    inSync(ana, ben);
    assert.equal(score(ana.view(), 'ben'), 3);
    assert.equal(ana.view().lock, null);

    w.act(ana, { type: 'claim', cards: aSet(ana.view()) });
    assert.deepEqual(ana.of('reject').at(-1), { t: 'reject', intent: 'claim', reason: 'noCall' });

    w.act(ana, { type: 'call' });
    w.act(ana, { type: 'claim', cards: nonSet(ana.view()) });
    inSync(ana, ben);
    assert.equal(score(ben.view(), 'ana'), -1, 'wrong at 0 costs 1');
    assert.ok(eventsOf(ben).includes('wrong'));
  });

  test('a call that runs out is expired by the alarm (−3 at 3 points)', () => {
    const { w, ana, ben } = playing();
    w.act(ben, { type: 'call' });
    w.act(ben, { type: 'claim', cards: aSet(ben.view()) });
    assert.equal(score(ana.view(), 'ben'), 3);

    w.act(ben, { type: 'call' });
    const deadline = ana.view().lock?.deadline;
    assert.equal(deadline, w.now() + 5000);
    assert.equal(w.alarm, deadline, 'the alarm is the call deadline');
    w.advance(4999);
    assert.equal(ana.view().lock?.playerId, 'ben', 'still held');
    w.advance(1);
    inSync(ana, ben);
    assert.equal(ana.view().lock, null, 'expired by the alarm');
    assert.equal(score(ana.view(), 'ben'), 0, 'timeout at 3 costs 3');
    assert.equal(ana.view().players.find((p) => p.id === 'ben')?.timeouts, 1);
    assert.ok(eventsOf(ana).includes('timeout'));
    assert.equal(w.alarm, w.now() + LIMITS.idleMs, 'back to the idle alarm');
  });

  test('hibernation: state and socket attachments survive, play and the timer continue', () => {
    const { w, ana, ben } = playing();
    w.act(ana, { type: 'call' });
    w.act(ana, { type: 'claim', cards: aSet(ana.view()) });
    w.act(ben, { type: 'call' }); // Ben holds a call when the object is evicted
    const before = ben.last();
    assert.deepEqual(ana.deserializeAttachment(), { peer: 'peer-1', playerId: 'ana' });
    assert.deepEqual(ben.deserializeAttachment(), { peer: 'peer-2', playerId: 'ben' });

    const count = ana.received.length;
    w.hibernate();
    assert.equal(w.host.exists(), true, 'rebuilt from storage');
    assert.equal(ana.received.length, count, 'waking up sends nothing');
    w.advance(5000); // the alarm wakes the new object, which expires Ben's call
    inSync(ana, ben);
    assert.equal(ben.last().epoch, before.epoch, 'same room incarnation');
    assert.equal(ben.last().seq, before.seq + 1, 'seq continues');
    assert.equal(score(ana.view(), 'ana'), 3, 'score kept');
    assert.equal(score(ana.view(), 'ben'), -1, 'timeout charged after waking');

    w.hibernate();
    w.act(ana, { type: 'call' }); // the old socket's attachment still says who it is
    assert.equal(ben.view().lock?.playerId, 'ana');
    w.act(ana, { type: 'claim', cards: aSet(ana.view()) });
    inSync(ana, ben);
    assert.equal(score(ben.view(), 'ana'), 6);
  });

  test('hibernation: a socket that closed while the object slept is noticed on wake-up', () => {
    const { w, ana, ben } = playing();
    w.vanish(ben); // gone, and no close event reached the sleeping object
    w.hibernate(); // a fresh object wakes up without Ben's socket
    assert.deepEqual(ana.room().seats.map((s) => [s.id, s.connected]), [
      ['ana', true],
      ['ben', false],
    ]);
    assert.equal(ana.last().kind, 'update', 'Ana was told');
    const count = ana.received.length;
    w.host.closed(ben); // the late close event changes nothing more
    assert.equal(ana.received.length, count);
    w.act(ana, { type: 'call' });
    assert.equal(ana.view().lock, null, 'paused while Ben is away');
    assert.deepEqual(ana.of('reject').at(-1), { t: 'reject', intent: 'call', reason: 'paused' });
  });

  test('a player who reconnects keeps the seat and score; a third player is denied (room full)', () => {
    const { w, ana, ben } = playing();
    w.act(ben, { type: 'call' });
    w.act(ben, { type: 'claim', cards: aSet(ben.view()) });
    w.drop(ben); // Ben's phone locks
    assert.deepEqual(ana.room().seats.map((s) => [s.id, s.connected]), [
      ['ana', true],
      ['ben', false],
    ]);

    const carl = w.join('carl', 'Carl');
    assert.deepEqual(carl.of('deny'), [{ t: 'deny', reason: 'full', maxPlayers: 2 }]);
    assert.equal(carl.closed?.code, CLOSE.full, 'turned away for good');
    assert.equal(carl.states().length, 0);

    const ben2 = w.join('ben', 'Ben');
    assert.equal(ben2.last().kind, 'snapshot');
    inSync(ana, ben2);
    assert.equal(score(ben2.view(), 'ben'), 3, 'score kept');
    assert.equal(ben2.room().seats.find((s) => s.id === 'ben')?.connected, true);
    w.act(ben2, { type: 'call' });
    assert.equal(ana.view().lock?.playerId, 'ben', 'the rejoined player can play');
  });

  test('the creator keeps the host powers; a seat is kept for them until they arrive', () => {
    const w = world();
    w.host.create(CODE, 'ana');
    const ben = w.join('ben', 'Ben'); // the guest opens the link before the creator connects
    const carl = w.join('carl', 'Carl');
    assert.equal(carl.closed?.code, CLOSE.full, "the creator's seat is reserved");
    w.act(ben, { type: 'start' });
    assert.deepEqual(ben.of('reject').at(-1), { t: 'reject', intent: 'start', reason: 'hostOnly' });

    const ana = w.join('ana', 'Ana');
    assert.deepEqual(ana.room().seats.map((s) => s.id), ['ana', 'ben'], 'the host sits first');
    assert.equal(ana.room().hostId, 'ana');
    w.act(ana, { type: 'start' });
    assert.equal(ben.room().phase, 'playing');

    // New game mid-game: host only.
    w.act(ana, { type: 'call' });
    w.act(ana, { type: 'claim', cards: aSet(ana.view()) });
    w.act(ben, { type: 'start' });
    assert.deepEqual(ben.of('reject').at(-1), { t: 'reject', intent: 'start', reason: 'hostOnly' });
    w.act(ana, { type: 'start' });
    assert.deepEqual(ben.view().players.map((p) => p.score), [0, 0], 'a fresh game');

    // Play to the end; the guest asks for a rematch, the host starts it.
    for (let i = 0; i < 40 && !ana.view().over; i++) {
      w.act(ana, { type: 'call' });
      w.act(ana, { type: 'claim', cards: aSet(ana.view()) });
      w.advance(1000); // a human pace, well under the flood limit
    }
    assert.equal(ana.closed, null);
    assert.equal(ben.room().phase, 'over');
    w.act(ben, { type: 'rematch' });
    assert.deepEqual(ana.room().seats.map((s) => s.rematch), [false, true]);
    w.act(ana, { type: 'start' });
    assert.equal(ben.room().phase, 'playing');
    assert.equal(ben.view().over, false);

    // Without a creator from POST, the first player to say hello hosts.
    const w2 = world();
    w2.host.create('M4ZE', null);
    const first = w2.join('zoe');
    assert.equal(first.room().hostId, 'zoe');
  });

  test('a room in the lobby frees a leaving guest seat but keeps the host seat', () => {
    const w = world();
    w.host.create(CODE, 'ana');
    const ana = w.join('ana');
    const ben = w.join('ben');
    w.drop(ben);
    assert.deepEqual(ana.room().seats.map((s) => s.id), ['ana']);
    const carl = w.join('carl');
    w.drop(ana);
    assert.deepEqual(carl.room().seats.map((s) => [s.id, s.connected]), [
      ['ana', false],
      ['carl', true],
    ]);
  });

  test('bad, oversized and binary messages change nothing; floods and garbage get the socket closed', () => {
    const { w, ana, ben } = playing();
    const seq = ana.last().seq;
    const writes = w.writes;
    const junk: unknown[] = [
      'not json',
      '{"t":"act","intent":{"type":"nuke"}}',
      { t: 'act', intent: { type: 'claim', cards: [1, 2] } },
      { t: 'hello', v: 1, playerId: 'x'.repeat(65) },
      { t: 'hello', v: 1 },
      { t: 'state', seq: 99 },
      [],
      null,
      'x'.repeat(LIMITS.messageChars + 1),
    ];
    for (const message of junk) w.send(ana, message);
    w.host.message(ana, new ArrayBuffer(8));
    assert.equal(ana.last().seq, seq, 'nothing changed');
    assert.equal(ben.last().seq, seq);
    assert.equal(w.writes, writes, 'nothing saved');
    assert.equal(ana.closeCode(), undefined, 'a few bad messages are tolerated');
    w.send(ana, 'ping');
    assert.deepEqual(ana.received.at(-1), { t: 'pong' });

    // An unidentified socket's intents are ignored.
    const lurker = w.connect();
    w.act(lurker, { type: 'call' });
    assert.equal(lurker.received.length, 0);
    assert.equal(ana.view().lock, null);

    // More garbage: closed as abusive.
    w.send(ana, 'junk');
    w.send(ana, 'junk');
    assert.equal(ana.closed?.code, CLOSE.abuse);
    assert.equal(ben.room().seats.find((s) => s.id === 'ana')?.connected, false, 'the others see the player go');

    // A flood: the burst passes, then the socket is closed.
    for (let i = 0; i < LIMITS.burst + 5 && ben.closed === null; i++) w.act(ben, { type: 'hint' });
    assert.equal(ben.closed?.code, CLOSE.abuse);
    assert.equal(ben.of('reject').length, LIMITS.burst - 1, 'the burst, less the token its hello used');
  });

  test('a steady pace is not a flood', () => {
    const { w, ben } = playing();
    for (let i = 0; i < 100; i++) {
      w.act(ben, { type: 'hint' });
      w.advance(200);
    }
    assert.equal(ben.closed, null);
  });

  test('unknown rooms: notFound, and nothing is written', () => {
    const w = world();
    const ws = w.connect();
    assert.deepEqual(ws.received, [{ t: 'deny', reason: 'notFound', maxPlayers: 2 }]);
    assert.equal(ws.closed?.code, CLOSE.notFound);
    assert.equal(w.kv.size, 0);
    assert.equal(w.alarm, null);
    w.host.alarm(); // a stray alarm on an empty room is harmless
    assert.equal(w.kv.size, 0);
  });

  test('inactivity: a day without changes deletes the room; activity postpones it', () => {
    const { w, ana, ben } = playing();
    w.advance(LIMITS.idleMs - 60_000);
    w.act(ana, { type: 'call' });
    w.act(ana, { type: 'claim', cards: aSet(ana.view()) }); // activity: the clock restarts
    w.advance(2 * 60_000);
    assert.equal(w.host.exists(), true, 'the old idle alarm re-checks and re-arms');
    assert.equal(ana.closed, null);

    w.advance(LIMITS.idleMs);
    assert.equal(w.host.exists(), false, 'deleted');
    assert.equal(w.kv.size, 0, 'storage cleared');
    assert.equal(w.alarm, null);
    for (const ws of [ana, ben]) {
      assert.deepEqual(ws.received.at(-1), { t: 'closed' });
      assert.equal(ws.closed?.code, CLOSE.expired);
    }
    const late = w.connect();
    assert.equal(late.of('deny')[0]?.reason, 'notFound');
    assert.equal(w.host.create(CODE, 'zoe'), true, 'the code can be used again');
  });

  test('sockets per room are capped', () => {
    const w = world();
    w.host.create(CODE, 'ana');
    for (let i = 0; i < LIMITS.sockets; i++) w.connect();
    assert.equal(w.host.canAccept(), false);
  });
});
