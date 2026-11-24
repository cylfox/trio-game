/**
 * Browser entry points: open an online room (as host or guest) or start training.
 *
 * Role on load: creating a room makes you its host. Opening a code (link or typed) makes you the
 * host only if this browser holds a saved room for that code (you created it and reloaded);
 * otherwise you join as a guest.
 */
import type { GameConfigInput } from '../engine/engine.ts';
import { createGuest } from './guest.ts';
import { createHost } from './host.ts';
import { newRoomCode } from './room-code.ts';
import type { RoomSession } from './session.ts';
import { loadRoom, pruneRooms, saveRoom } from './storage.ts';
import type { Identity, KeyValueStore } from './storage.ts';
import { createTrain } from './train.ts';
import { createTrysteroTransport } from './trystero-transport.ts';

export interface OpenRoom {
  readonly session: RoomSession;
  readonly code: string;
  readonly role: 'host' | 'guest';
}

/** `code` null creates a new room. */
export function openRoom(code: string | null, me: Identity, store: KeyValueStore): OpenRoom {
  const now = Date.now();
  pruneRooms(store, now);
  const roomCode = code ?? newRoomCode();
  const saved = code === null ? null : loadRoom(store, roomCode, now);
  const transport = createTrysteroTransport(roomCode);
  if (code === null || saved !== null) {
    const session = createHost({ transport, code: roomCode, me, saved, persist: (room) => saveRoom(store, room) });
    return { session, code: roomCode, role: 'host' };
  }
  return { session: createGuest({ transport, code: roomCode, me }), code: roomCode, role: 'guest' };
}

export function openTrain(me: Identity, config?: GameConfigInput): RoomSession {
  return createTrain({ playerId: me.id, config });
}
