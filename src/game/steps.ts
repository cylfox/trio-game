/**
 * Turning engine events into animation steps, and deciding when to reconcile instead (pure).
 *
 * The game screen replays each change's events in order through one queue. Events are grouped
 * into steps that animate as a unit:
 *   newGame                     clear the table, reset piles and scores
 *   deals (initial)             the newGame's first deals: fly from the deck, flip
 *   deals (auto | manual)       autoDeal/manualDeal and the deals that follow: add a row, fly in
 *   found                       retire + the refill deals into the same slots, or compaction moves
 *   wrong | timeout             shake / stamp, score delta
 *   cue                         call, locked, cooldown, stale, hint: no card motion
 *   gameOver                    the end toast, then results
 *
 * A change that cannot be replayed (a snapshot on join or rejoin, a missed seq, a backlog while
 * the tab was hidden) is reconciled: diffBoard() says which cards stay, leave or appear, and the
 * table places them without flights.
 */
import type { CardId, GameEvent, PublicView } from '../lib/engine/engine.ts';

type Of<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>;

export type Step =
  | { readonly kind: 'newGame'; readonly event: Of<'newGame'> }
  | { readonly kind: 'deals'; readonly reason: 'initial' | 'auto' | 'manual'; readonly deals: readonly Of<'deal'>[] }
  | { readonly kind: 'found'; readonly retire: Of<'retire'>; readonly refill: readonly Of<'deal'>[]; readonly moves: readonly Of<'move'>[] }
  | { readonly kind: 'wrong'; readonly event: Of<'wrong'> }
  | { readonly kind: 'timeout'; readonly event: Of<'timeout'> }
  | { readonly kind: 'cue'; readonly event: Of<'call' | 'locked' | 'cooldown' | 'stale' | 'hint'> }
  | { readonly kind: 'gameOver'; readonly event: Of<'gameOver'> };

/** Group a change's events into steps, keeping their order. */
export function toSteps(events: readonly GameEvent[]): Step[] {
  const steps: Step[] = [];
  let i = 0;
  const takeDeals = (max = Infinity): Of<'deal'>[] => {
    const deals: Of<'deal'>[] = [];
    while (i < events.length && deals.length < max) {
      const e = events[i];
      if (e.type !== 'deal') break;
      deals.push(e);
      i++;
    }
    return deals;
  };
  while (i < events.length) {
    const e = events[i++];
    switch (e.type) {
      case 'newGame': {
        steps.push({ kind: 'newGame', event: e });
        const deals = takeDeals();
        if (deals.length > 0) steps.push({ kind: 'deals', reason: 'initial', deals });
        break;
      }
      case 'deal': {
        // A deal outside the usual groups (shouldn't happen): animate it like a manual deal.
        i--;
        steps.push({ kind: 'deals', reason: 'manual', deals: takeDeals() });
        break;
      }
      case 'autoDeal':
      case 'manualDeal':
        steps.push({ kind: 'deals', reason: e.type === 'autoDeal' ? 'auto' : 'manual', deals: takeDeals(e.count) });
        break;
      case 'retire': {
        const holes = new Set<number>(e.slots);
        const refill: Of<'deal'>[] = [];
        while (i < events.length) {
          const next = events[i];
          if (next.type !== 'deal' || !holes.has(next.slot)) break;
          holes.delete(next.slot);
          refill.push(next);
          i++;
        }
        const moves: Of<'move'>[] = [];
        while (i < events.length) {
          const next = events[i];
          if (next.type !== 'move') break;
          moves.push(next);
          i++;
        }
        steps.push({ kind: 'found', retire: e, refill, moves });
        break;
      }
      case 'move':
        // Moves only ever follow a retire (taken above). A stray one is skipped; the end-of-change
        // board check then reconciles the table.
        break;
      case 'wrong':
        steps.push({ kind: 'wrong', event: e });
        break;
      case 'timeout':
        steps.push({ kind: 'timeout', event: e });
        break;
      case 'gameOver':
        steps.push({ kind: 'gameOver', event: e });
        break;
      default:
        steps.push({ kind: 'cue', event: e });
    }
  }
  return steps;
}

/** True when a step moves cards on the table (the board is not "ready" while one runs). */
export function movesCards(step: Step): boolean {
  return step.kind === 'newGame' || step.kind === 'deals' || step.kind === 'found';
}

export interface ChangeLike {
  readonly kind: 'snapshot' | 'update';
  readonly contiguous: boolean;
  readonly events: readonly GameEvent[];
}

export type Plan = 'animate' | 'reconcile' | 'none';

/**
 * How to show a change.
 *   animate    replay the events (contiguous update with events, table in sync)
 *   reconcile  jump to the view without flights (snapshot, gap, backlog, hidden tab, unsynced)
 *   none       nothing changed on the table (a room-only update)
 * `shownSeq` is the seq the table currently shows (null: nothing shown yet). `viewSeq` is the
 * game seq of the incoming view. `backlog` is how many animated changes are still queued.
 */
export function planChange(change: ChangeLike, shownSeq: number | null, viewSeq: number | null, options: { hidden?: boolean; backlog?: number } = {}): Plan {
  if (viewSeq === null) return 'none';
  const replayable = change.kind === 'update' && change.contiguous;
  if (!replayable) return 'reconcile';
  if (change.events.length === 0) return shownSeq === viewSeq ? 'none' : 'reconcile';
  const startsGame = change.events[0].type === 'newGame';
  if (!startsGame && shownSeq === null) return 'reconcile';
  if (options.hidden === true || (options.backlog ?? 0) > 2) return 'reconcile';
  return 'animate';
}

export interface BoardDiff {
  /** Cards on the table that are no longer on the board. */
  readonly remove: readonly CardId[];
  /** Cards that stay, with their (possibly new) slot. */
  readonly keep: readonly { readonly card: CardId; readonly slot: number }[];
  /** Cards to create at a slot. */
  readonly add: readonly { readonly card: CardId; readonly slot: number }[];
}

/** What changes between the cards on the table and the target board. */
export function diffBoard(onTable: Iterable<CardId>, target: readonly (CardId | null)[]): BoardDiff {
  const present = new Set(onTable);
  const wanted = new Map<CardId, number>();
  target.forEach((card, slot) => {
    if (card !== null) wanted.set(card, slot);
  });
  const remove = [...present].filter((card) => !wanted.has(card));
  const keep: { card: CardId; slot: number }[] = [];
  const add: { card: CardId; slot: number }[] = [];
  for (const [card, slot] of wanted) (present.has(card) ? keep : add).push({ card, slot });
  return { remove, keep, add };
}

/** Same cards in the same slots (trailing empties ignored). */
export function sameBoard(a: readonly (CardId | null)[], b: readonly (CardId | null)[]): boolean {
  const trim = (board: readonly (CardId | null)[]) => {
    let n = board.length;
    while (n > 0 && board[n - 1] === null) n--;
    return board.slice(0, n);
  };
  const x = trim(a);
  const y = trim(b);
  return x.length === y.length && x.every((card, i) => card === y[i]);
}

/** The last set in each player's pile (what the pile fan shows) and their set count. */
export function pileOf(view: Pick<PublicView, 'players'>, playerId: string): { last: CardId[]; sets: number } {
  const p = view.players.find((x) => x.id === playerId);
  if (p === undefined) return { last: [], sets: 0 };
  return { last: p.pile.slice(-3), sets: Math.floor(p.pile.length / 3) };
}
