/**
 * Trio (SET-style) game engine: framework-agnostic, dependency-free, host-authoritative.
 *
 * Plain erasable TypeScript: runs under Node 24 type stripping and in any bundler.
 * No imports, no enums/namespaces/parameter properties. Pure: no clock (time is always passed in
 * as `now`, in ms) and no randomness except the RNG you inject into newGame().
 *
 * ── CARDS ────────────────────────────────────────────────────────────────────────────────────
 *   A card is an integer id 0..80. Its base-3 digits are the four features (each 0..2):
 *       id = shape*27 + color*9 + number*3 + shading
 *   This is the id layout both legacy Angular apps generated, so old ids stay valid.
 *       shape   0 diamond | 1 squiggle | 2 oval
 *       color   0 red     | 1 green    | 2 purple
 *       number  0 → 1     | 1 → 2      | 2 → 3
 *       shading 0 solid   | 1 striped  | 2 open
 *   Three distinct cards form a set iff, per feature, the values are all equal or all different,
 *   i.e. iff each feature's three values sum to 0 mod 3 (equivalently c === thirdCard(a, b)).
 *
 * ── MODES ────────────────────────────────────────────────────────────────────────────────────
 *   Both modes use the same CALL / LOCK flow: callSet() first, then claim() before the deadline.
 *   train   Solo practice of reaction time. No score: found sets go to the pile, wrong picks
 *           count as `mistakes`, expired calls as `timeouts`. config.callMs may be null (or 0)
 *           for no time limit after calling. Hints via useHint().
 *   versus  Online, N players (the app caps it at 2), host-authoritative. Scored, see SCORING.
 *
 * ── SCORING (versus) ─────────────────────────────────────────────────────────────────────────
 *   Found set: +config.setPoints (default 3).
 *   Failure (wrong pick or call timeout): −penalty.full (default 3) if the score is ≥ penalty.full,
 *   otherwise −penalty.partial (default 1). No floor: scores can go negative.
 *       0 → +3 → 3 → wrong −3 → 0 → wrong −1 → −1 → timeout −1 → −2 → +3 → 1
 *   The pile keeps every set found; a penalty never removes cards.
 *
 * ── STATE ────────────────────────────────────────────────────────────────────────────────────
 *   GameState is plain JSON and is never mutated: every function returns a new object, or the
 *   same object when nothing changed.
 *     mode, config  { callMs = 5000, setPoints = 3, penalty = {full: 3, partial: 1},
 *                     cooldownMs = 0, maxAttempts = 100 }
 *     startedAt     the `now` given to newGame
 *     deck          HOST ONLY. deck[0] is the top card.
 *     board         dense array of slots; board[i] is the card in slot i. Slots never reflow.
 *     players       seat order: { id, score, pile, foundAt, mistakes, timeouts, hints,
 *                                 cooldownUntil, attempts }
 *                     pile      card ids taken, 3 per set, never shrinks
 *                     foundAt   `now` of each found set; foundAt[i] ↔ pile[3i..3i+2]
 *                     attempts  last config.maxAttempts calls, oldest first:
 *                               { calledAt, resolvedAt, result: found|wrong|timeout, cards?, hinted? }
 *     lock          null, or { playerId, calledAt, deadline } while someone holds a call.
 *                   deadline is null when there is no time limit (train, callMs null).
 *     seq           +1 per state-changing transition. Guests use it to spot a missed update.
 *     over          true once the board has no set and the deck is empty.
 *   publicView(state) is what the host sends to guests: everything except the deck order
 *   (deckCount only), including the lock so other phones can freeze and show the countdown.
 *
 * ── ACTIONS ──────────────────────────────────────────────────────────────────────────────────
 *   newGame(players, rng, { mode, now, config, deck })   → { state, events }
 *   callSet(state, playerId, now)                        → 'called'|'locked'|'cooldown'|'gameOver'|'invalid'
 *   claim(state, playerId, [a,b,c], now, { hinted? })    → 'found'|'wrong'|'stale'|'locked'|'noCall'|'gameOver'|'invalid'
 *   expire(state, now)                                   → 'expired'|'none'      (host timer)
 *   dealMore(state, now?)                                → 'dealt'|'locked'|'deckEmpty'|'boardFull'|'gameOver'
 *   useHint(state, playerId, now)                        → 'hint'|'none'|'gameOver'|'invalid', plus `card`
 *   applyAction(state, action, now)                      → dispatches a JSON action (call|claim|hint|dealMore)
 *   The host applies actions one at a time, in arrival order. That is what makes the first call win.
 *
 * ── CALL / LOCK ──────────────────────────────────────────────────────────────────────────────
 *   - callSet: if nobody holds the lock, the game is on and the caller is not cooling down, the
 *     caller gets { playerId, calledAt: now, deadline: now + callMs (or null) }. A second call
 *     from the holder is a no-op.
 *   - While the lock is held, anyone else's call or claim is rejected with a 'locked' event, no
 *     penalty. dealMore is refused too: the board is frozen.
 *   - claim without the lock → 'noCall' (no change). The holder's claim resolves the lock:
 *     found or wrong (see SCORING). A stale claim (card not on the board) keeps the lock and costs
 *     nothing, so the holder can re-pick before the deadline.
 *   - Deadline passed (now ≥ deadline): the holder pays a failure and the lock clears ('timeout').
 *     The host should call expire() from a timer, but every action that takes `now` expires a
 *     dead lock first, so correctness never depends on timer jitter. The host's clock at arrival
 *     is the judge; give callMs some slack for latency.
 *   - cooldownMs (versus, default 0 = off): after a wrong claim or a timeout, that player cannot
 *     call until cooldownUntil (wrong: now + cooldownMs; timeout: deadline + cooldownMs).
 *   - Every resolved call is recorded in the player's attempts (capped). playerStats() derives
 *     pickMs = resolvedAt − calledAt and gapMs = calledAt − previous resolvedAt (startedAt for
 *     the first). A timeout resolves at its deadline. The UI subtracts its own animation time.
 *
 * ── DEALING RULES (both modes) ───────────────────────────────────────────────────────────────
 *   - Deal 12 face up.
 *   - After a found set: board had ≤ 12 cards and the deck is not empty → deal into the same
 *     three slots; otherwise (board > 12, or deck empty) → compact: the last cards move into
 *     the holes, nothing else moves.
 *   - After every change: while the board has no set and the deck is not empty, deal 3 more at
 *     the end (autoDeal). 21 cards always contain a set, so this stops at 21.
 *   - dealMore(): the old "Add another row". Deals 3 at the end; refused when locked, when the
 *     deck is empty, or when the board already holds MAX_BOARD (21) cards.
 *   - Game over: no set on the board and the deck is empty. Winners = everyone with the top score.
 *
 * ── EVENTS ───────────────────────────────────────────────────────────────────────────────────
 *   Every transition returns events in the order a UI should animate them. Folding them with
 *   applyEvent() over the previous publicView() lands exactly on the next publicView() (seq aside:
 *   take it from the host message), so a guest can animate step by step and never drift.
 *   Events marked (cue) change nothing; they exist so a phone can give feedback.
 *
 *   newGame    { mode, config, players, deckCount, startedAt }
 *              Reset: empty board, a face-down deck pile of deckCount cards, all scores 0.
 *   deal       { card, slot, deckCount }
 *              Top card leaves the deck pile face down, lands in `slot`, flips to show `card`.
 *              deckCount = cards left after this deal. slot may be board.length (append).
 *   call       { playerId, calledAt, deadline }   playerId holds the lock: freeze, show countdown.
 *   locked     { playerId, holder, deadline }     (cue) playerId's call/claim refused: holder has it.
 *   cooldown   { playerId, until }                (cue) playerId's call refused until `until`.
 *   timeout    { playerId, calledAt, at, penalty, score, cooldownUntil }
 *              Lock expired at `at` (its deadline), penalty paid, unfreeze.
 *   retire     { playerId, cards, slots, score, calledAt, at, hinted? }
 *              Found set: cards[i] flies from slots[i] to playerId's pile (sorted by slot). The
 *              slots stay empty until a later deal or move fills them. Releases the lock.
 *   move       { card, from, to }
 *              Compaction: `card` slides from slot `from` into empty slot `to`. Trailing empty
 *              slots disappear.
 *   wrong      { playerId, cards, slots, penalty, score, cooldownUntil, calledAt, at, hinted? }
 *              Not a set: shake those slots. penalty = points lost (0 in train). Releases the lock.
 *   stale      { playerId, cards, missing }       (cue) `missing` already left the board.
 *   hint       { playerId, card }                 `card` belongs to a set on the board; hints +1.
 *   autoDeal   { count }                          (cue) No set: `count` deal events follow.
 *   manualDeal { count }                          (cue) dealMore(): `count` deal events follow.
 *   gameOver   { scores, winners }                Always last. scores: playerId → score.
 *
 *   Orders (a leading `timeout` appears when an action found an expired lock):
 *     newGame   newGame, deal×12, (autoDeal, deal×3)*, gameOver?
 *     found     retire, (deal×3 into the same slots | move×0..3), (autoDeal, deal×3)*, gameOver?
 *     wrong     wrong
 *     call      timeout?, (call | locked | cooldown)
 *     hint      timeout?, hint
 *     dealMore  timeout?, manualDeal, deal×3
 */

// ── Cards ────────────────────────────────────────────────────────────────────────────────────

export type CardId = number;
/** Three card ids, or three slot indexes. */
export type Triple = readonly [number, number, number];
/** Returns a float in [0, 1), like Math.random. */
export type Rng = () => number;

export const DECK_SIZE = 81;
export const BOARD_SIZE = 12;
export const DEAL_COUNT = 3;
/** 21 cards always contain a set (the largest set-free hand has 20), so the board never needs more. */
export const MAX_BOARD = 21;

export const SHAPES = ['diamond', 'squiggle', 'oval'] as const;
export const COLORS = ['red', 'green', 'purple'] as const;
export const NUMBERS = [1, 2, 3] as const;
export const SHADINGS = ['solid', 'striped', 'open'] as const;

export type Shape = (typeof SHAPES)[number];
export type Color = (typeof COLORS)[number];
export type CardNumber = (typeof NUMBERS)[number];
export type Shading = (typeof SHADINGS)[number];

/** Each feature is a value index 0..2 into SHAPES, COLORS, NUMBERS, SHADINGS. */
export interface CardFeatures {
  readonly shape: number;
  readonly color: number;
  readonly number: number;
  readonly shading: number;
}

export interface CardNames {
  readonly shape: Shape;
  readonly color: Color;
  readonly number: CardNumber;
  readonly shading: Shading;
}

export function isCardId(value: unknown): value is CardId {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < DECK_SIZE;
}

function assertCardId(value: unknown): asserts value is CardId {
  if (!isCardId(value)) throw new RangeError(`not a card id (0..80): ${String(value)}`);
}

export function decodeCard(id: CardId): CardFeatures {
  assertCardId(id);
  return {
    shape: Math.floor(id / 27),
    color: Math.floor(id / 9) % 3,
    number: Math.floor(id / 3) % 3,
    shading: id % 3,
  };
}

export function encodeCard(features: CardFeatures): CardId {
  const { shape, color, number, shading } = features;
  for (const v of [shape, color, number, shading]) {
    if (!(Number.isInteger(v) && v >= 0 && v <= 2)) throw new RangeError(`feature value must be 0..2: ${v}`);
  }
  return shape * 27 + color * 9 + number * 3 + shading;
}

export function cardNames(id: CardId): CardNames {
  const f = decodeCard(id);
  return { shape: SHAPES[f.shape], color: COLORS[f.color], number: NUMBERS[f.number], shading: SHADINGS[f.shading] };
}

/** "2 green striped squiggles": handy for aria-labels. */
export function cardLabel(id: CardId): string {
  const n = cardNames(id);
  return `${n.number} ${n.color} ${n.shading} ${n.shape}${n.number > 1 ? 's' : ''}`;
}

/** All 81 ids in order 0..80. */
export function fullDeck(): CardId[] {
  return Array.from({ length: DECK_SIZE }, (_, i) => i);
}

/** Unchecked: per base-3 digit, the value that makes the three sum to 0 mod 3. */
function third(a: number, b: number): number {
  let c = 0;
  for (let place = 1; place < DECK_SIZE; place *= 3) {
    const da = Math.floor(a / place) % 3;
    const db = Math.floor(b / place) % 3;
    c += ((6 - da - db) % 3) * place;
  }
  return c;
}

/** The one card that completes a set with two different cards a and b. */
export function thirdCard(a: CardId, b: CardId): CardId {
  assertCardId(a);
  assertCardId(b);
  if (a === b) throw new RangeError('thirdCard needs two different cards');
  return third(a, b);
}

/** True iff a, b, c are three distinct valid cards forming a set. Never throws. */
export function isSet(a: CardId, b: CardId, c: CardId): boolean {
  if (!isCardId(a) || !isCardId(b) || !isCardId(c)) return false;
  if (a === b || a === c || b === c) return false;
  return third(a, b) === c;
}

/** card id → slot. Empty slots (null) are skipped; invalid or duplicate ids throw. */
function slotIndex(board: readonly (CardId | null)[]): Map<CardId, number> {
  const index = new Map<CardId, number>();
  board.forEach((id, slot) => {
    if (id == null) return;
    assertCardId(id);
    if (index.has(id)) throw new RangeError(`card ${id} is on the board twice`);
    index.set(id, slot);
  });
  return index;
}

/**
 * Every set on the board, each once, as [a, b, c] in board order (slot of a < b < c).
 * O(n²): for each pair, look up the third card. Empty (null) slots are ignored.
 */
export function findSets(board: readonly (CardId | null)[]): Triple[] {
  const index = slotIndex(board);
  const sets: Triple[] = [];
  for (let i = 0; i < board.length; i++) {
    const a = board[i];
    if (a == null) continue;
    for (let j = i + 1; j < board.length; j++) {
      const b = board[j];
      if (b == null) continue;
      const c = third(a, b);
      const k = index.get(c);
      if (k !== undefined && k > j) sets.push([a, b, c]);
    }
  }
  return sets;
}

/** Like findSets(board).length > 0, but stops at the first set. */
export function hasSet(board: readonly (CardId | null)[]): boolean {
  const index = slotIndex(board);
  for (let i = 0; i < board.length; i++) {
    const a = board[i];
    if (a == null) continue;
    for (let j = i + 1; j < board.length; j++) {
      const b = board[j];
      if (b == null) continue;
      const k = index.get(third(a, b));
      if (k !== undefined && k > j) return true;
    }
  }
  return false;
}

// ── Randomness ───────────────────────────────────────────────────────────────────────────────

/** Fisher–Yates (Durstenfeld). Returns a new array; the input is untouched. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const r = rng();
    if (!(r >= 0 && r < 1)) throw new RangeError(`rng() must return a number in [0, 1), got ${r}`);
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Small seeded PRNG (mulberry32) for tests, replays and reproducible games. Not for security. */
export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── State, events, results ───────────────────────────────────────────────────────────────────

export type Mode = 'train' | 'versus';

export interface PenaltyConfig {
  /** Charged when the player's score is ≥ full. */
  readonly full: number;
  /** Charged otherwise (score below `full`, including 0 and negative scores). */
  readonly partial: number;
}

export interface GameConfig {
  /** How long the caller has to claim, in ms. null = no time limit (train only). */
  readonly callMs: number | null;
  /** versus: points for a found set. */
  readonly setPoints: number;
  /** versus: points lost for a wrong pick or a timeout. No floor. */
  readonly penalty: PenaltyConfig;
  /** versus: after a wrong claim or timeout, that player can't call for this long. 0 = off. */
  readonly cooldownMs: number;
  /** Attempt records kept per player; the oldest are dropped first. */
  readonly maxAttempts: number;
}

export const DEFAULT_CONFIG: GameConfig = Object.freeze({
  callMs: 5000,
  setPoints: 3,
  penalty: Object.freeze({ full: 3, partial: 1 }),
  cooldownMs: 0,
  maxAttempts: 100,
});

/** Overrides for DEFAULT_CONFIG. callMs 0 means the same as null (no limit, train only). */
export interface GameConfigInput {
  readonly callMs?: number | null;
  readonly setPoints?: number;
  readonly penalty?: Partial<PenaltyConfig>;
  readonly cooldownMs?: number;
  readonly maxAttempts?: number;
}

export interface CallLock {
  readonly playerId: string;
  readonly calledAt: number;
  /** Lock expires when now >= deadline. null: no time limit. */
  readonly deadline: number | null;
}

export type AttemptResult = 'found' | 'wrong' | 'timeout';

/** One resolved call. */
export interface Attempt {
  readonly calledAt: number;
  /** When the claim landed, or the deadline for a timeout. */
  readonly resolvedAt: number;
  readonly result: AttemptResult;
  /** The claimed cards, sorted by slot. Absent for a timeout. */
  readonly cards?: Triple;
  /** Present when the claim was flagged as made with a hint. */
  readonly hinted?: true;
}

export interface PlayerState {
  readonly id: string;
  /** versus: sets × setPoints minus penalties, can be negative. train: always 0. */
  readonly score: number;
  /** Card ids taken, 3 per found set, in the order taken. Never shrinks. */
  readonly pile: readonly CardId[];
  /** `now` of each found set; foundAt[i] belongs to pile[3i..3i+2]. */
  readonly foundAt: readonly number[];
  /** Wrong claims. */
  readonly mistakes: number;
  /** Calls that expired. */
  readonly timeouts: number;
  /** useHint() calls that returned a card. */
  readonly hints: number;
  /** versus: can't call while now < cooldownUntil. 0 when never set. */
  readonly cooldownUntil: number;
  /** The last config.maxAttempts resolved calls, oldest first. */
  readonly attempts: readonly Attempt[];
}

export interface GameState {
  readonly schema: 2;
  readonly seq: number;
  readonly mode: Mode;
  readonly config: GameConfig;
  readonly startedAt: number;
  /** HOST ONLY. deck[0] is the top card. */
  readonly deck: readonly CardId[];
  readonly board: readonly CardId[];
  readonly players: readonly PlayerState[];
  readonly lock: CallLock | null;
  readonly over: boolean;
}

export interface PublicView {
  readonly schema: 2;
  readonly seq: number;
  readonly mode: Mode;
  readonly config: GameConfig;
  readonly startedAt: number;
  readonly deckCount: number;
  /** null marks an empty slot; it only appears in views produced mid-replay by applyEvent. */
  readonly board: readonly (CardId | null)[];
  readonly players: readonly PlayerState[];
  readonly lock: CallLock | null;
  readonly over: boolean;
}

export type GameEvent =
  | {
      readonly type: 'newGame';
      readonly mode: Mode;
      readonly config: GameConfig;
      readonly players: readonly string[];
      readonly deckCount: number;
      readonly startedAt: number;
    }
  | { readonly type: 'deal'; readonly card: CardId; readonly slot: number; readonly deckCount: number }
  | { readonly type: 'call'; readonly playerId: string; readonly calledAt: number; readonly deadline: number | null }
  | { readonly type: 'locked'; readonly playerId: string; readonly holder: string; readonly deadline: number | null }
  | { readonly type: 'cooldown'; readonly playerId: string; readonly until: number }
  | {
      readonly type: 'timeout';
      readonly playerId: string;
      readonly calledAt: number;
      readonly at: number;
      readonly penalty: number;
      readonly score: number;
      readonly cooldownUntil: number;
    }
  | {
      readonly type: 'retire';
      readonly playerId: string;
      readonly cards: Triple;
      readonly slots: Triple;
      readonly score: number;
      readonly calledAt: number;
      readonly at: number;
      readonly hinted?: true;
    }
  | { readonly type: 'move'; readonly card: CardId; readonly from: number; readonly to: number }
  | {
      readonly type: 'wrong';
      readonly playerId: string;
      readonly cards: Triple;
      readonly slots: Triple;
      readonly penalty: number;
      readonly score: number;
      readonly cooldownUntil: number;
      readonly calledAt: number;
      readonly at: number;
      readonly hinted?: true;
    }
  | { readonly type: 'stale'; readonly playerId: string; readonly cards: Triple; readonly missing: readonly CardId[] }
  | { readonly type: 'hint'; readonly playerId: string; readonly card: CardId }
  | { readonly type: 'autoDeal'; readonly count: number }
  | { readonly type: 'manualDeal'; readonly count: number }
  | { readonly type: 'gameOver'; readonly scores: Readonly<Record<string, number>>; readonly winners: readonly string[] };

export type GameEventType = GameEvent['type'];

export type CallResult = 'called' | 'locked' | 'cooldown' | 'gameOver' | 'invalid';
export type ClaimResult = 'found' | 'wrong' | 'stale' | 'locked' | 'noCall' | 'gameOver' | 'invalid';
export type DealResult = 'dealt' | 'locked' | 'deckEmpty' | 'boardFull' | 'gameOver';
export type ExpireResult = 'expired' | 'none';
export type HintResult = 'hint' | 'none' | 'gameOver' | 'invalid';

export interface Step {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}
export interface ResultStep<R> extends Step {
  readonly result: R;
}
export type CallStep = ResultStep<CallResult>;
export type ClaimStep = ResultStep<ClaimResult>;
export type DealStep = ResultStep<DealResult>;
export type ExpireStep = ResultStep<ExpireResult>;
export interface HintStep extends ResultStep<HintResult> {
  /** A card of a set on the board, or null when there is none to give. */
  readonly card: CardId | null;
}
export type ActionStep = ResultStep<CallResult | ClaimResult | DealResult | HintResult>;

export interface ClaimOptions {
  /** The player saw a hint for this pick. Recorded on the attempt and the event. */
  readonly hinted?: boolean;
}

/** A JSON action (a guest's message, or the local player's input). The host supplies `now`. */
export type Action =
  | { readonly type: 'call'; readonly playerId: string }
  | { readonly type: 'claim'; readonly playerId: string; readonly cards: readonly CardId[]; readonly hinted?: boolean }
  | { readonly type: 'hint'; readonly playerId: string }
  | { readonly type: 'dealMore' };

export interface NewGameOptions {
  /** Default 'versus'. */
  readonly mode?: Mode;
  /** Start time in ms (for time-per-set stats). Default 0. */
  readonly now?: number;
  /** Overrides for DEFAULT_CONFIG. */
  readonly config?: GameConfigInput;
  /**
   * Use this exact deck order instead of shuffling (deck[0] is dealt first). Distinct card ids;
   * may be shorter than 81. For tests, replays and puzzles.
   */
  readonly deck?: readonly CardId[];
}

// Mutable working copy used inside one transition. A Draft is a valid GameState.
interface DraftPlayer {
  id: string;
  score: number;
  pile: CardId[];
  foundAt: number[];
  mistakes: number;
  timeouts: number;
  hints: number;
  cooldownUntil: number;
  attempts: Attempt[];
}
interface Draft {
  schema: 2;
  seq: number;
  mode: Mode;
  config: GameConfig;
  startedAt: number;
  deck: CardId[];
  board: CardId[];
  players: DraftPlayer[];
  lock: CallLock | null;
  over: boolean;
}

function copyPlayer(p: PlayerState): DraftPlayer {
  return {
    id: p.id,
    score: p.score,
    pile: p.pile.slice(),
    foundAt: p.foundAt.slice(),
    mistakes: p.mistakes,
    timeouts: p.timeouts,
    hints: p.hints,
    cooldownUntil: p.cooldownUntil,
    attempts: p.attempts.slice(),
  };
}

function freshPlayer(id: string): DraftPlayer {
  return { id, score: 0, pile: [], foundAt: [], mistakes: 0, timeouts: 0, hints: 0, cooldownUntil: 0, attempts: [] };
}

function copyConfig(config: GameConfig): GameConfig {
  return { ...config, penalty: { ...config.penalty } };
}

function draft(state: GameState): Draft {
  return {
    schema: 2,
    seq: state.seq,
    mode: state.mode,
    config: copyConfig(state.config),
    startedAt: state.startedAt,
    deck: state.deck.slice(),
    board: state.board.slice(),
    players: state.players.map(copyPlayer),
    lock: state.lock === null ? null : { ...state.lock },
    over: state.over,
  };
}

const CUE_EVENTS: ReadonlySet<GameEventType> = new Set<GameEventType>(['stale', 'locked', 'cooldown']);

/** True for events that change nothing (feedback only). */
export function isCue(event: GameEvent): boolean {
  return CUE_EVENTS.has(event.type);
}

/**
 * Close a transition. If only cue events were produced, nothing changed: return the original
 * state object (same reference, same seq). Otherwise bump seq exactly once.
 */
function finish<R>(state: GameState, d: Draft, events: GameEvent[], result: R): ResultStep<R> {
  if (!events.some((e) => !isCue(e))) return { state, events, result };
  d.seq = state.seq + 1;
  return { state: d, events, result };
}

function dealTo(d: Draft, slot: number, events: GameEvent[]): void {
  const card = d.deck.shift();
  if (card === undefined) throw new Error('internal: dealing from an empty deck');
  d.board[slot] = card;
  events.push({ type: 'deal', card, slot, deckCount: d.deck.length });
}

function dealRow(d: Draft, events: GameEvent[], reason: 'autoDeal' | 'manualDeal'): void {
  const count = Math.min(DEAL_COUNT, d.deck.length);
  events.push(reason === 'autoDeal' ? { type: 'autoDeal', count } : { type: 'manualDeal', count });
  for (let i = 0; i < count; i++) dealTo(d, d.board.length, events);
}

/** Fill holes below the new board size with the last cards, in slot order, then truncate. */
function compact(d: Draft, holes: readonly number[], events: GameEvent[]): void {
  if (holes.length === 0) return;
  const size = d.board.length - holes.length;
  const empty = new Set(holes);
  const targets = holes.filter((slot) => slot < size).sort((x, y) => x - y);
  let from = size;
  for (const to of targets) {
    while (empty.has(from)) from++;
    const card = d.board[from];
    d.board[to] = card;
    events.push({ type: 'move', card, from, to });
    from++;
  }
  d.board.length = size;
}

function gameOverEvent(players: readonly PlayerState[]): GameEvent {
  const top = Math.max(...players.map((p) => p.score));
  return {
    type: 'gameOver',
    scores: Object.fromEntries(players.map((p) => [p.id, p.score])),
    winners: players.filter((p) => p.score === top).map((p) => p.id),
  };
}

/** Restore the invariant "the board has a set, or the game is over". */
function settle(d: Draft, events: GameEvent[]): void {
  while (d.deck.length > 0 && !hasSet(d.board)) dealRow(d, events, 'autoDeal');
  if (!hasSet(d.board)) {
    d.over = true;
    d.lock = null;
    events.push(gameOverEvent(d.players));
  }
}

/** The penalty a failure costs at `score` in versus (train has no score: 0). */
export function penaltyFor(mode: Mode, config: GameConfig, score: number): number {
  if (mode !== 'versus') return 0;
  return score >= config.penalty.full ? config.penalty.full : config.penalty.partial;
}

/** Charge a failure. No floor. Returns the points lost. */
function penalize(p: DraftPlayer, d: Draft): number {
  const lost = penaltyFor(d.mode, d.config, p.score);
  p.score -= lost;
  return lost;
}

/** Append, dropping the oldest records beyond `cap`. Returns a new array. */
function withAttempt(attempts: readonly Attempt[], attempt: Attempt, cap: number): Attempt[] {
  const next = [...attempts, attempt];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

function makeAttempt(calledAt: number, resolvedAt: number, result: AttemptResult, cards?: Triple, hinted?: boolean): Attempt {
  const attempt: { -readonly [K in keyof Attempt]: Attempt[K] } = { calledAt, resolvedAt, result };
  if (cards !== undefined) attempt.cards = [cards[0], cards[1], cards[2]];
  if (hinted === true) attempt.hinted = true;
  return attempt;
}

/** If the lock's deadline has passed, the holder pays a failure and the lock clears. */
function expireLock(d: Draft, now: number, events: GameEvent[]): boolean {
  const lock = d.lock;
  if (lock === null || lock.deadline === null || now < lock.deadline) return false;
  const deadline = lock.deadline;
  const holder = d.players.find((p) => p.id === lock.playerId);
  if (holder === undefined) throw new Error(`internal: lock held by unknown player ${lock.playerId}`);
  d.lock = null;
  const penalty = penalize(holder, d);
  holder.timeouts += 1;
  if (d.mode === 'versus' && d.config.cooldownMs > 0) holder.cooldownUntil = deadline + d.config.cooldownMs;
  holder.attempts = withAttempt(holder.attempts, makeAttempt(lock.calledAt, deadline, 'timeout'), d.config.maxAttempts);
  events.push({
    type: 'timeout',
    playerId: holder.id,
    calledAt: lock.calledAt,
    at: deadline,
    penalty,
    score: holder.score,
    cooldownUntil: holder.cooldownUntil,
  });
  return true;
}

function isTriple(cards: unknown): cards is Triple {
  return Array.isArray(cards) && cards.length === 3 && cards.every(isCardId) && new Set(cards).size === 3;
}

function assertTime(now: unknown): asserts now is number {
  if (typeof now !== 'number' || !Number.isFinite(now)) throw new TypeError(`now must be a finite number of ms: ${String(now)}`);
}

function assertPlayers(players: readonly string[]): void {
  if (!Array.isArray(players) || players.length === 0) throw new RangeError('newGame needs at least one player id');
  for (const id of players) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError(`player id must be a non-empty string: ${String(id)}`);
  }
  if (new Set(players).size !== players.length) throw new RangeError('player ids must be distinct');
}

function isCount(value: number, min: number): boolean {
  return Number.isInteger(value) && value >= min;
}

export function resolveConfig(mode: Mode, overrides: GameConfigInput = {}): GameConfig {
  const rawCallMs = overrides.callMs === undefined ? DEFAULT_CONFIG.callMs : overrides.callMs;
  const config: GameConfig = {
    callMs: rawCallMs === 0 ? null : rawCallMs,
    setPoints: overrides.setPoints ?? DEFAULT_CONFIG.setPoints,
    penalty: {
      full: overrides.penalty?.full ?? DEFAULT_CONFIG.penalty.full,
      partial: overrides.penalty?.partial ?? DEFAULT_CONFIG.penalty.partial,
    },
    cooldownMs: overrides.cooldownMs ?? DEFAULT_CONFIG.cooldownMs,
    maxAttempts: overrides.maxAttempts ?? DEFAULT_CONFIG.maxAttempts,
  };
  if (config.callMs === null) {
    if (mode === 'versus') throw new RangeError('config.callMs: versus needs a time limit');
  } else if (!(Number.isFinite(config.callMs) && config.callMs > 0)) {
    throw new RangeError(`config.callMs must be > 0, or null/0 for no limit: ${config.callMs}`);
  }
  if (!isCount(config.setPoints, 0)) throw new RangeError(`config.setPoints must be an integer ≥ 0: ${config.setPoints}`);
  if (!isCount(config.penalty.full, 0) || !isCount(config.penalty.partial, 0)) {
    throw new RangeError(`config.penalty values must be integers ≥ 0: ${JSON.stringify(config.penalty)}`);
  }
  if (!(Number.isFinite(config.cooldownMs) && config.cooldownMs >= 0)) {
    throw new RangeError(`config.cooldownMs must be ≥ 0: ${config.cooldownMs}`);
  }
  if (!isCount(config.maxAttempts, 1)) throw new RangeError(`config.maxAttempts must be an integer ≥ 1: ${config.maxAttempts}`);
  return config;
}

function checkedDeck(deck: readonly CardId[]): CardId[] {
  if (!Array.isArray(deck)) throw new TypeError('options.deck must be an array of card ids');
  for (const id of deck) assertCardId(id);
  if (new Set(deck).size !== deck.length) throw new RangeError('options.deck has duplicate cards');
  return deck.slice();
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────────

export function newGame(players: readonly string[], rng: Rng = Math.random, options: NewGameOptions = {}): Step {
  assertPlayers(players);
  const mode = options.mode ?? 'versus';
  if (mode !== 'train' && mode !== 'versus') throw new RangeError(`unknown mode: ${String(mode)}`);
  const now = options.now ?? 0;
  assertTime(now);
  const config = resolveConfig(mode, options.config);
  const deck = options.deck === undefined ? shuffle(fullDeck(), rng) : checkedDeck(options.deck);
  const d: Draft = {
    schema: 2,
    seq: 0,
    mode,
    config,
    startedAt: now,
    deck,
    board: [],
    players: players.map((id) => freshPlayer(id)),
    lock: null,
    over: false,
  };
  const events: GameEvent[] = [
    { type: 'newGame', mode, config: copyConfig(config), players: players.slice(), deckCount: deck.length, startedAt: now },
  ];
  while (d.board.length < BOARD_SIZE && d.deck.length > 0) dealTo(d, d.board.length, events);
  settle(d, events);
  return { state: d, events };
}

/** Ask for the lock. First caller wins; the host must apply calls in arrival order. */
export function callSet(state: GameState, playerId: string, now: number): CallStep {
  assertTime(now);
  const seat = state.players.findIndex((p) => p.id === playerId);
  if (seat < 0) return { state, events: [], result: 'invalid' };
  const d = draft(state);
  const events: GameEvent[] = [];
  expireLock(d, now, events);
  return finish(state, d, events, callOn(d, d.players[seat], now, events));
}

function callOn(d: Draft, player: DraftPlayer, now: number, events: GameEvent[]): CallResult {
  if (d.over) return 'gameOver';
  const lock = d.lock;
  if (lock !== null) {
    if (lock.playerId === player.id) return 'called'; // double tap: no-op, deadline unchanged
    events.push({ type: 'locked', playerId: player.id, holder: lock.playerId, deadline: lock.deadline });
    return 'locked';
  }
  if (now < player.cooldownUntil) {
    events.push({ type: 'cooldown', playerId: player.id, until: player.cooldownUntil });
    return 'cooldown';
  }
  const deadline = d.config.callMs === null ? null : now + d.config.callMs;
  d.lock = { playerId: player.id, calledAt: now, deadline };
  events.push({ type: 'call', playerId: player.id, calledAt: now, deadline });
  return 'called';
}

/** Claim three cards. Only the lock holder, before the deadline (both modes). */
export function claim(state: GameState, playerId: string, cards: readonly CardId[], now: number, options: ClaimOptions = {}): ClaimStep {
  assertTime(now);
  const seat = state.players.findIndex((p) => p.id === playerId);
  if (seat < 0 || !isTriple(cards)) return { state, events: [], result: 'invalid' };
  const d = draft(state);
  const events: GameEvent[] = [];
  expireLock(d, now, events);
  return finish(state, d, events, claimOn(d, d.players[seat], cards, now, options.hinted === true, events));
}

function claimOn(d: Draft, player: DraftPlayer, cards: Triple, now: number, hinted: boolean, events: GameEvent[]): ClaimResult {
  if (d.over) return 'gameOver';
  const lock = d.lock;
  if (lock === null) return 'noCall';
  if (lock.playerId !== player.id) {
    events.push({ type: 'locked', playerId: player.id, holder: lock.playerId, deadline: lock.deadline });
    return 'locked';
  }

  const onBoard = slotIndex(d.board);
  const missing = cards.filter((c) => !onBoard.has(c));
  if (missing.length > 0) {
    events.push({ type: 'stale', playerId: player.id, cards: [cards[0], cards[1], cards[2]], missing });
    return 'stale'; // the lock is kept
  }

  const placed = cards.map((card) => ({ card, slot: onBoard.get(card) ?? -1 })).sort((x, y) => x.slot - y.slot);
  const trio: Triple = [placed[0].card, placed[1].card, placed[2].card];
  const slots: Triple = [placed[0].slot, placed[1].slot, placed[2].slot];
  const calledAt = lock.calledAt;
  const flag: { hinted?: true } = hinted ? { hinted: true } : {};
  d.lock = null;

  if (!isSet(trio[0], trio[1], trio[2])) {
    const penalty = penalize(player, d);
    player.mistakes += 1;
    if (d.mode === 'versus' && d.config.cooldownMs > 0) player.cooldownUntil = now + d.config.cooldownMs;
    player.attempts = withAttempt(player.attempts, makeAttempt(calledAt, now, 'wrong', trio, hinted), d.config.maxAttempts);
    events.push({
      type: 'wrong',
      playerId: player.id,
      cards: trio,
      slots,
      penalty,
      score: player.score,
      cooldownUntil: player.cooldownUntil,
      calledAt,
      at: now,
      ...flag,
    });
    return 'wrong';
  }

  if (d.mode === 'versus') player.score += d.config.setPoints;
  player.pile.push(...trio);
  player.foundAt.push(now);
  player.attempts = withAttempt(player.attempts, makeAttempt(calledAt, now, 'found', trio, hinted), d.config.maxAttempts);
  events.push({ type: 'retire', playerId: player.id, cards: trio, slots, score: player.score, calledAt, at: now, ...flag });

  const holes = slots.slice();
  if (d.board.length <= BOARD_SIZE) {
    while (holes.length > 0 && d.deck.length > 0) dealTo(d, holes.shift() ?? -1, events);
  }
  compact(d, holes, events);
  settle(d, events);
  return 'found';
}

/** Call from a timer at lock.deadline. Clears an expired lock and charges the holder. */
export function expire(state: GameState, now: number): ExpireStep {
  assertTime(now);
  if (state.lock === null || state.lock.deadline === null || now < state.lock.deadline) {
    return { state, events: [], result: 'none' };
  }
  const d = draft(state);
  const events: GameEvent[] = [];
  expireLock(d, now, events);
  return finish(state, d, events, 'expired');
}

/** Deal 3 more at the end of the board (the old "Add another row"). Pass `now` to expire a dead lock. */
export function dealMore(state: GameState, now?: number): DealStep {
  const d = draft(state);
  const events: GameEvent[] = [];
  if (now !== undefined) {
    assertTime(now);
    expireLock(d, now, events);
  }
  return finish(state, d, events, dealOn(d, events));
}

function dealOn(d: Draft, events: GameEvent[]): DealResult {
  if (d.over) return 'gameOver';
  if (d.lock !== null) return 'locked';
  if (d.deck.length === 0) return 'deckEmpty';
  if (d.board.length >= MAX_BOARD) return 'boardFull';
  dealRow(d, events, 'manualDeal');
  settle(d, events);
  return 'dealt';
}

/**
 * Give `playerId` one card of a set on the board and count the hint. Allowed any time the game is
 * on, with or without a call. Whether hints are offered (train only, say) is the app's choice.
 */
export function useHint(state: GameState, playerId: string, now: number): HintStep {
  assertTime(now);
  const seat = state.players.findIndex((p) => p.id === playerId);
  if (seat < 0) return { state, events: [], result: 'invalid', card: null };
  const d = draft(state);
  const events: GameEvent[] = [];
  expireLock(d, now, events);
  if (d.over) return { ...finish(state, d, events, 'gameOver' as const), card: null };
  const set = findSets(d.board)[0];
  if (set === undefined) return { ...finish(state, d, events, 'none' as const), card: null };
  const player = d.players[seat];
  player.hints += 1;
  events.push({ type: 'hint', playerId: player.id, card: set[0] });
  return { ...finish(state, d, events, 'hint' as const), card: set[0] };
}

/** Dispatch a JSON action. Anything unrecognised is 'invalid' and changes nothing. */
export function applyAction(state: GameState, action: Action, now: number): ActionStep {
  if (action !== null && typeof action === 'object') {
    if (action.type === 'call') return callSet(state, action.playerId, now);
    if (action.type === 'claim') return claim(state, action.playerId, action.cards, now, { hinted: action.hinted === true });
    if (action.type === 'hint') return useHint(state, action.playerId, now);
    if (action.type === 'dealMore') return dealMore(state, now);
  }
  return { state, events: [], result: 'invalid' };
}

// ── Views and stats ──────────────────────────────────────────────────────────────────────────

/** What the host sends to guests: everything except the deck order. */
export function publicView(state: GameState): PublicView {
  return {
    schema: state.schema,
    seq: state.seq,
    mode: state.mode,
    config: copyConfig(state.config),
    startedAt: state.startedAt,
    deckCount: state.deck.length,
    board: state.board.slice(),
    players: state.players.map(copyPlayer),
    lock: state.lock === null ? null : { ...state.lock },
    over: state.over,
  };
}

function trimEmpty(board: (CardId | null)[]): (CardId | null)[] {
  while (board.length > 0 && board[board.length - 1] == null) board.pop();
  return board;
}

function updatePlayer(view: PublicView, playerId: string, change: (p: PlayerState) => PlayerState): PlayerState[] {
  return view.players.map((p) => (p.id === playerId ? change(p) : p));
}

/**
 * Apply one event to a view: the reference for what each event means. A guest can render
 * after every call (between animations). seq is not touched; take it from the host message.
 */
export function applyEvent(view: PublicView, event: GameEvent): PublicView {
  const cap = view.config.maxAttempts;
  switch (event.type) {
    case 'newGame':
      return {
        ...view,
        mode: event.mode,
        config: copyConfig(event.config),
        startedAt: event.startedAt,
        deckCount: event.deckCount,
        board: [],
        players: event.players.map((id) => freshPlayer(id)),
        lock: null,
        over: false,
      };
    case 'deal': {
      const board = view.board.slice();
      while (board.length < event.slot) board.push(null);
      board[event.slot] = event.card;
      return { ...view, deckCount: event.deckCount, board: trimEmpty(board) };
    }
    case 'call':
      return { ...view, lock: { playerId: event.playerId, calledAt: event.calledAt, deadline: event.deadline } };
    case 'timeout': {
      const players = updatePlayer(view, event.playerId, (p) => ({
        ...p,
        score: event.score,
        timeouts: p.timeouts + 1,
        cooldownUntil: event.cooldownUntil,
        attempts: withAttempt(p.attempts, makeAttempt(event.calledAt, event.at, 'timeout'), cap),
      }));
      return { ...view, players, lock: null };
    }
    case 'retire': {
      const board = view.board.slice();
      for (const slot of event.slots) board[slot] = null;
      const players = updatePlayer(view, event.playerId, (p) => ({
        ...p,
        score: event.score,
        pile: [...p.pile, ...event.cards],
        foundAt: [...p.foundAt, event.at],
        attempts: withAttempt(p.attempts, makeAttempt(event.calledAt, event.at, 'found', event.cards, event.hinted), cap),
      }));
      return { ...view, board: trimEmpty(board), players, lock: null };
    }
    case 'move': {
      const board = view.board.slice();
      board[event.to] = event.card;
      board[event.from] = null;
      return { ...view, board: trimEmpty(board) };
    }
    case 'wrong': {
      const players = updatePlayer(view, event.playerId, (p) => ({
        ...p,
        score: event.score,
        mistakes: p.mistakes + 1,
        cooldownUntil: event.cooldownUntil,
        attempts: withAttempt(p.attempts, makeAttempt(event.calledAt, event.at, 'wrong', event.cards, event.hinted), cap),
      }));
      return { ...view, players, lock: null };
    }
    case 'hint': {
      const players = updatePlayer(view, event.playerId, (p) => ({ ...p, hints: p.hints + 1 }));
      return { ...view, players };
    }
    case 'gameOver':
      return { ...view, over: true, lock: null };
    default:
      // stale, locked, cooldown, autoDeal, manualDeal: cues for the UI, no state of their own.
      return view;
  }
}

/** An attempt with its derived timings. */
export interface AttemptStats extends Attempt {
  /** resolvedAt − calledAt: from calling to the pick landing (or the deadline). */
  readonly pickMs: number;
  /**
   * calledAt − the previous attempt's resolvedAt (startedAt for the player's first call): how
   * long the player looked before calling. null for the oldest kept record when the cap dropped
   * earlier ones.
   */
  readonly gapMs: number | null;
}

export interface PlayerStats {
  readonly score: number;
  readonly setsFound: number;
  readonly mistakes: number;
  readonly timeouts: number;
  readonly hints: number;
  /** ms taken for each found set: from the start, then from this player's previous set. */
  readonly splits: readonly number[];
  /** The kept attempt records, oldest first, with pick time and gap. */
  readonly attempts: readonly AttemptStats[];
}

/** Stats for one player, from a GameState or a PublicView. undefined for an unknown id. */
export function playerStats(
  game: { readonly startedAt: number; readonly players: readonly PlayerState[] },
  playerId: string,
): PlayerStats | undefined {
  const p = game.players.find((x) => x.id === playerId);
  if (p === undefined) return undefined;
  const splits = p.foundAt.map((at, i) => at - (i === 0 ? game.startedAt : p.foundAt[i - 1]));
  const dropped = p.foundAt.length + p.mistakes + p.timeouts > p.attempts.length;
  const attempts = p.attempts.map((a, i): AttemptStats => {
    const prev = i === 0 ? (dropped ? null : game.startedAt) : p.attempts[i - 1].resolvedAt;
    return { ...a, pickMs: a.resolvedAt - a.calledAt, gapMs: prev === null ? null : a.calledAt - prev };
  });
  return {
    score: p.score,
    setsFound: p.foundAt.length,
    mistakes: p.mistakes,
    timeouts: p.timeouts,
    hints: p.hints,
    splits,
    attempts,
  };
}
