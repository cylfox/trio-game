/**
 * Wire protocol between the host (runs the engine) and guests (render only).
 *
 *   guest → host   hello { v, playerId, name }   on every new connection to a peer, and on resync
 *                  act   { intent }              call | claim | hint | dealMore | start | rematch
 *   host → guest   state { v, kind, epoch, seq, at, room, view, events }
 *                        kind 'snapshot' answers a hello (join, rejoin, resync); 'update' follows
 *                        every change. view = publicView(state) (null in the lobby); events are the
 *                        engine events of this change, for animation. at = host clock, for countdowns.
 *                  deny  { reason, maxPlayers }      'full' | 'version' | 'duplicate'
 *                  reject { intent, reason }         an intent that changed nothing, e.g. 'noCall'
 *                  closed {}                         the host left for good
 *
 * Ordering: seq is per room incarnation (epoch) and grows by one per broadcast change. Guests drop
 * any state whose (epoch, seq) is not newer than what they have. Every state message carries the
 * full view, so a missed update is repaired by the next one; events are only for animation.
 */
import type { CardId, GameEvent, PublicView } from '../engine/engine.ts';

/** Players per room, host included. The host enforces it: one more peer is denied 'full'. */
export const MAX_PLAYERS = 2;
/** Seats needed before the host can start a game. */
export const MIN_PLAYERS = 2;
export const PROTOCOL_VERSION = 1;
export const NAME_MAX = 24;
const ID_MAX = 64;
const CODE_MAX = 16;

export type Phase = 'lobby' | 'playing' | 'over';

export interface Seat {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
  /** Asked for a rematch (phase 'over'). */
  readonly rematch: boolean;
}

export interface RoomInfo {
  readonly code: string;
  readonly hostId: string;
  readonly maxPlayers: number;
  readonly phase: Phase;
  /** Seat order; seats[0] is the host. A seat is kept for its player while a game is on. */
  readonly seats: readonly Seat[];
}

/** What a player asks for. The host adds the sender's player id. */
export type Intent =
  | { readonly type: 'call' }
  | { readonly type: 'claim'; readonly cards: readonly CardId[]; readonly hinted?: boolean }
  | { readonly type: 'hint' }
  | { readonly type: 'dealMore' }
  | { readonly type: 'start' }
  | { readonly type: 'rematch' };

export type IntentType = Intent['type'];

export type GuestMessage =
  | { readonly t: 'hello'; readonly v: number; readonly playerId: string; readonly name: string }
  | { readonly t: 'act'; readonly intent: Intent };

export type DenyReason = 'full' | 'version' | 'duplicate';

export interface StateMessage {
  readonly t: 'state';
  readonly v: number;
  readonly kind: 'snapshot' | 'update';
  readonly epoch: string;
  readonly seq: number;
  readonly at: number;
  readonly room: RoomInfo;
  readonly view: PublicView | null;
  readonly events: readonly GameEvent[];
}

export type HostMessage =
  | StateMessage
  | { readonly t: 'deny'; readonly reason: DenyReason; readonly maxPlayers: number }
  | { readonly t: 'reject'; readonly intent: IntentType; readonly reason: string }
  | { readonly t: 'closed' };

// ── Validation (everything off the wire is untrusted) ────────────────────────────────────────

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStr(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const INTENT_TYPES: ReadonlySet<string> = new Set<IntentType>(['call', 'claim', 'hint', 'dealMore', 'start', 'rematch']);

export function parseIntent(raw: unknown): Intent | null {
  if (!isObj(raw) || typeof raw.type !== 'string' || !INTENT_TYPES.has(raw.type)) return null;
  if (raw.type === 'claim') {
    const cards = raw.cards;
    if (!Array.isArray(cards) || cards.length !== 3 || !cards.every((c) => Number.isInteger(c))) return null;
    return { type: 'claim', cards: cards as CardId[], ...(raw.hinted === true ? { hinted: true } : {}) };
  }
  return { type: raw.type as Exclude<IntentType, 'claim'> };
}

/** Trim, collapse whitespace, drop control characters, cap the length. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

export function parseGuestMessage(raw: unknown): GuestMessage | null {
  if (!isObj(raw)) return null;
  if (raw.t === 'hello') {
    if (!isNum(raw.v) || !isStr(raw.playerId, ID_MAX)) return null;
    return { t: 'hello', v: raw.v, playerId: raw.playerId, name: cleanName(raw.name) };
  }
  if (raw.t === 'act') {
    const intent = parseIntent(raw.intent);
    return intent === null ? null : { t: 'act', intent };
  }
  return null;
}

function isSeat(raw: unknown): raw is Seat {
  return isObj(raw) && isStr(raw.id, ID_MAX) && typeof raw.name === 'string' && typeof raw.connected === 'boolean' && typeof raw.rematch === 'boolean';
}

function isRoom(raw: unknown): raw is RoomInfo {
  return (
    isObj(raw) &&
    isStr(raw.code, CODE_MAX) &&
    isStr(raw.hostId, ID_MAX) &&
    isNum(raw.maxPlayers) &&
    (raw.phase === 'lobby' || raw.phase === 'playing' || raw.phase === 'over') &&
    Array.isArray(raw.seats) &&
    raw.seats.every(isSeat)
  );
}

/** Light structural check of a view; the host is trusted to send engine output. */
function isView(raw: unknown): raw is PublicView {
  return isObj(raw) && raw.schema === 2 && isNum(raw.seq) && Array.isArray(raw.board) && Array.isArray(raw.players) && isObj(raw.config);
}

export function parseHostMessage(raw: unknown): HostMessage | null {
  if (!isObj(raw)) return null;
  switch (raw.t) {
    case 'state':
      if (raw.v !== PROTOCOL_VERSION || (raw.kind !== 'snapshot' && raw.kind !== 'update')) return null;
      if (!isStr(raw.epoch, ID_MAX) || !isNum(raw.seq) || !isNum(raw.at) || !isRoom(raw.room)) return null;
      if (raw.view !== null && !isView(raw.view)) return null;
      if (!Array.isArray(raw.events)) return null;
      return raw as unknown as StateMessage;
    case 'deny':
      if (raw.reason !== 'full' && raw.reason !== 'version' && raw.reason !== 'duplicate') return null;
      return { t: 'deny', reason: raw.reason, maxPlayers: isNum(raw.maxPlayers) ? raw.maxPlayers : MAX_PLAYERS };
    case 'reject':
      if (typeof raw.intent !== 'string' || !INTENT_TYPES.has(raw.intent) || typeof raw.reason !== 'string') return null;
      return { t: 'reject', intent: raw.intent as IntentType, reason: raw.reason };
    case 'closed':
      return { t: 'closed' };
    default:
      return null;
  }
}
