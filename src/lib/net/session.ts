/**
 * What the UI talks to: one RoomSession per screen, whatever the role.
 *   host   P2P rooms: the creator's browser runs the engine, owns the room, broadcasts (host.ts)
 *   guest  renders the host's views and sends intents (guest.ts). In server rooms everyone is a
 *          guest of the room server, the creator included (their host powers come from hostId).
 *   train  runs the engine locally, no network (train.ts)
 */
import type { GameEvent, PublicView } from '../engine/engine.ts';
import type { DenyReason, Intent, IntentType, RoomInfo } from './protocol.ts';
import type { Unsubscribe } from './transport.ts';

export type Role = 'host' | 'guest' | 'train';

/**
 * connecting  guest: waiting for the host's first snapshot
 * online      in sync with the host (always, for host and train)
 * hostAway    guest: the connection to the host (or the room server) dropped; reconnecting
 * denied      guest: the host turned us away (see `denied`)
 * closed      guest: the host closed the room
 */
export type Status = 'connecting' | 'online' | 'hostAway' | 'denied' | 'closed';

export interface SessionState {
  readonly role: Role;
  /** Room code; null in train. */
  readonly code: string | null;
  /** My player id. */
  readonly me: string;
  readonly status: Status;
  readonly denied: DenyReason | null;
  /** null until a guest gets its first snapshot, and always in train. */
  readonly room: RoomInfo | null;
  /** The game as everyone sees it; null in the lobby. */
  readonly view: PublicView | null;
  /** Last applied room seq (host broadcast counter). */
  readonly seq: number;
}

/** Why the listener was called. */
export type Change =
  | {
      readonly type: 'state';
      readonly kind: 'snapshot' | 'update';
      /** Events of this change; empty for snapshots and after a gap. */
      readonly events: readonly GameEvent[];
      /** false after a missed update: render the view without animating. */
      readonly contiguous: boolean;
    }
  | { readonly type: 'join' | 'rejoin' | 'leave'; readonly playerId: string; readonly name: string }
  /** Host: a peer was turned away. Guest: we were (playerId is our own). */
  | { readonly type: 'denied'; readonly reason: DenyReason; readonly playerId: string; readonly name: string }
  | { readonly type: 'rejected'; readonly intent: IntentType; readonly reason: string }
  | { readonly type: 'hostAway' | 'hostBack' | 'closed' }
  | { readonly type: 'error'; readonly code: string; readonly message: string };

export type Listener = (state: SessionState, change: Change) => void;

export interface RoomSession {
  readonly role: Role;
  getState(): SessionState;
  subscribe(listener: Listener): Unsubscribe;
  /** Ask for something; the result arrives as a state change (or a 'rejected' change). */
  act(intent: Intent): void;
  /** The host's clock, estimated locally. Compare it with lock.deadline for countdowns. */
  hostNow(): number;
  /** After the tab was hidden: catch up (host: expire overdue calls, re-send snapshots). */
  resync(): void;
  /** Disconnect. A host tells guests the room is closed. */
  leave(): Promise<void>;
}

export type Clock = () => number;
/** Run `fn` after `ms`; returns a cancel function. */
export type Schedule = (fn: () => void, ms: number) => () => void;

export const systemClock: Clock = () => Date.now();

export const systemSchedule: Schedule = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};
