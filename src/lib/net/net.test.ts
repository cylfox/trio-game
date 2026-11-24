// Protocol tests: one host and guests over the in-memory hub, with a fake clock and timers.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, applyEvent, findSets, isSet, mulberry32 } from '../engine/engine.ts';
import type { CardId, PublicView } from '../engine/engine.ts';
import { createGuest } from './guest.ts';
import { createHost } from './host.ts';
import type { HostOptions } from './host.ts';
import { createMemoryHub } from './memory-transport.ts';
import type { MemoryHub, MemoryTransport } from './memory-transport.ts';
import { MAX_PLAYERS, cleanName, parseGuestMessage, parseHostMessage } from './protocol.ts';
import type { StateMessage } from './protocol.ts';
import { CODE_ALPHABET, codeFromHash, inviteLink, newRoomCode, normalizeCode } from './room-code.ts';
import type { Change, RoomSession } from './session.ts';
import { ROOM_TTL_MS, browserStore, loadIdentity, loadRoom, memoryStore, pruneRooms, saveName, saveRoom } from './storage.ts';
import type { SavedRoom } from './storage.ts';
import { createTrain } from './train.ts';

// ── Harness ──────────────────────────────────────────────────────────────────────────────────

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
    /** Move time forward, firing due timers in order. */
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
  };
}

const EMPTY_VIEW: PublicView = {
  schema: 2,
  seq: 0,
  mode: 'versus',
  config: DEFAULT_CONFIG,
  startedAt: 0,
  deckCount: 0,
  board: [],
  players: [],
  lock: null,
  over: false,
};

/** Records changes and checks that every contiguous update's events replay onto its view. */
function watch(session: RoomSession) {
  const changes: Change[] = [];
  let prev = session.getState().view;
  session.subscribe((state, change) => {
    changes.push(change);
    if (change.type !== 'state') return;
    if (change.contiguous && state.view !== null) {
      const replayed = change.events.reduce(applyEvent, prev ?? EMPTY_VIEW);
      assert.deepEqual({ ...replayed, seq: state.view.seq }, state.view, `${session.role}: events replay onto the view`);
    }
    prev = state.view;
  });
  return {
    changes,
    of: <T extends Change['type']>(type: T) => changes.filter((c): c is Extract<Change, { type: T }> => c.type === type),
    events: () => changes.flatMap((c) => (c.type === 'state' ? c.events.map((e) => e.type) : [])),
  };
}

const CODE = 'K7QX';

function setup(extra: Partial<HostOptions> = {}) {
  const hub: MemoryHub = createMemoryHub();
  const time = fakeTime();
  const saves: SavedRoom[] = [];
  const hostTransport: MemoryTransport = hub.join('peer-host');
  const host = createHost({
    transport: hostTransport,
    code: CODE,
    me: { id: 'host', name: 'Hana' },
    clock: time.clock,
    schedule: time.schedule,
    rng: mulberry32(1),
    persist: (room) => saves.push(room),
    newEpoch: () => 'epoch-1',
    ...extra,
  });
  const hostLog = watch(host);
  const guest = (id: string, peerId: string, name = id) => {
    const transport = hub.join(peerId);
    const session = createGuest({ transport, code: CODE, me: { id, name }, clock: time.clock });
    return { session, transport, log: watch(session) };
  };
  return { hub, time, saves, host, hostLog, hostTransport, guest };
}

function view(session: RoomSession): PublicView {
  const v = session.getState().view;
  assert.ok(v !== null, `${session.role} has a view`);
  return v;
}

function score(session: RoomSession, playerId: string): number {
  const p = view(session).players.find((x) => x.id === playerId);
  assert.ok(p !== undefined);
  return p.score;
}

function aSet(session: RoomSession): CardId[] {
  const board = view(session).board.filter((c): c is CardId => c !== null);
  return [...findSets(board)[0]];
}

function nonSet(session: RoomSession): CardId[] {
  const b = view(session).board.filter((c): c is CardId => c !== null);
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++) for (let k = j + 1; k < b.length; k++) if (!isSet(b[i], b[j], b[k])) return [b[i], b[j], b[k]];
  throw new Error('no non-set');
}

/** Everyone sees exactly the host's room and view. */
function inSync(host: RoomSession, ...guests: RoomSession[]): void {
  for (const g of guests) {
    assert.equal(g.getState().status, 'online');
    assert.deepEqual(g.getState().view, host.getState().view, 'same view as the host');
    assert.deepEqual(g.getState().room, host.getState().room, 'same room as the host');
    assert.equal(g.getState().seq, host.getState().seq, 'same seq as the host');
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────────────────────

describe('room protocol (host + guests over the in-memory hub)', () => {
  test('a joining guest gets a snapshot and both see the seats', () => {
    const { hub, host, hostLog, guest } = setup();
    const a = guest('A', 'peer-a', 'Ana');
    assert.equal(a.session.getState().status, 'connecting');
    hub.flush();
    inSync(host, a.session);
    assert.deepEqual(a.log.of('state')[0], { type: 'state', kind: 'snapshot', events: [], contiguous: false });
    assert.deepEqual(
      host.getState().room?.seats.map((s) => [s.id, s.name, s.connected]),
      [
        ['host', 'Hana', true],
        ['A', 'Ana', true],
      ],
    );
    assert.equal(host.getState().room?.phase, 'lobby');
    assert.equal(a.session.getState().view, null, 'no game yet');
    assert.deepEqual(hostLog.of('join'), [{ type: 'join', playerId: 'A', name: 'Ana' }]);
  });

  test('start, a call race, claims and a timeout (host + 2 guests, max 3)', () => {
    const { hub, time, host, guest } = setup({ maxPlayers: 3 });
    const a = guest('A', 'peer-a');
    const b = guest('B', 'peer-b');
    hub.flush();

    a.session.act({ type: 'start' });
    hub.flush();
    assert.deepEqual(a.log.of('rejected'), [{ type: 'rejected', intent: 'start', reason: 'hostOnly' }]);
    host.act({ type: 'start' });
    hub.flush();
    inSync(host, a.session, b.session);
    assert.equal(host.getState().room?.phase, 'playing');
    assert.deepEqual(view(a.session).players.map((p) => p.id), ['host', 'A', 'B']);
    assert.equal(view(b.session).board.length >= 12, true);

    // Both press SET! before either message reaches the host: arrival order decides.
    a.session.act({ type: 'call' });
    b.session.act({ type: 'call' });
    hub.flush();
    inSync(host, a.session, b.session);
    assert.equal(view(b.session).lock?.playerId, 'A', 'first call wins');
    assert.ok(b.log.events().includes('locked'), 'the loser sees the locked cue');
    assert.equal(score(host, 'B'), 0, 'no cost for losing the race');

    a.session.act({ type: 'claim', cards: aSet(a.session) });
    hub.flush();
    inSync(host, a.session, b.session);
    assert.equal(score(b.session, 'A'), 3);
    assert.equal(view(a.session).lock, null);

    // A claim without a call is refused with a reason.
    b.session.act({ type: 'claim', cards: aSet(b.session) });
    hub.flush();
    assert.deepEqual(b.log.of('rejected').at(-1), { type: 'rejected', intent: 'claim', reason: 'noCall' });

    // B calls and lets it run out: the host's timer expires the call.
    b.session.act({ type: 'call' });
    hub.flush();
    const deadline = view(a.session).lock?.deadline;
    assert.equal(deadline, time.clock() + 5000);
    time.advance(4999);
    hub.flush();
    assert.equal(view(a.session).lock?.playerId, 'B', 'still held');
    time.advance(1);
    hub.flush();
    inSync(host, a.session, b.session);
    assert.equal(view(a.session).lock, null);
    assert.equal(score(a.session, 'B'), -1, 'timeout at 0 costs 1');
    assert.equal(view(b.session).players[2].timeouts, 1);

    // The host's own intents take the same path.
    host.act({ type: 'call' });
    host.act({ type: 'claim', cards: nonSet(host) });
    hub.flush();
    inSync(host, a.session, b.session);
    assert.equal(score(b.session, 'host'), -1);
    assert.ok(a.log.events().includes('wrong'));
  });

  test('hints and dealMore are refused in versus', () => {
    const { hub, host, hostLog, guest } = setup();
    const a = guest('A', 'peer-a');
    hub.flush();
    host.act({ type: 'start' });
    hub.flush();
    host.act({ type: 'hint' });
    a.session.act({ type: 'dealMore' });
    hub.flush();
    assert.deepEqual(hostLog.of('rejected'), [{ type: 'rejected', intent: 'hint', reason: 'notInVersus' }]);
    assert.deepEqual(a.log.of('rejected'), [{ type: 'rejected', intent: 'dealMore', reason: 'notInVersus' }]);
    assert.equal(view(host).players[0].hints, 0);
  });

  test('a late joiner gets a snapshot of the running game and plays from the next one', () => {
    const { hub, host, guest } = setup({ maxPlayers: 3 });
    const a = guest('A', 'peer-a');
    hub.flush();
    host.act({ type: 'start' });
    hub.flush();
    a.session.act({ type: 'call' });
    hub.flush();
    a.session.act({ type: 'claim', cards: aSet(a.session) });
    hub.flush();

    const b = guest('B', 'peer-b');
    hub.flush();
    inSync(host, a.session, b.session);
    assert.equal(b.log.of('state')[0]?.kind, 'snapshot');
    assert.equal(score(b.session, 'A'), 3, 'the snapshot carries the game so far');
    assert.deepEqual(host.getState().room?.seats.map((s) => s.id), ['host', 'A', 'B']);
    assert.deepEqual(view(b.session).players.map((p) => p.id), ['host', 'A'], 'B watches this game');
    b.session.act({ type: 'call' });
    hub.flush();
    assert.deepEqual(b.log.of('rejected').at(-1), { type: 'rejected', intent: 'call', reason: 'invalid' });
  });

  test('a guest that reconnects keeps its seat and score; its seat stays reserved', () => {
    const { hub, host, hostLog, guest } = setup();
    const a = guest('A', 'peer-a', 'Ana');
    hub.flush();
    host.act({ type: 'start' });
    hub.flush();
    a.session.act({ type: 'call' });
    hub.flush();
    a.session.act({ type: 'claim', cards: aSet(a.session) });
    hub.flush();
    assert.equal(score(host, 'A'), 3);

    void a.transport.leave(); // the phone drops off
    hub.flush();
    assert.deepEqual(host.getState().room?.seats.map((s) => [s.id, s.connected]), [
      ['host', true],
      ['A', false],
    ]);
    assert.deepEqual(hostLog.of('leave'), [{ type: 'leave', playerId: 'A', name: 'Ana' }]);

    const c = guest('C', 'peer-c');
    hub.flush();
    assert.equal(c.session.getState().status, 'denied', "A's seat is kept while the game is on");

    const back = guest('A', 'peer-a2', 'Ana'); // same player id, new peer id
    hub.flush();
    inSync(host, back.session);
    assert.equal(back.log.of('state')[0]?.kind, 'snapshot');
    assert.equal(score(back.session, 'A'), 3, 'score kept');
    assert.deepEqual(hostLog.of('rejoin'), [{ type: 'rejoin', playerId: 'A', name: 'Ana' }]);
    back.session.act({ type: 'call' });
    hub.flush();
    assert.equal(view(host).lock?.playerId, 'A', 'the rejoined player can play');
  });

  test('room full when the max is 2', () => {
    assert.equal(MAX_PLAYERS, 2);
    const { hub, host, hostLog, guest } = setup();
    const a = guest('A', 'peer-a');
    hub.flush();
    const b = guest('B', 'peer-b', 'Bea');
    hub.flush();
    assert.equal(b.session.getState().status, 'denied');
    assert.equal(b.session.getState().denied, 'full');
    assert.equal(b.session.getState().room, null, 'no state for a denied peer');
    assert.deepEqual(hostLog.of('denied'), [{ type: 'denied', reason: 'full', playerId: 'B', name: 'Bea' }]);
    assert.deepEqual(b.log.of('denied'), [{ type: 'denied', reason: 'full', playerId: 'B', name: 'Bea' }]);
    assert.equal(host.getState().room?.seats.length, 2);
    host.act({ type: 'start' });
    hub.flush();
    inSync(host, a.session);
    assert.equal(b.session.getState().view, null, 'the denied peer gets no updates');
    b.session.act({ type: 'call' });
    assert.equal(b.log.of('rejected').at(-1)?.reason, 'offline');
  });

  test('in the lobby a leaving guest frees the seat', () => {
    const { hub, host, guest } = setup();
    const a = guest('A', 'peer-a');
    hub.flush();
    void a.transport.leave();
    hub.flush();
    const b = guest('B', 'peer-b');
    hub.flush();
    assert.equal(b.session.getState().status, 'online');
    assert.deepEqual(host.getState().room?.seats.map((s) => s.id), ['host', 'B']);
  });

  test('guests drop stale and duplicate states', () => {
    const { hub, host, guest } = setup();
    const a = guest('A', 'peer-a');
    const sent: StateMessage[] = [];
    a.transport.onMessage((raw) => {
      const m = parseHostMessage(raw);
      if (m?.t === 'state') sent.push(m);
    });
    hub.flush();
    host.act({ type: 'start' });
    hub.flush();
    host.act({ type: 'call' });
    hub.flush();
    const before = a.session.getState();
    const changes = a.log.changes.length;
    for (const old of sent) hub.inject('peer-a', 'peer-host', old);
    hub.flush();
    assert.equal(a.session.getState(), before, 'old and duplicate seqs change nothing');
    assert.equal(a.log.changes.length, changes);
    assert.equal(view(a.session).lock?.playerId, 'host');
  });

  test('a missed update is repaired by the next one (no animation across the gap)', () => {
    const { hub, host, guest } = setup();
    const a = guest('A', 'peer-a');
    hub.flush();
    host.act({ type: 'start' });
    hub.flush();
    const seqBefore = a.session.getState().seq;
    host.act({ type: 'call' });
    assert.equal(hub.pending(), 1);
    assert.equal(hub.drop('peer-a'), true, 'the call update is lost');
    host.act({ type: 'claim', cards: nonSet(host) });
    hub.flush();
    inSync(host, a.session);
    assert.equal(a.session.getState().seq, seqBefore + 2);
    assert.deepEqual(a.log.of('state').at(-1), { type: 'state', kind: 'update', events: [], contiguous: false });
    assert.equal(score(a.session, 'host'), -1, 'the view is still exact');
  });

  test('a reloaded host resumes from its saved room and guests catch up', () => {
    const { hub, time, saves, host, hostTransport, guest } = setup();
    const a = guest('A', 'peer-a');
    hub.flush();
    host.act({ type: 'start' });
    hub.flush();
    a.session.act({ type: 'call' });
    hub.flush();
    a.session.act({ type: 'claim', cards: aSet(a.session) });
    hub.flush();
    a.session.act({ type: 'call' }); // A holds a call when the host's tab dies
    hub.flush();
    const lastSeq = host.getState().seq;
    const saved = saves.at(-1);
    assert.ok(saved !== undefined);
    assert.equal(saved.seq, lastSeq, 'saved after every change');
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), saved, 'plain JSON');

    void hostTransport.leave(); // crash: no 'closed' message
    hub.flush();
    assert.equal(a.session.getState().status, 'hostAway');
    time.advance(10_000); // the reload takes a while; A's call is now overdue

    const host2 = createHost({
      transport: hub.join('peer-host-2'),
      code: CODE,
      me: { id: 'host', name: 'Hana' },
      saved,
      clock: time.clock,
      schedule: time.schedule,
      rng: mulberry32(2),
    });
    assert.deepEqual(host2.getState().room?.seats.map((s) => [s.id, s.connected]), [
      ['host', true],
      ['A', false],
    ]);
    hub.flush();
    time.advance(0); // the re-armed timer expires the overdue call
    hub.flush();
    inSync(host2, a.session);
    assert.ok(a.log.of('hostBack').length === 1);
    assert.ok(a.session.getState().seq > lastSeq, 'seq continues');
    assert.equal(score(a.session, 'A'), 0, 'kept the +3, then paid the overdue timeout (−3)');
    assert.equal(view(a.session).players[1].timeouts, 1);
    a.session.act({ type: 'call' });
    hub.flush();
    assert.equal(view(host2).lock?.playerId, 'A');
  });

  test('closing the room tells the guests', async () => {
    const { hub, host, guest } = setup();
    const a = guest('A', 'peer-a');
    hub.flush();
    await host.leave();
    hub.flush();
    assert.equal(a.session.getState().status, 'closed');
  });

  test('rematch: a new game starts once every seated player asks', () => {
    const { hub, host, hostLog, guest } = setup();
    const a = guest('A', 'peer-a');
    hub.flush();
    host.act({ type: 'start' });
    hub.flush();
    host.act({ type: 'rematch' });
    assert.deepEqual(hostLog.of('rejected'), [{ type: 'rejected', intent: 'rematch', reason: 'notOver' }]);
    for (let i = 0; i < 40 && !view(host).over; i++) {
      host.act({ type: 'call' });
      host.act({ type: 'claim', cards: aSet(host) });
    }
    hub.flush();
    assert.equal(view(a.session).over, true);
    assert.equal(a.session.getState().room?.phase, 'over');
    inSync(host, a.session);

    host.act({ type: 'rematch' });
    hub.flush();
    assert.deepEqual(a.session.getState().room?.seats.map((s) => s.rematch), [true, false]);
    a.session.act({ type: 'rematch' });
    hub.flush();
    inSync(host, a.session);
    assert.equal(host.getState().room?.phase, 'playing');
    assert.equal(view(a.session).over, false);
    assert.deepEqual(view(a.session).players.map((p) => p.score), [0, 0]);
  });
});

describe('train session (local engine, no network)', () => {
  test('call, claim with a hint, timeout, and a rejected claim without a call', () => {
    const time = fakeTime();
    const train = createTrain({ playerId: 'me', clock: time.clock, schedule: time.schedule, rng: mulberry32(3) });
    const log = watch(train);
    assert.equal(view(train).mode, 'train');

    train.act({ type: 'claim', cards: aSet(train) });
    assert.deepEqual(log.of('rejected'), [{ type: 'rejected', intent: 'claim', reason: 'noCall' }]);

    train.act({ type: 'hint' });
    assert.equal(view(train).players[0].hints, 1);
    train.act({ type: 'call' });
    time.advance(1840);
    train.act({ type: 'claim', cards: aSet(train), hinted: true });
    const found = view(train).players[0].attempts[0];
    assert.deepEqual([found.result, found.hinted, found.resolvedAt - found.calledAt], ['found', true, 1840]);
    assert.equal(view(train).players[0].score, 0, 'train has no score');

    train.act({ type: 'call' });
    time.advance(5000);
    assert.equal(view(train).players[0].timeouts, 1);
    assert.equal(view(train).lock, null);
    assert.deepEqual(log.events().filter((e) => e === 'timeout'), ['timeout']);

    train.act({ type: 'rematch' });
    assert.deepEqual(view(train).players[0].attempts, [], 'a fresh game');
  });

  test('no time limit after calling with callMs null', () => {
    const time = fakeTime();
    const train = createTrain({ playerId: 'me', config: { callMs: null }, clock: time.clock, schedule: time.schedule, rng: mulberry32(4) });
    train.act({ type: 'call' });
    time.advance(10 * 60_000);
    assert.equal(view(train).lock?.deadline, null);
    assert.equal(view(train).lock?.playerId, 'me');
    train.act({ type: 'claim', cards: aSet(train) });
    assert.equal(view(train).players[0].attempts[0].resolvedAt - view(train).players[0].attempts[0].calledAt, 600_000);
  });
});

describe('room codes', () => {
  test('4 characters from the unambiguous alphabet', () => {
    assert.equal(CODE_ALPHABET.length, 31);
    for (const ch of '01OIL') assert.equal(CODE_ALPHABET.includes(ch), false);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const code = newRoomCode();
      assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
      seen.add(code);
    }
    assert.ok(seen.size > 1990, 'codes vary');
    // Biased bytes (≥ 248) are redrawn.
    const code = newRoomCode((n) => Uint8Array.from({ length: n }, (_, i) => (i < 4 ? 248 + i : i)));
    assert.equal(code, '6789', 'bytes 248..251 are skipped; 4..7 map to 6..9');
  });

  test('typed, pasted and linked codes normalise; look-alikes are rejected', () => {
    assert.equal(normalizeCode('k7qx'), 'K7QX');
    assert.equal(normalizeCode(' k7-q x '), 'K7QX');
    assert.equal(normalizeCode('#K7QX'), 'K7QX');
    assert.equal(normalizeCode('https://cylfox.github.io/trio-game/#k7qx'), 'K7QX');
    for (const bad of ['K0QX', 'KOQX', 'K1QX', 'KIQX', 'KLQX', 'K7Q', 'K7QXZ', '', '####']) assert.equal(normalizeCode(bad), null, bad);
    assert.equal(codeFromHash(''), null);
    assert.equal(codeFromHash('#'), null);
    assert.equal(codeFromHash('#m4ze'), 'M4ZE');
    assert.equal(inviteLink('https://cylfox.github.io/trio-game/', 'K7QX'), 'https://cylfox.github.io/trio-game/#K7QX');
    assert.equal(inviteLink('http://localhost:5173/trio-game/?x=1#OLD', 'K7QX'), 'http://localhost:5173/trio-game/#K7QX');
  });
});

describe('messages and storage', () => {
  test('untrusted guest messages are validated', () => {
    assert.deepEqual(parseGuestMessage({ t: 'hello', v: 1, playerId: 'p', name: '  Ana \n Bel\u0007  ' }), {
      t: 'hello',
      v: 1,
      playerId: 'p',
      name: 'Ana Bel',
    });
    assert.equal(parseGuestMessage({ t: 'hello', v: 1, playerId: '' }), null);
    assert.equal(parseGuestMessage({ t: 'act', intent: { type: 'claim', cards: [1, 2] } }), null);
    assert.equal(parseGuestMessage({ t: 'act', intent: { type: 'nuke' } }), null);
    assert.deepEqual(parseGuestMessage({ t: 'act', intent: { type: 'claim', cards: [1, 2, 3], hinted: 'yes' } }), {
      t: 'act',
      intent: { type: 'claim', cards: [1, 2, 3] },
    });
    assert.equal(parseGuestMessage('hello'), null);
    assert.equal(cleanName('x'.repeat(100)).length, 24);
    assert.equal(parseHostMessage({ t: 'state', v: 99 }), null);
  });

  test('identity persists; a broken localStorage falls back to memory', () => {
    const store = memoryStore();
    const first = loadIdentity(store);
    assert.ok(first.id.length >= 8);
    assert.equal(first.name, '');
    assert.deepEqual(loadIdentity(store), first);
    assert.deepEqual(saveName(store, '  Ana  '), { id: first.id, name: 'Ana' });
    assert.equal(loadIdentity(store).name, 'Ana');

    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      const broken = browserStore();
      broken.set('k', 'v');
      assert.equal(broken.get('k'), 'v');
      assert.deepEqual(broken.keys(), ['k']);
      broken.remove('k');
      assert.equal(broken.get('k'), null);
      assert.ok(loadIdentity(broken).id.length >= 8);
    } finally {
      if (desc === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else Object.defineProperty(globalThis, 'localStorage', desc);
    }
  });

  test('saved rooms load by code and expire', () => {
    const store = memoryStore();
    const room: SavedRoom = {
      v: 1,
      code: 'K7QX',
      epoch: 'e',
      seq: 3,
      savedAt: 1000,
      hostId: 'h',
      maxPlayers: 2,
      phase: 'lobby',
      seats: [{ id: 'h', name: '', rematch: false }],
      game: null,
    };
    saveRoom(store, room);
    assert.deepEqual(loadRoom(store, 'K7QX', 2000), room);
    assert.equal(loadRoom(store, 'ZZZZ', 2000), null);
    store.set('trio:room:BAD2', '{not json');
    pruneRooms(store, 1000 + ROOM_TTL_MS + 1);
    assert.deepEqual(store.keys(), []);
  });
});
