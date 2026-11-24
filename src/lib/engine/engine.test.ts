// Run with: npm test (node --test, Node type stripping)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SIZE,
  DECK_SIZE,
  DEFAULT_CONFIG,
  MAX_BOARD,
  applyAction,
  applyEvent,
  callSet,
  cardLabel,
  cardNames,
  claim,
  dealMore,
  decodeCard,
  encodeCard,
  expire,
  findSets,
  fullDeck,
  hasSet,
  isCardId,
  isSet,
  mulberry32,
  newGame,
  penaltyFor,
  playerStats,
  publicView,
  shuffle,
  thirdCard,
  useHint,
} from './engine.ts';
import type {
  Action,
  CardId,
  ClaimOptions,
  ClaimStep,
  GameConfig,
  GameConfigInput,
  GameEvent,
  GameState,
  Mode,
  PublicView,
  Rng,
} from './engine.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────

const FEATURES = fullDeck().map(decodeCard);
const KEYS = ['shape', 'color', 'number', 'shading'] as const;

/** The rule as written on the box: per feature, all the same or all different. */
function bruteIsSet(a: number, b: number, c: number): boolean {
  if (a === b || a === c || b === c) return false;
  const fa = FEATURES[a];
  const fb = FEATURES[b];
  const fc = FEATURES[c];
  return KEYS.every((k) => {
    const x = fa[k];
    const y = fb[k];
    const z = fc[k];
    return (x === y && y === z) || (x !== y && y !== z && x !== z);
  });
}

function bruteSets(board: readonly CardId[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < board.length; i++)
    for (let j = i + 1; j < board.length; j++)
      for (let k = j + 1; k < board.length; k++)
        if (bruteIsSet(board[i], board[j], board[k])) out.push(key([board[i], board[j], board[k]]));
  return out.sort();
}

function key(cards: readonly number[]): string {
  return [...cards].sort((x, y) => x - y).join('-');
}

/** A set-free hand of `size` cards (greedy, deterministic). */
function capOf(size: number): CardId[] {
  for (let seed = 1; ; seed++) {
    const cap: CardId[] = [];
    const blocked = new Set<CardId>();
    for (const c of shuffle(fullDeck(), mulberry32(seed))) {
      if (blocked.has(c)) continue;
      for (const x of cap) blocked.add(thirdCard(x, c));
      cap.push(c);
      if (cap.length === size) return cap;
    }
  }
}

/** prefix first, then every other card in id order. */
function deckStarting(prefix: readonly CardId[]): CardId[] {
  const used = new Set(prefix);
  return [...prefix, ...fullDeck().filter((c) => !used.has(c))];
}

/** A set whose three cards all avoid `avoid`. */
function setAvoiding(avoid: readonly CardId[]): [CardId, CardId, CardId] {
  const bad = new Set(avoid);
  for (let a = 0; a < DECK_SIZE; a++) {
    if (bad.has(a)) continue;
    for (let b = a + 1; b < DECK_SIZE; b++) {
      if (bad.has(b)) continue;
      const c = thirdCard(a, b);
      if (!bad.has(c)) return [a, b, c];
    }
  }
  throw new Error('no such set');
}

function nonSetOnBoard(board: readonly CardId[]): [CardId, CardId, CardId] {
  for (let i = 0; i < board.length; i++)
    for (let j = i + 1; j < board.length; j++)
      for (let k = j + 1; k < board.length; k++)
        if (!isSet(board[i], board[j], board[k])) return [board[i], board[j], board[k]];
  throw new Error('every triple is a set?');
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function types(events: readonly GameEvent[]): string {
  return events.map((e) => e.type).join(',');
}

const CUES = new Set(['stale', 'locked', 'cooldown']);

/** Allowed event sequences per result (see the EVENTS block in engine.ts). */
const GRAMMAR: Record<string, RegExp> = {
  found: /^retire(,deal){0,3}(,move){0,3}(,autoDeal(,deal){1,3})*(,gameOver)?$/,
  wrong: /^wrong$/,
  stale: /^stale$/,
  locked: /^(locked)?$/,
  noCall: /^(timeout)?$/,
  called: /^((timeout,)?call)?$/,
  cooldown: /^(timeout,)?cooldown$/,
  gameOver: /^(timeout)?$/,
  invalid: /^$/,
  dealt: /^(timeout,)?manualDeal(,deal){1,3}$/,
  deckEmpty: /^(timeout)?$/,
  boardFull: /^(timeout)?$/,
  expired: /^timeout$/,
  none: /^$/,
  hint: /^(timeout,)?hint$/,
};
const NEW_GAME_GRAMMAR = /^newGame(,deal){0,12}(,autoDeal(,deal){1,3})*(,gameOver)?$/;

const EMPTY_VIEW: PublicView = {
  schema: 2,
  seq: 0,
  mode: 'train',
  config: DEFAULT_CONFIG,
  startedAt: 0,
  deckCount: 0,
  board: [],
  players: [],
  lock: null,
  over: false,
};

/** Independent statement of the scoring rule. */
function expectedPenalty(mode: Mode, config: GameConfig, score: number): number {
  if (mode === 'train') return 0;
  return score >= config.penalty.full ? config.penalty.full : config.penalty.partial;
}

function checkInvariants(s: GameState, total = DECK_SIZE): void {
  const all = [...s.deck, ...s.board, ...s.players.flatMap((p) => p.pile)];
  assert.equal(all.length, total, 'card conservation: deck + board + piles');
  assert.equal(new Set(all).size, all.length, 'no card in two places');
  assert.ok(all.every(isCardId), 'all ids valid');
  assert.ok(s.board.length <= MAX_BOARD, 'board ≤ 21');
  if (s.over) {
    assert.equal(s.deck.length, 0);
    assert.equal(hasSet(s.board), false);
    assert.equal(s.lock, null);
  } else {
    assert.ok(hasSet(s.board), 'a live board always has a set');
    if (total === DECK_SIZE && s.deck.length > 0) assert.ok(s.board.length >= BOARD_SIZE);
  }
  for (const p of s.players) {
    assert.ok(Number.isInteger(p.score), 'integer score (no floor)');
    if (s.mode === 'train') {
      assert.equal(p.score, 0, 'train has no score');
      assert.equal(p.cooldownUntil, 0);
    }
    assert.ok(p.score <= p.foundAt.length * s.config.setPoints, 'score never exceeds sets × setPoints');
    assert.equal(p.pile.length, p.foundAt.length * 3);
    for (let i = 0; i < p.pile.length; i += 3) assert.ok(isSet(p.pile[i], p.pile[i + 1], p.pile[i + 2]), 'pile holds sets');
    for (let i = 1; i < p.foundAt.length; i++) assert.ok(p.foundAt[i] >= p.foundAt[i - 1]);
    assert.ok(Number.isInteger(p.hints) && p.hints >= 0);
    // Attempt records: one per resolved call, capped, in time order.
    const resolved = p.foundAt.length + p.mistakes + p.timeouts;
    assert.equal(p.attempts.length, Math.min(resolved, s.config.maxAttempts), 'one attempt per resolved call, capped');
    p.attempts.forEach((a, i) => {
      assert.ok(a.calledAt <= a.resolvedAt, 'resolved after called');
      if (i > 0) assert.ok(p.attempts[i - 1].resolvedAt <= a.calledAt, 'attempts do not overlap');
      if (a.result === 'timeout') assert.equal(a.cards, undefined);
      else assert.ok(a.cards !== undefined && a.cards.length === 3);
      if (a.hinted !== undefined) assert.equal(a.hinted, true);
    });
    const foundTimes = p.attempts.filter((a) => a.result === 'found').map((a) => a.resolvedAt);
    assert.deepEqual(foundTimes, p.foundAt.slice(p.foundAt.length - foundTimes.length), 'found attempts match foundAt');
  }
  const lock = s.lock;
  if (lock !== null) {
    assert.ok(s.players.some((p) => p.id === lock.playerId));
    assert.equal(lock.deadline === null, s.config.callMs === null, 'deadline null iff no time limit');
    if (lock.deadline !== null) assert.equal(lock.deadline, lock.calledAt + (s.config.callMs ?? 0));
  }
}

interface AnyStep {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly result: string;
}

/** Everything that must hold for any transition. `prev` must be deep-frozen (purity). */
function checkStep(prev: GameState, out: AnyStep, total = DECK_SIZE): void {
  assert.match(types(out.events), GRAMMAR[out.result], `events for '${out.result}'`);
  const changed = out.events.some((e) => !CUES.has(e.type));
  if (changed) {
    assert.notEqual(out.state, prev);
    assert.equal(out.state.seq, prev.seq + 1, 'seq +1 per changing transition');
  } else {
    assert.equal(out.state, prev, 'no change → same object');
  }
  const replayed = out.events.reduce(applyEvent, publicView(prev));
  assert.deepEqual({ ...replayed, seq: out.state.seq }, publicView(out.state), 'events replay onto the next view');
  assert.deepEqual(JSON.parse(JSON.stringify(out.state)), out.state, 'state is plain JSON');
  checkInvariants(out.state, total);
}

/** The live lock at `now`, if any (a lock past its deadline is as good as gone). */
function liveLock(s: GameState, now: number) {
  const lock = s.lock;
  return lock !== null && (lock.deadline === null || now < lock.deadline) ? lock : null;
}

/** Independent statement of the rules: what result should this claim get? */
function expectClaim(s: GameState, playerId: string, cards: readonly CardId[], now: number): string {
  if (!s.players.some((p) => p.id === playerId)) return 'invalid';
  if (s.over) return 'gameOver';
  const lock = liveLock(s, now);
  if (lock === null) return 'noCall';
  if (lock.playerId !== playerId) return 'locked';
  if (cards.some((c) => !s.board.includes(c))) return 'stale';
  return isSet(cards[0], cards[1], cards[2]) ? 'found' : 'wrong';
}

function expectCall(s: GameState, playerId: string, now: number): string {
  if (s.over) return 'gameOver';
  const lock = liveLock(s, now);
  if (lock !== null) return lock.playerId === playerId ? 'called' : 'locked';
  const p = s.players.find((x) => x.id === playerId);
  if (p === undefined) return 'invalid';
  let until = p.cooldownUntil;
  const dead = s.lock;
  if (dead !== null && dead.deadline !== null && dead.playerId === playerId && s.mode === 'versus' && s.config.cooldownMs > 0) {
    until = dead.deadline + s.config.cooldownMs;
  }
  return now < until ? 'cooldown' : 'called';
}

interface Extra {
  now?: number;
  config?: GameConfigInput;
  deck?: CardId[];
}

function train(players: string[] = ['solo'], seed = 1, extra: Extra = {}) {
  return newGame(players, mulberry32(seed), { mode: 'train', ...extra });
}

function versus(players: string[] = ['a', 'b'], seed = 1, extra: Extra = {}) {
  return newGame(players, mulberry32(seed), { mode: 'versus', ...extra });
}

/** A seeded game whose opening board has exactly 12 cards (no autoDeal). */
function plainStart(mode: 'train' | 'versus', players: string[]): GameState {
  for (let seed = 1; ; seed++) {
    const { state } = newGame(players, mulberry32(seed), { mode });
    if (state.board.length === BOARD_SIZE) return state;
  }
}

/** callSet at `calledAt`, then claim at `at`; both checked as transitions. Returns the claim. */
function callAndClaim(
  prev: GameState,
  playerId: string,
  cards: readonly CardId[],
  calledAt: number,
  at: number,
  options?: ClaimOptions,
): ClaimStep {
  const call = callSet(prev, playerId, calledAt);
  checkStep(prev, call);
  assert.equal(call.result, 'called');
  const held = deepFreeze(call.state);
  const out = claim(held, playerId, cards, at, options);
  checkStep(held, out);
  return out;
}

/** A tiny script runner: each move is call + (found | wrong | timeout) for one player. */
function scripted(start: GameState) {
  let state = deepFreeze(start);
  let now = start.startedAt;
  return {
    get state() {
      return state;
    },
    /** Returns the resolving event (retire, wrong or timeout). */
    move(playerId: string, kind: 'found' | 'wrong' | 'timeout'): GameEvent {
      now += 1000;
      const call = callSet(state, playerId, now);
      checkStep(state, call);
      assert.equal(call.result, 'called');
      const held = deepFreeze(call.state);
      let out: AnyStep;
      if (kind === 'timeout') {
        const deadline = held.lock?.deadline;
        assert.ok(typeof deadline === 'number');
        now = deadline;
        out = expire(held, now);
      } else {
        now += 500;
        out = claim(held, playerId, kind === 'found' ? findSets(held.board)[0] : nonSetOnBoard(held.board), now);
      }
      checkStep(held, out);
      state = deepFreeze(out.state);
      const event = out.events[0];
      assert.ok(event !== undefined);
      return event;
    },
  };
}

function scoreOf(s: GameState, playerId: string): number {
  const p = s.players.find((x) => x.id === playerId);
  assert.ok(p !== undefined);
  return p.score;
}

// ── Cards ────────────────────────────────────────────────────────────────────────────────────

describe('cards', () => {
  test('ids use the old repos layout: id = shape*27 + color*9 + number*3 + shading', () => {
    for (const id of fullDeck()) {
      const f = decodeCard(id);
      assert.equal(id, f.shape * 27 + f.color * 9 + f.number * 3 + f.shading);
      assert.equal(encodeCard(f), id);
      for (const k of KEYS) assert.ok(f[k] >= 0 && f[k] <= 2);
    }
    assert.deepEqual(cardNames(0), { shape: 'diamond', color: 'red', number: 1, shading: 'solid' });
    assert.deepEqual(cardNames(80), { shape: 'oval', color: 'purple', number: 3, shading: 'open' });
    assert.equal(cardLabel(41), '2 green open squiggles');
    assert.equal(cardLabel(0), '1 red solid diamond');
  });

  test('bad ids and feature values are rejected', () => {
    for (const bad of [-1, 81, 1.5, NaN, '3', null]) assert.equal(isCardId(bad), false);
    assert.throws(() => decodeCard(81), RangeError);
    assert.throws(() => encodeCard({ shape: 3, color: 0, number: 0, shading: 0 }), RangeError);
    assert.throws(() => thirdCard(5, 5), RangeError);
  });
});

// ── Sets ─────────────────────────────────────────────────────────────────────────────────────

describe('sets', () => {
  test('isSet matches the brute-force definition on all 81³ triples', () => {
    let sets = 0;
    for (let a = 0; a < DECK_SIZE; a++)
      for (let b = 0; b < DECK_SIZE; b++)
        for (let c = 0; c < DECK_SIZE; c++) {
          const expected = bruteIsSet(a, b, c);
          if (isSet(a, b, c) !== expected) assert.fail(`isSet(${a},${b},${c}) should be ${expected}`);
          if (expected) sets++;
        }
    assert.equal(sets, 1080 * 6, 'every set appears in all 6 orders');
  });

  test('isSet rejects duplicates and invalid ids', () => {
    assert.equal(isSet(4, 4, 4), false);
    assert.equal(isSet(0, 1, 81), false);
    assert.equal(isSet(0, 1, 2.5), false);
    assert.equal(isSet(0, 1, 2), true);
  });

  test('thirdCard completes every pair', () => {
    for (let a = 0; a < DECK_SIZE; a++)
      for (let b = 0; b < DECK_SIZE; b++) {
        if (a === b) continue;
        const c = thirdCard(a, b);
        assert.ok(c !== a && c !== b && bruteIsSet(a, b, c));
      }
  });

  test('the full deck holds exactly 1080 sets, each listed once in board order', () => {
    const deck = fullDeck();
    const sets = findSets(deck);
    assert.equal(sets.length, 1080);
    assert.equal(new Set(sets.map(key)).size, 1080);
    for (const [a, b, c] of sets) assert.ok(a < b && b < c && isSet(a, b, c));
    assert.equal(bruteSets(deck).length, 1080);
    assert.equal(hasSet(deck), true);
  });

  test('findSets and hasSet agree with a brute-force scan on 400 random boards', () => {
    const rng = mulberry32(99);
    for (let n = 0; n < 400; n++) {
      const size = Math.floor(rng() * 22);
      const board = shuffle(fullDeck(), rng).slice(0, size);
      const found = findSets(board).map(key).sort();
      assert.deepEqual(found, bruteSets(board));
      assert.equal(hasSet(board), found.length > 0);
    }
    const cap = capOf(20);
    assert.equal(hasSet(cap), false, 'a 20-card cap has no set');
  });

  test('findSets skips empty slots and rejects a duplicated card', () => {
    assert.deepEqual(findSets([0, null, 1, 2]), [[0, 1, 2]]);
    assert.throws(() => findSets([0, 0, 1]), RangeError);
  });
});

// ── Shuffle ──────────────────────────────────────────────────────────────────────────────────

describe('shuffle', () => {
  test('Fisher–Yates with an injected rng, input untouched', () => {
    const input = Object.freeze([0, 1, 2, 3]);
    assert.deepEqual(shuffle(input, () => 0), [1, 2, 3, 0]);
    assert.deepEqual(shuffle(input, () => 0.999), [0, 1, 2, 3]);
    assert.deepEqual(input, [0, 1, 2, 3]);
    const a = shuffle(fullDeck(), mulberry32(42));
    assert.deepEqual(a, shuffle(fullDeck(), mulberry32(42)), 'same seed, same order');
    assert.notDeepEqual(a, shuffle(fullDeck(), mulberry32(43)));
    assert.deepEqual([...a].sort((x, y) => x - y), fullDeck(), 'a permutation');
  });

  test('rejects an rng outside [0, 1)', () => {
    assert.throws(() => shuffle([1, 2, 3], () => 1), RangeError);
    assert.throws(() => shuffle([1, 2, 3], () => NaN), RangeError);
  });

  test('all 6 orders of 3 items are equally likely', () => {
    const rng: Rng = mulberry32(7);
    const counts = new Map<string, number>();
    const runs = 60000;
    for (let i = 0; i < runs; i++) {
      const k = shuffle([0, 1, 2], rng).join('');
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    assert.equal(counts.size, 6);
    for (const n of counts.values()) assert.ok(Math.abs(n - runs / 6) < runs / 6 / 20, `count ${n} within 5%`);
  });
});

// ── Dealing rules ────────────────────────────────────────────────────────────────────────────

describe('dealing', () => {
  test('newGame deals the top 12 cards into slots 0..11, in order', () => {
    const deck = shuffle(fullDeck(), mulberry32(3));
    const { state, events } = train(['solo'], 3, { deck });
    const fromRng = train(['solo'], 3);
    assert.deepEqual(fromRng.state, state, 'the rng shuffles exactly like shuffle(fullDeck(), rng)');
    assert.deepEqual(events[0], {
      type: 'newGame',
      mode: 'train',
      config: DEFAULT_CONFIG,
      players: ['solo'],
      deckCount: 81,
      startedAt: 0,
    });
    for (let i = 0; i < 12; i++) assert.deepEqual(events[i + 1], { type: 'deal', card: deck[i], slot: i, deckCount: 80 - i });
    assert.match(types(events), NEW_GAME_GRAMMAR);
    assert.deepEqual(state.board.slice(0, 12), deck.slice(0, 12));
    checkInvariants(state);
    assert.deepEqual(events.reduce(applyEvent, EMPTY_VIEW), publicView(state));
  });

  test('newGame validates its inputs', () => {
    assert.throws(() => newGame([], mulberry32(1)), RangeError);
    assert.throws(() => newGame(['a', 'a'], mulberry32(1)), RangeError);
    assert.throws(() => newGame([''], mulberry32(1)), TypeError);
    assert.throws(() => newGame(['a'], mulberry32(1), { deck: [1, 1] }), RangeError);
    assert.throws(() => newGame(['a'], mulberry32(1), { config: { callMs: 0 } }), RangeError, 'versus needs a limit');
    assert.throws(() => newGame(['a'], mulberry32(1), { mode: 'versus', config: { callMs: null } }), RangeError);
    assert.throws(() => newGame(['a'], mulberry32(1), { mode: 'train', config: { callMs: -5 } }), RangeError);
    assert.throws(() => newGame(['a'], mulberry32(1), { config: { penalty: { full: -1 } } }), RangeError);
    assert.throws(() => newGame(['a'], mulberry32(1), { config: { penalty: { partial: 0.5 } } }), RangeError);
    assert.throws(() => newGame(['a'], mulberry32(1), { config: { setPoints: 1.5 } }), RangeError);
    assert.throws(() => newGame(['a'], mulberry32(1), { config: { maxAttempts: 0 } }), RangeError);
    const custom = newGame(['a'], mulberry32(1), { config: { penalty: { full: 5 } } }).state.config;
    assert.deepEqual(custom.penalty, { full: 5, partial: 1 }, 'penalty overrides merge with the defaults');
  });

  test('a found set on a 12-card board is refilled into the same three slots', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const prev = deepFreeze(train(['solo'], seed).state);
      if (prev.board.length !== BOARD_SIZE) continue;
      const set = findSets(prev.board)[0];
      const out = callAndClaim(prev, 'solo', [set[2], set[0], set[1]], 999, 1000);
      assert.equal(out.result, 'found');
      const slots = set.map((c) => prev.board.indexOf(c)).sort((x, y) => x - y);
      assert.deepEqual(out.events[0], {
        type: 'retire',
        playerId: 'solo',
        cards: slots.map((s) => prev.board[s]),
        slots,
        score: 0,
        calledAt: 999,
        at: 1000,
      });
      slots.forEach((slot, i) => assert.deepEqual(out.events[i + 1], { type: 'deal', card: prev.deck[i], slot, deckCount: prev.deck.length - i - 1 }));
      assert.ok(!out.events.some((e) => e.type === 'move'), 'nothing moves');
      prev.board.forEach((card, slot) => {
        if (!slots.includes(slot)) assert.equal(out.state.board[slot], card, `slot ${slot} untouched`);
      });
      checked++;
    }
    assert.ok(checked >= 30, `exercised ${checked} boards`);
  });

  test('above 12 cards a found set is compacted: the last cards move into the holes', () => {
    const cap = capOf(12);
    const x = thirdCard(cap[0], cap[7]);
    let p = -1;
    let q = -1;
    for (const c of fullDeck()) {
      if (cap.includes(c) || c === x) continue;
      const r = thirdCard(c, cap[2]);
      if (!cap.includes(r) && r !== x) {
        p = c;
        q = r;
        break;
      }
    }
    const deck = deckStarting([...cap, p, q, x]);
    const start = train(['solo'], 1, { deck });
    assert.equal(types(start.events), `newGame${',deal'.repeat(12)},autoDeal${',deal'.repeat(3)}`);
    const prev = deepFreeze(start.state);
    assert.deepEqual(prev.board, [...cap, p, q, x]);

    const out = callAndClaim(prev, 'solo', [x, cap[7], cap[0]], 4, 5);
    assert.deepEqual(out.events, [
      { type: 'retire', playerId: 'solo', cards: [cap[0], cap[7], x], slots: [0, 7, 14], score: 0, calledAt: 4, at: 5 },
      { type: 'move', card: p, from: 12, to: 0 },
      { type: 'move', card: q, from: 13, to: 7 },
    ]);
    assert.deepEqual(out.state.board, [p, ...cap.slice(1, 7), q, ...cap.slice(8)]);
    assert.deepEqual(out.state.deck, prev.deck, 'no deal above 12');
  });

  test('with the deck empty, a found set is compacted instead of refilled', () => {
    const prev = deepFreeze(train(['solo'], 1, { deck: fullDeck().slice(0, 12) }).state);
    const call = deepFreeze(callSet(prev, 'solo', 0).state);
    const out = claim(call, 'solo', [0, 1, 2], 0);
    checkStep(call, out, 12);
    assert.equal(types(out.events), 'retire,move,move,move');
    assert.deepEqual(out.events.slice(1), [
      { type: 'move', card: 9, from: 9, to: 0 },
      { type: 'move', card: 10, from: 10, to: 1 },
      { type: 'move', card: 11, from: 11, to: 2 },
    ]);
    assert.deepEqual(out.state.board, [9, 10, 11, 3, 4, 5, 6, 7, 8]);
    assert.equal(out.state.over, false);
  });

  test('3 more are dealt automatically while there is no set (at the start)', () => {
    const cap = capOf(12);
    const deck = deckStarting(cap);
    const { state, events } = train(['solo'], 1, { deck });
    assert.deepEqual(events[13], { type: 'autoDeal', count: 3 });
    for (let i = 0; i < 3; i++) assert.deepEqual(events[14 + i], { type: 'deal', card: deck[12 + i], slot: 12 + i, deckCount: 81 - 13 - i });
    assert.match(types(events), NEW_GAME_GRAMMAR);
    assert.ok(state.board.length >= 15 && hasSet(state.board));
    checkInvariants(state);
  });

  test('3 more are dealt automatically when a refill leaves no set', () => {
    const cap = capOf(12);
    const set = setAvoiding(cap);
    const deck = deckStarting([...cap.slice(0, 9), ...set, ...cap.slice(9)]);
    const prev = deepFreeze(train(['solo'], 1, { deck }).state);
    const out = callAndClaim(prev, 'solo', set, 0, 0);
    assert.match(types(out.events), /^retire,deal,deal,deal,autoDeal,deal,deal,deal(,autoDeal(,deal){3})*$/);
    assert.deepEqual(
      out.events.slice(1, 4).map((e) => (e.type === 'deal' ? [e.card, e.slot] : [])),
      [
        [cap[9], 9],
        [cap[10], 10],
        [cap[11], 11],
      ],
    );
    assert.deepEqual(out.state.board.slice(0, 12), cap);
    assert.equal(out.state.board[12], prev.deck[3], 'the extra row is appended at slot 12');
  });

  test('dealMore appends 3 cards, up to 21, and is refused when it cannot', () => {
    let state = deepFreeze(plainStart('train', ['solo']));
    for (const size of [15, 18, 21]) {
      const prev = state;
      const out = dealMore(prev);
      checkStep(prev, out);
      assert.equal(out.result, 'dealt');
      assert.deepEqual(out.events, [
        { type: 'manualDeal', count: 3 },
        { type: 'deal', card: prev.deck[0], slot: size - 3, deckCount: prev.deck.length - 1 },
        { type: 'deal', card: prev.deck[1], slot: size - 2, deckCount: prev.deck.length - 2 },
        { type: 'deal', card: prev.deck[2], slot: size - 1, deckCount: prev.deck.length - 3 },
      ]);
      state = deepFreeze(out.state);
    }
    const full = dealMore(state);
    assert.equal(full.result, 'boardFull');
    assert.equal(full.state, state);

    const empty = deepFreeze(train(['solo'], 1, { deck: fullDeck().slice(0, 12) }).state);
    assert.equal(dealMore(empty).result, 'deckEmpty');
    assert.equal(dealMore(empty).state, empty);
  });

  test('game over: no set on the board and the deck empty', () => {
    const cap = capOf(12);
    const tie = versus(['a', 'b'], 1, { deck: cap });
    assert.equal(types(tie.events), `newGame${',deal'.repeat(12)},gameOver`);
    assert.deepEqual(tie.events.at(-1), { type: 'gameOver', scores: { a: 0, b: 0 }, winners: ['a', 'b'] });
    assert.equal(tie.state.over, true);
    assert.equal(callSet(tie.state, 'a', 0).result, 'gameOver');

    const set = setAvoiding(cap);
    const prev = deepFreeze(versus(['a', 'b'], 1, { deck: [...cap.slice(0, 9), ...set] }).state);
    const held = deepFreeze(callSet(prev, 'a', 6).state);
    const out = claim(held, 'a', set, 7);
    checkStep(held, out, 12);
    assert.deepEqual(out.events, [
      { type: 'retire', playerId: 'a', cards: set, slots: [9, 10, 11], score: 3, calledAt: 6, at: 7 },
      { type: 'gameOver', scores: { a: 3, b: 0 }, winners: ['a'] },
    ]);
    assert.deepEqual(out.state.board, cap.slice(0, 9));
    const over = deepFreeze(out.state);
    assert.equal(claim(over, 'a', cap.slice(0, 3), 8).result, 'gameOver');
    assert.equal(claim(over, 'a', cap.slice(0, 3), 8).state, over);
    assert.equal(dealMore(over).result, 'gameOver');
    const hint = useHint(over, 'a', 9);
    assert.deepEqual([hint.result, hint.card, hint.state], ['gameOver', null, over]);
  });
});

// ── Train mode ───────────────────────────────────────────────────────────────────────────────

describe('train mode', () => {
  test('a claim needs a call first, as in versus', () => {
    const prev = deepFreeze(train().state);
    const set = findSets(prev.board)[0];
    const noCall = claim(prev, 'solo', set, 5);
    assert.equal(noCall.result, 'noCall');
    assert.equal(noCall.state, prev);
    assert.deepEqual(noCall.events, []);

    const call = callSet(prev, 'solo', 10);
    checkStep(prev, call);
    assert.deepEqual(call.events, [{ type: 'call', playerId: 'solo', calledAt: 10, deadline: 5010 }]);
    assert.deepEqual(publicView(call.state).lock, { playerId: 'solo', calledAt: 10, deadline: 5010 });
    const held = deepFreeze(call.state);
    assert.equal(dealMore(held, 11).result, 'locked', 'the board is frozen while calling');
    const found = claim(held, 'solo', set, 20);
    checkStep(held, found);
    assert.equal(found.result, 'found');
    assert.equal(found.state.lock, null);
  });

  test('no score: found sets go to the pile, wrong picks count as mistakes', () => {
    let state = deepFreeze(plainStart('train', ['solo']));
    const boardBefore = state.board;
    const wrong = callAndClaim(state, 'solo', nonSetOnBoard(state.board), 1, 2);
    assert.equal(wrong.result, 'wrong');
    assert.deepEqual(wrong.events, [
      {
        type: 'wrong',
        playerId: 'solo',
        cards: wrong.events[0].type === 'wrong' ? wrong.events[0].cards : [],
        slots: wrong.events[0].type === 'wrong' ? wrong.events[0].slots : [],
        penalty: 0,
        score: 0,
        cooldownUntil: 0,
        calledAt: 1,
        at: 2,
      },
    ]);
    state = deepFreeze(wrong.state);
    assert.deepEqual(state.board, boardBefore, 'a wrong pick leaves the board alone');
    assert.equal(state.players[0].mistakes, 1);

    const found = callAndClaim(state, 'solo', findSets(state.board)[0], 3, 4);
    state = deepFreeze(found.state);
    assert.equal(state.players[0].score, 0);
    assert.equal(state.players[0].pile.length, 3);
    const again = callAndClaim(state, 'solo', nonSetOnBoard(state.board), 5, 6);
    assert.equal(again.state.players[0].score, 0);
    assert.equal(again.state.players[0].pile.length, 3, 'the pile keeps what was taken');
    assert.equal(again.state.players[0].mistakes, 2);
  });

  test('an expired call counts as a timeout, at no cost', () => {
    const start = deepFreeze(train().state);
    const held = deepFreeze(callSet(start, 'solo', 100).state);
    assert.equal(expire(held, 5099).result, 'none');
    const out = expire(held, 5200);
    checkStep(held, out);
    assert.deepEqual(out.events, [{ type: 'timeout', playerId: 'solo', calledAt: 100, at: 5100, penalty: 0, score: 0, cooldownUntil: 0 }]);
    assert.equal(out.state.players[0].timeouts, 1);
    assert.equal(out.state.lock, null);
  });

  test('callMs null (or 0): no time limit after calling', () => {
    for (const callMs of [null, 0]) {
      const start = deepFreeze(train(['solo'], 1, { config: { callMs } }).state);
      assert.equal(start.config.callMs, null);
      const call = callSet(start, 'solo', 50);
      checkStep(start, call);
      assert.deepEqual(call.events, [{ type: 'call', playerId: 'solo', calledAt: 50, deadline: null }]);
      const held = deepFreeze(call.state);
      const late = 1e12;
      assert.equal(expire(held, late).result, 'none');
      assert.equal(expire(held, late).state, held);
      assert.equal(callSet(held, 'solo', late).state, held, 'calling again is a no-op');
      const out = claim(held, 'solo', findSets(held.board)[0], late);
      checkStep(held, out);
      assert.equal(out.result, 'found');
      assert.equal(playerStats(out.state, 'solo')?.attempts[0].pickMs, late - 50);
    }
  });

  test('stale and invalid picks change nothing', () => {
    const start = deepFreeze(plainStart('train', ['solo']));
    const set = findSets(start.board)[0];
    const after = deepFreeze(callAndClaim(start, 'solo', set, 1, 1).state);
    const held = deepFreeze(callSet(after, 'solo', 2).state);
    const triple: [CardId, CardId, CardId] = [set[0], held.board[0], held.board[1]];
    const stale = claim(held, 'solo', triple, 2);
    assert.equal(stale.result, 'stale');
    assert.equal(stale.state, held, 'the call is kept');
    assert.deepEqual(stale.events, [{ type: 'stale', playerId: 'solo', cards: triple, missing: [set[0]] }]);

    const b = held.board;
    const bad: unknown[] = [[b[0], b[1]], [b[0], b[0], b[1]], [b[0], b[1], 81], [b[0], b[1], 1.5], 'abc', null];
    for (const cards of bad) {
      const out = claim(held, 'solo', cards as CardId[], 3);
      assert.equal(out.result, 'invalid');
      assert.equal(out.state, held);
      assert.deepEqual(out.events, []);
    }
    assert.equal(claim(held, 'nobody', findSets(b)[0], 3).result, 'invalid');
    assert.equal(callSet(held, 'nobody', 3).result, 'invalid');
  });
});

// ── Hints ────────────────────────────────────────────────────────────────────────────────────

describe('hints', () => {
  test('useHint returns a card of a set on the board, counts it and emits hint', () => {
    const prev = deepFreeze(train().state);
    const out = useHint(prev, 'solo', 5);
    checkStep(prev, out);
    assert.equal(out.result, 'hint');
    assert.ok(out.card !== null);
    assert.ok(findSets(prev.board).some((set) => set.includes(out.card ?? -1)), 'the card is part of a set');
    assert.deepEqual(out.events, [{ type: 'hint', playerId: 'solo', card: out.card }]);
    assert.equal(out.state.players[0].hints, 1);
    assert.deepEqual(out.state.board, prev.board, 'the board is untouched');

    const held = deepFreeze(callSet(out.state, 'solo', 6).state);
    const again = useHint(held, 'solo', 7);
    checkStep(held, again);
    assert.deepEqual(again.state.lock, held.lock, 'a hint keeps the call');
    assert.equal(playerStats(again.state, 'solo')?.hints, 2);

    const nobody = useHint(prev, 'nobody', 5);
    assert.deepEqual([nobody.result, nobody.card, nobody.state, nobody.events], ['invalid', null, prev, []]);
  });

  test('a hint expires a dead call first', () => {
    const held = deepFreeze(callSet(train().state, 'solo', 0).state);
    const out = useHint(held, 'solo', 6000);
    checkStep(held, out);
    assert.equal(types(out.events), 'timeout,hint');
  });

  test('the hinted flag is recorded on the event and the attempt', () => {
    const start = deepFreeze(train().state);
    const out = callAndClaim(start, 'solo', findSets(start.board)[0], 1, 2, { hinted: true });
    assert.equal(out.events[0].type === 'retire' && out.events[0].hinted, true);
    assert.equal(out.state.players[0].attempts[0].hinted, true);
    const plain = callAndClaim(deepFreeze(out.state), 'solo', nonSetOnBoard(out.state.board), 3, 4);
    assert.equal('hinted' in plain.events[0], false, 'no flag, no key');
    assert.equal('hinted' in plain.state.players[0].attempts[1], false);
    const wrongHinted = callAndClaim(deepFreeze(plain.state), 'solo', nonSetOnBoard(plain.state.board), 5, 6, { hinted: true });
    assert.equal(wrongHinted.events[0].type === 'wrong' && wrongHinted.events[0].hinted, true);
  });
});

// ── Attempt records ──────────────────────────────────────────────────────────────────────────

describe('attempt records', () => {
  test('every resolved call is recorded; playerStats derives pick time and gap', () => {
    let state = deepFreeze(newGame(['solo'], mulberry32(4), { mode: 'train', now: 1000 }).state);
    const found1 = callAndClaim(state, 'solo', findSets(state.board)[0], 3000, 4000);
    state = deepFreeze(found1.state);
    state = deepFreeze(callAndClaim(state, 'solo', nonSetOnBoard(state.board), 4500, 5000).state);
    const held = deepFreeze(callSet(state, 'solo', 6000).state);
    state = deepFreeze(expire(held, 11500).state); // deadline 11000
    const found2 = callAndClaim(state, 'solo', findSets(state.board)[0], 12000, 13000, { hinted: true });
    state = deepFreeze(found2.state);

    const p = state.players[0];
    assert.deepEqual(
      p.attempts.map((a) => [a.result, a.calledAt, a.resolvedAt, a.hinted ?? false]),
      [
        ['found', 3000, 4000, false],
        ['wrong', 4500, 5000, false],
        ['timeout', 6000, 11000, false],
        ['found', 12000, 13000, true],
      ],
    );
    assert.deepEqual(p.attempts[0].cards, found1.events[0].type === 'retire' ? found1.events[0].cards : null);
    const stats = playerStats(state, 'solo');
    assert.ok(stats !== undefined);
    assert.deepEqual(
      stats.attempts.map((a) => [a.pickMs, a.gapMs]),
      [
        [1000, 2000],
        [500, 500],
        [5000, 1000],
        [1000, 1000],
      ],
    );
    assert.deepEqual(
      { score: stats.score, setsFound: stats.setsFound, mistakes: stats.mistakes, timeouts: stats.timeouts, hints: stats.hints, splits: stats.splits },
      { score: 0, setsFound: 2, mistakes: 1, timeouts: 1, hints: 0, splits: [3000, 9000] },
    );
    assert.deepEqual(playerStats(publicView(state), 'solo'), stats, 'same stats from the public view');
    assert.equal(playerStats(state, 'nobody'), undefined);
  });

  test('the cap keeps the newest records; the oldest kept gap becomes unknown', () => {
    const s = scripted(versus(['a', 'b'], 2, { now: 0, config: { maxAttempts: 2 } }).state);
    s.move('a', 'found');
    s.move('a', 'wrong');
    s.move('b', 'found');
    s.move('a', 'timeout');
    const a = s.state.players[0];
    assert.deepEqual(
      a.attempts.map((x) => x.result),
      ['wrong', 'timeout'],
    );
    assert.equal(a.foundAt.length, 1, 'counters are not capped');
    const stats = playerStats(s.state, 'a');
    assert.equal(stats?.attempts[0].gapMs, null);
    assert.equal(stats?.attempts[1].gapMs, stats ? stats.attempts[1].calledAt - stats.attempts[0].resolvedAt : -1);
    const b = playerStats(s.state, 'b');
    assert.equal(b?.attempts[0].gapMs, b ? b.attempts[0].calledAt - 0 : -1, 'first call: gap from startedAt');
  });
});

// ── Versus: scoring ──────────────────────────────────────────────────────────────────────────

describe('versus: scoring', () => {
  test('the worked example: 0 → +3 → 3 → −3 → 0 → −1 → −1 → −1 → −2 → +3 → 1', () => {
    const s = scripted(versus().state);
    const seen: Array<[string, number, number]> = [];
    const log = (e: GameEvent) => {
      if (e.type === 'retire') seen.push([e.type, 3, e.score]);
      else if (e.type === 'wrong' || e.type === 'timeout') seen.push([e.type, -e.penalty, e.score]);
      else assert.fail(`unexpected ${e.type}`);
    };
    log(s.move('a', 'found'));
    log(s.move('a', 'wrong'));
    log(s.move('a', 'wrong'));
    log(s.move('a', 'timeout'));
    log(s.move('a', 'found'));
    assert.deepEqual(seen, [
      ['retire', 3, 3],
      ['wrong', -3, 0],
      ['wrong', -1, -1],
      ['timeout', -1, -2],
      ['retire', 3, 1],
    ]);
    const a = s.state.players[0];
    assert.equal(a.score, 1);
    assert.equal(a.pile.length, 6, 'the pile keeps both sets; penalties never take cards');
    assert.deepEqual([a.mistakes, a.timeouts], [2, 1]);
    assert.equal(scoreOf(s.state, 'b'), 0);
  });

  test('penalty boundaries: 1 point under the threshold, 3 at or above it', () => {
    const s = scripted(versus(['a', 'b'], 3).state);
    const failAt = (kind: 'wrong' | 'timeout', expectedScoreBefore: number, expectedPenalty: number) => {
      assert.equal(scoreOf(s.state, 'a'), expectedScoreBefore);
      const e = s.move('a', kind);
      assert.ok(e.type === kind);
      assert.equal(e.type === 'wrong' || e.type === 'timeout' ? e.penalty : -1, expectedPenalty, `${kind} at ${expectedScoreBefore}`);
      assert.equal(scoreOf(s.state, 'a'), expectedScoreBefore - expectedPenalty);
    };
    failAt('wrong', 0, 1); // → −1
    failAt('timeout', -1, 1); // → −2
    s.move('a', 'found'); // → 1
    failAt('wrong', 1, 1); // → 0
    s.move('a', 'wrong'); // → −1
    s.move('a', 'found'); // → 2
    failAt('timeout', 2, 1); // → 1
    s.move('a', 'found'); // → 4
    failAt('wrong', 4, 3); // → 1
    s.move('a', 'wrong'); // → 0
    s.move('a', 'found'); // → 3
    failAt('timeout', 3, 3); // → 0
    s.move('a', 'found'); // → 3
    failAt('wrong', 3, 3); // → 0

    const cfg = DEFAULT_CONFIG;
    assert.deepEqual(
      [-5, -1, 0, 1, 2, 3, 4, 30].map((score) => penaltyFor('versus', cfg, score)),
      [1, 1, 1, 1, 1, 3, 3, 3],
    );
    assert.equal(penaltyFor('train', cfg, 10), 0);
  });

  test('setPoints and penalty are configurable', () => {
    const s = scripted(versus(['a', 'b'], 4, { config: { setPoints: 2, penalty: { full: 5, partial: 0 } } }).state);
    assert.equal(s.move('a', 'found').type === 'retire' && scoreOf(s.state, 'a'), 2);
    const free = s.move('a', 'wrong');
    assert.deepEqual(free.type === 'wrong' ? [free.penalty, free.score] : [], [0, 2], 'below 5: partial = 0');
    s.move('a', 'found');
    s.move('a', 'found');
    const full = s.move('a', 'timeout');
    assert.deepEqual(full.type === 'timeout' ? [full.penalty, full.score] : [], [5, 1]);
  });
});

// ── Versus: call and lock ────────────────────────────────────────────────────────────────────

describe('versus: call and lock', () => {
  test('a claim without a call is rejected', () => {
    const prev = deepFreeze(versus().state);
    const out = claim(prev, 'a', findSets(prev.board)[0], 0);
    assert.equal(out.result, 'noCall');
    assert.equal(out.state, prev);
    assert.deepEqual(out.events, []);
  });

  test('first call wins; others are locked out with no penalty; the board is frozen', () => {
    const start = deepFreeze(versus().state);
    const call = callSet(start, 'a', 100);
    checkStep(start, call);
    assert.equal(call.result, 'called');
    assert.deepEqual(call.events, [{ type: 'call', playerId: 'a', calledAt: 100, deadline: 5100 }]);
    const held = deepFreeze(call.state);
    assert.deepEqual(publicView(held).lock, { playerId: 'a', calledAt: 100, deadline: 5100 });

    const bCall = callSet(held, 'b', 100);
    assert.equal(bCall.result, 'locked');
    assert.deepEqual(bCall.events, [{ type: 'locked', playerId: 'b', holder: 'a', deadline: 5100 }]);
    assert.equal(bCall.state, held);

    const bClaim = claim(held, 'b', findSets(held.board)[0], 200);
    assert.equal(bClaim.result, 'locked');
    assert.equal(bClaim.state, held);
    assert.equal(bClaim.state.players[1].score, 0);

    assert.equal(dealMore(held, 300).result, 'locked');
    const again = callSet(held, 'a', 400);
    assert.equal(again.result, 'called', 'the holder calling again is a no-op');
    assert.equal(again.state, held);
    assert.deepEqual(again.events, []);
  });

  test('simultaneous calls: arrival order decides', () => {
    const start = deepFreeze(versus().state);
    const ab = callSet(callSet(start, 'a', 500).state, 'b', 500);
    assert.equal(ab.result, 'locked');
    assert.equal(ab.state.lock?.playerId, 'a');
    const ba = callSet(callSet(start, 'b', 500).state, 'a', 500);
    assert.equal(ba.state.lock?.playerId, 'b');
  });

  test('found under the lock scores +3 and releases it', () => {
    const held = deepFreeze(callSet(versus().state, 'a', 0).state);
    const out = claim(held, 'a', findSets(held.board)[0], 1000);
    checkStep(held, out);
    assert.equal(out.result, 'found');
    assert.equal(out.state.lock, null);
    assert.equal(out.state.players[0].score, 3);
    assert.deepEqual(out.state.players[0].foundAt, [1000]);
    assert.equal(callSet(out.state, 'b', 1001).result, 'called', 'b can call next');
  });

  test('wrong under the lock costs the penalty and releases it', () => {
    let state = deepFreeze(callSet(versus().state, 'a', 0).state);
    state = deepFreeze(claim(state, 'a', findSets(state.board)[0], 10).state);
    state = deepFreeze(callSet(state, 'a', 20).state);
    const out = claim(state, 'a', nonSetOnBoard(state.board), 30);
    checkStep(state, out);
    assert.equal(out.result, 'wrong');
    assert.equal(out.events[0].type === 'wrong' && out.events[0].penalty, 3);
    assert.equal(out.state.players[0].score, 0);
    assert.equal(out.state.players[0].mistakes, 1);
    assert.equal(out.state.lock, null);
    assert.equal(callSet(out.state, 'a', 31).result, 'called', 'no cooldown by default');
  });

  test('a stale claim keeps the lock and costs nothing', () => {
    let state = deepFreeze(callSet(versus().state, 'a', 0).state);
    const set = findSets(state.board)[0];
    state = deepFreeze(claim(state, 'a', set, 10).state);
    state = deepFreeze(callSet(state, 'a', 20).state);
    const others = state.board.filter((c) => !set.includes(c)).slice(0, 2);
    const out = claim(state, 'a', [set[0], others[0], others[1]], 30);
    assert.equal(out.result, 'stale');
    assert.equal(out.state, state);
    assert.deepEqual(out.state.lock, { playerId: 'a', calledAt: 20, deadline: 5020 });
  });

  test('timeout: expire() charges the holder and clears the lock; no floor', () => {
    let state = deepFreeze(callSet(versus().state, 'a', 0).state);
    state = deepFreeze(claim(state, 'a', findSets(state.board)[0], 10).state);
    state = deepFreeze(callSet(state, 'a', 10000).state);
    const early = expire(state, 14999);
    assert.equal(early.result, 'none');
    assert.equal(early.state, state);
    const out = expire(state, 15000);
    checkStep(state, out);
    assert.equal(out.result, 'expired');
    assert.deepEqual(out.events, [{ type: 'timeout', playerId: 'a', calledAt: 10000, at: 15000, penalty: 3, score: 0, cooldownUntil: 0 }]);
    assert.equal(out.state.lock, null);
    assert.equal(out.state.players[0].timeouts, 1);

    const zero = deepFreeze(callSet(out.state, 'b', 15000).state);
    const negative = expire(zero, 20000);
    assert.deepEqual(negative.events, [{ type: 'timeout', playerId: 'b', calledAt: 15000, at: 20000, penalty: 1, score: -1, cooldownUntil: 0 }]);
  });

  test('an expired lock is cleared by the next action even if the timer never fired', () => {
    const held = deepFreeze(callSet(versus().state, 'a', 0).state);
    const bCall = callSet(held, 'b', 6000);
    checkStep(held, bCall);
    assert.deepEqual(bCall.events, [
      { type: 'timeout', playerId: 'a', calledAt: 0, at: 5000, penalty: 1, score: -1, cooldownUntil: 0 },
      { type: 'call', playerId: 'b', calledAt: 6000, deadline: 11000 },
    ]);
    assert.equal(bCall.state.seq, held.seq + 1, 'one transition, one seq');

    const late = claim(held, 'a', findSets(held.board)[0], 5000);
    checkStep(held, late);
    assert.equal(late.result, 'noCall', 'a claim at the deadline is too late');
    assert.equal(types(late.events), 'timeout');
  });

  test('cooldown (off by default) blocks calls after a wrong claim or a timeout', () => {
    const cfg = { cooldownMs: 3000 };
    let state = deepFreeze(versus(['a', 'b'], 1, { config: cfg }).state);
    state = deepFreeze(callSet(state, 'a', 0).state);
    const wrong = claim(state, 'a', nonSetOnBoard(state.board), 100);
    assert.equal(wrong.state.players[0].cooldownUntil, 3100);
    state = deepFreeze(wrong.state);
    const blocked = callSet(state, 'a', 3099);
    assert.equal(blocked.result, 'cooldown');
    assert.deepEqual(blocked.events, [{ type: 'cooldown', playerId: 'a', until: 3100 }]);
    assert.equal(blocked.state, state);
    assert.equal(callSet(state, 'b', 3099).result, 'called', 'other players are not affected');
    const ok = callSet(state, 'a', 3100);
    assert.equal(ok.result, 'called');

    const timedOut = expire(ok.state, 9000);
    assert.equal(timedOut.state.players[0].cooldownUntil, 8100 + 3000, 'timeout cooldown counts from the deadline');
  });

  test('three players: one lock, everyone else waits', () => {
    let state = deepFreeze(versus(['a', 'b', 'c'], 5).state);
    const run = (fn: (s: GameState) => AnyStep) => {
      const out = fn(state);
      checkStep(state, out);
      state = deepFreeze(out.state);
      return out.result;
    };
    assert.equal(run((s) => callSet(s, 'b', 0)), 'called');
    assert.equal(run((s) => callSet(s, 'a', 1)), 'locked');
    assert.equal(run((s) => callSet(s, 'c', 1)), 'locked');
    assert.equal(run((s) => claim(s, 'c', findSets(s.board)[0], 2)), 'locked');
    assert.equal(run((s) => claim(s, 'b', findSets(s.board)[0], 3)), 'found');
    assert.equal(run((s) => callSet(s, 'c', 4)), 'called');
    assert.equal(run((s) => claim(s, 'c', nonSetOnBoard(s.board), 5)), 'wrong');
    assert.equal(run((s) => callSet(s, 'a', 6)), 'called');
    assert.equal(run((s) => claim(s, 'a', findSets(s.board)[0], 7)), 'found');
    assert.deepEqual(
      state.players.map((p) => [p.id, p.score, p.mistakes]),
      [
        ['a', 3, 0],
        ['b', 3, 0],
        ['c', -1, 1],
      ],
    );
  });

  test('publicView carries the lock and hides the deck order', () => {
    const state = callSet(versus().state, 'a', 0).state;
    const view = publicView(state);
    assert.deepEqual(Object.keys(view).sort(), ['board', 'config', 'deckCount', 'lock', 'mode', 'over', 'players', 'schema', 'seq', 'startedAt']);
    assert.equal(view.deckCount, state.deck.length);
    assert.deepEqual(view.lock, { playerId: 'a', calledAt: 0, deadline: 5000 });
    assert.equal(JSON.stringify(view).includes(JSON.stringify(state.deck)), false);
  });

  test('applyAction dispatches JSON actions', () => {
    const start = deepFreeze(versus().state);
    const call = applyAction(start, JSON.parse('{"type":"call","playerId":"a"}') as Action, 0);
    assert.equal(call.result, 'called');
    const cards = findSets(call.state.board)[0];
    const found = applyAction(call.state, { type: 'claim', playerId: 'a', cards, hinted: true }, 10);
    assert.equal(found.result, 'found');
    assert.equal(found.state.players[0].attempts[0].hinted, true);
    const hint = applyAction(start, { type: 'hint', playerId: 'b' }, 0);
    assert.equal(hint.result, 'hint');
    assert.equal(hint.state.players[1].hints, 1);
    assert.equal(applyAction(start, { type: 'dealMore' }, 0).result, 'dealt');
    assert.equal(applyAction(start, JSON.parse('{"type":"nuke"}') as Action, 0).result, 'invalid');
    assert.equal(applyAction(start, null as unknown as Action, 0).result, 'invalid');
    assert.throws(() => callSet(start, 'a', NaN), TypeError);
  });
});

// ── Full simulated games ─────────────────────────────────────────────────────────────────────

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)];
}

function staleTriple(s: GameState, rng: Rng): CardId[] | null {
  const taken = s.players.flatMap((p) => p.pile);
  if (taken.length === 0 || s.board.length < 2) return null;
  const two = shuffle(s.board, rng).slice(0, 2);
  return [pick(taken, rng), two[0], two[1]];
}

interface Tally {
  [result: string]: number;
}

function finalChecks(state: GameState, log: GameEvent[]): void {
  assert.equal(state.over, true);
  assert.equal(state.deck.length, 0);
  assert.equal(hasSet(state.board), false);
  assert.equal(log.filter((e) => e.type === 'gameOver').length, 1);
  assert.equal(log.at(-1)?.type, 'gameOver');
  for (const p of state.players) {
    let score = 0;
    for (const e of log) {
      if ((e.type === 'retire' || e.type === 'wrong' || e.type === 'timeout') && e.playerId === p.id) {
        if (e.type === 'retire') {
          score += state.mode === 'versus' ? state.config.setPoints : 0;
        } else {
          assert.equal(e.penalty, expectedPenalty(state.mode, state.config, score), 'penalty follows the scoring rule');
          score -= e.penalty;
        }
        assert.equal(score, e.score, 'event scores add up');
      }
    }
    assert.equal(p.score, score);
  }
}

function dealExpectation(s: GameState): string {
  return s.deck.length === 0 ? 'deckEmpty' : s.board.length >= MAX_BOARD ? 'boardFull' : 'dealt';
}

function simulateTrain(seed: number, config: GameConfigInput, tally: Tally): void {
  const bot = mulberry32(seed * 7919 + 1);
  let now = 0;
  const start = newGame(['solo'], mulberry32(seed), { mode: 'train', now, config });
  assert.match(types(start.events), NEW_GAME_GRAMMAR);
  assert.deepEqual(start.events.reduce(applyEvent, EMPTY_VIEW), publicView(start.state));
  checkInvariants(start.state);
  const log: GameEvent[] = [...start.events];
  let state = deepFreeze(start.state);
  for (let steps = 0; !state.over; steps++) {
    assert.ok(steps < 10000, 'game ends');
    now += 1 + Math.floor(bot() * 3000);
    const r = bot();
    const prev = state;
    const lock = liveLock(prev, now);
    const aSet = () => shuffle(pick(findSets(prev.board), bot), bot);
    const anyThree = () => shuffle(prev.board, bot).slice(0, 3);
    let out: AnyStep;
    let expected: string;
    if (lock === null) {
      if (r < 0.7) {
        out = callSet(prev, 'solo', now);
        expected = expectCall(prev, 'solo', now);
      } else if (r < 0.8) {
        const cards = aSet();
        out = claim(prev, 'solo', cards, now);
        expected = expectClaim(prev, 'solo', cards, now);
      } else if (r < 0.9) {
        out = useHint(prev, 'solo', now);
        expected = 'hint';
      } else {
        out = dealMore(prev, now);
        expected = dealExpectation(prev);
      }
    } else if (r < 0.55) {
      const cards = aSet();
      out = claim(prev, 'solo', cards, now, { hinted: r < 0.1 });
      expected = expectClaim(prev, 'solo', cards, now);
    } else if (r < 0.75) {
      const cards = anyThree();
      out = claim(prev, 'solo', cards, now);
      expected = expectClaim(prev, 'solo', cards, now);
    } else if (r < 0.8) {
      const cards = staleTriple(prev, bot) ?? anyThree();
      out = claim(prev, 'solo', cards, now);
      expected = expectClaim(prev, 'solo', cards, now);
    } else if (r < 0.85) {
      out = useHint(prev, 'solo', now);
      expected = 'hint';
    } else if (r < 0.9) {
      out = dealMore(prev, now);
      expected = 'locked';
    } else if (lock.deadline !== null) {
      now = Math.max(now, lock.deadline + Math.floor(bot() * 100)); // the timer fires
      out = expire(prev, now);
      expected = 'expired';
    } else {
      out = expire(prev, now);
      expected = 'none';
    }
    assert.equal(out.result, expected, `step ${steps}`);
    checkStep(prev, out);
    tally[out.result] = (tally[out.result] ?? 0) + 1;
    log.push(...out.events);
    state = deepFreeze(out.state);
  }
  finalChecks(state, log);
  assert.equal(state.players[0].pile.length + state.board.length, DECK_SIZE);
}

/** One random bot move in a versus game, with the result the rules say it should get. */
function versusMove(prev: GameState, players: readonly string[], now: number, bot: Rng): { out: AnyStep; expected: string; now: number } {
  const lock = prev.lock;
  const actor = pick(players, bot);
  const r = bot();
  const aSet = () => shuffle(pick(findSets(prev.board), bot), bot);
  const anyThree = () => shuffle(prev.board, bot).slice(0, 3);
  const doClaim = (cards: CardId[], at: number) => ({ out: claim(prev, actor, cards, at), expected: expectClaim(prev, actor, cards, at), now: at });
  const doCall = () => ({ out: callSet(prev, actor, now), expected: expectCall(prev, actor, now), now });

  if (r >= 0.98) return { out: useHint(prev, actor, now), expected: 'hint', now };
  if (lock !== null && lock.deadline !== null && r < 0.1) {
    const at = Math.max(now, lock.deadline + Math.floor(bot() * 100)); // the host timer fires
    return { out: expire(prev, at), expected: 'expired', now: at };
  }
  if (lock !== null && lock.deadline !== null && actor === lock.playerId) {
    if (r < 0.6) return doClaim(aSet(), now);
    if (r < 0.8) return doClaim(anyThree(), now);
    if (r < 0.85) return doClaim(staleTriple(prev, bot) ?? anyThree(), now);
    if (r < 0.9) return doCall();
    return doClaim(aSet(), Math.max(now, lock.deadline + Math.floor(bot() * 1000))); // too slow
  }
  if (lock !== null) return r < 0.5 ? doCall() : doClaim(aSet(), now);
  if (r < 0.75) return doCall();
  if (r < 0.85) return doClaim(aSet(), now);
  if (r < 0.9) return { out: dealMore(prev, now), expected: dealExpectation(prev), now };
  return { out: expire(prev, now), expected: 'none', now };
}

function simulateVersus(seed: number, config: GameConfigInput, tally: Tally): void {
  const players = ['p1', 'p2', 'p3'];
  const bot = mulberry32(seed * 104729 + 3);
  let now = 1_700_000_000_000;
  const start = newGame(players, mulberry32(seed), { mode: 'versus', now, config });
  assert.match(types(start.events), NEW_GAME_GRAMMAR);
  checkInvariants(start.state);
  const log: GameEvent[] = [...start.events];
  let state = deepFreeze(start.state);
  for (let steps = 0; !state.over; steps++) {
    assert.ok(steps < 20000, 'game ends');
    now += Math.floor(bot() * 800);
    const prev = state;
    const move = versusMove(prev, players, now, bot);
    now = move.now;
    const step = move.out;
    assert.equal(step.result, move.expected, `step ${steps}`);
    checkStep(prev, step);
    for (const e of step.events) {
      const before = prev.players.find((p) => 'playerId' in e && p.id === e.playerId);
      if ((e.type === 'wrong' || e.type === 'timeout') && before !== undefined) {
        assert.equal(e.penalty, expectedPenalty(prev.mode, prev.config, before.score), 'penalty: 3 at ≥ 3, else 1');
        if (before.score < 0) tally.negative = (tally.negative ?? 0) + 1;
      }
      if (e.type === 'timeout' && step.result !== 'expired') tally.autoExpired = (tally.autoExpired ?? 0) + 1;
      if (e.type === 'autoDeal') tally.autoDeal = (tally.autoDeal ?? 0) + 1;
      if (e.type === 'move') tally.move = (tally.move ?? 0) + 1;
    }
    tally[step.result] = (tally[step.result] ?? 0) + 1;
    log.push(...step.events);
    state = deepFreeze(step.state);
  }
  finalChecks(state, log);
}

describe('simulated games (seeded)', () => {
  test('40 random train games (timed and untimed) play to the end with every invariant holding', () => {
    const tally: Tally = {};
    for (let seed = 1; seed <= 40; seed++) simulateTrain(seed, seed % 2 === 0 ? { callMs: null } : {}, tally);
    for (const r of ['called', 'found', 'wrong', 'stale', 'noCall', 'hint', 'locked', 'expired', 'none', 'dealt']) {
      assert.ok((tally[r] ?? 0) > 0, `exercised '${r}'`);
    }
  });

  test('40 random 3-player versus games with calls, claims and timeouts play to the end', () => {
    const tally: Tally = {};
    for (let seed = 1; seed <= 40; seed++) simulateVersus(seed, seed % 2 === 0 ? { cooldownMs: 1500 } : {}, tally);
    for (const r of ['called', 'locked', 'cooldown', 'found', 'wrong', 'stale', 'noCall', 'expired', 'none', 'dealt', 'hint', 'autoExpired', 'autoDeal', 'move', 'negative']) {
      assert.ok((tally[r] ?? 0) > 0, `exercised '${r}'`);
    }
  });

  test('same seeds, same game', () => {
    const a: Tally = {};
    const b: Tally = {};
    simulateVersus(7, {}, a);
    simulateVersus(7, {}, b);
    assert.deepEqual(a, b);
    assert.deepEqual(versus(['a', 'b'], 9).events, versus(['a', 'b'], 9).events);
  });
});
