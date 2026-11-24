/**
 * The P2P host: the creator's browser owns the room (room-core.ts) and the only GameState, and
 * talks to guests over a Transport (Trystero). The host's own intents take the same path as a
 * guest's (act → the room), so the rules are exactly the room server's.
 *
 * Seats: the host is seats[0], always connected. A reconnecting guest (new peer id, same player
 * id) gets its seat, score and all, back. See room-core.ts for the full seat rules.
 */
import type { GameConfigInput, Rng } from '../engine/engine.ts';
import { createRoomCore } from './room-core.ts';
import type { Identity, SavedRoom } from './room-core.ts';
import { systemClock } from './session.ts';
import type { Change, Clock, Listener, RoomSession, Schedule, SessionState } from './session.ts';
import { listeners } from './transport.ts';
import type { Transport } from './transport.ts';

export interface HostOptions {
  readonly transport: Transport;
  readonly code: string;
  readonly me: Identity;
  /** Resume this saved room (same epoch, seq, seats and game). */
  readonly saved?: SavedRoom | null;
  /** Called after every change with the room to save. */
  readonly persist?: (room: SavedRoom) => void;
  readonly maxPlayers?: number;
  readonly minPlayers?: number;
  /** Versus config overrides (callMs, setPoints, penalty, ...). */
  readonly config?: GameConfigInput;
  readonly clock?: Clock;
  readonly schedule?: Schedule;
  readonly rng?: Rng;
  readonly newEpoch?: () => string;
}

export function createHost(options: HostOptions): RoomSession {
  const { transport, code, me } = options;
  const clock = options.clock ?? systemClock;
  const persist = options.persist ?? (() => {});
  const subscribers = listeners<[SessionState, Change]>();
  let state: SessionState;

  const room = createRoomCore({
    code,
    hostId: me.id,
    local: me,
    saved: options.saved ?? null,
    send: (peer, message) => transport.send(peer, message),
    persist,
    onChange: (change) => {
      state = snapshotState();
      subscribers.emit(state, change);
    },
    maxPlayers: options.maxPlayers,
    minPlayers: options.minPlayers,
    config: options.config,
    clock,
    schedule: options.schedule,
    rng: options.rng,
    newEpoch: options.newEpoch,
  });

  function snapshotState(): SessionState {
    return { role: 'host', code, me: me.id, status: 'online', denied: null, room: room.info(), view: room.view(), seq: room.seq };
  }
  state = snapshotState();

  const offs = [
    transport.onMessage((raw, from) => void room.receive(from, raw)),
    transport.onPeerLeave((peer) => room.drop(peer)),
    transport.onError((error) => subscribers.emit(state, { type: 'error', code: error.code, message: error.message })),
  ];

  persist(room.saved());

  return {
    role: 'host',
    getState: () => state,
    subscribe: (listener: Listener) => subscribers.add(listener),
    act: (intent) => room.act(me.id, intent, null),
    hostNow: clock,
    resync() {
      room.tick();
      room.snapshotAll();
    },
    async leave() {
      room.close();
      for (const off of offs) off();
      subscribers.clear();
      await transport.leave();
    },
  };
}
