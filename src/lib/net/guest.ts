/**
 * A guest never runs game logic: it says hello to every peer it meets (only the host answers),
 * renders the host's views and sends intents. States older than what it has are dropped.
 *
 * The host reports joins and leaves only to its own UI; a guest works them out from the seats in
 * each state (seatChanges), so in server rooms, where everyone is a guest, players still hear
 * about each other.
 */
import { PROTOCOL_VERSION, parseHostMessage } from './protocol.ts';
import type { GuestMessage, Intent, RoomInfo } from './protocol.ts';
import { systemClock } from './session.ts';
import type { Change, Clock, Listener, RoomSession, SessionState } from './session.ts';
import type { Identity } from './storage.ts';
import { listeners } from './transport.ts';
import type { Transport } from './transport.ts';

export interface GuestOptions {
  readonly transport: Transport;
  readonly code: string;
  readonly me: Identity;
  readonly clock?: Clock;
}

/** Clock offset samples kept; the largest (least delayed) one wins. */
const OFFSET_SAMPLES = 8;

type SeatChange = Extract<Change, { type: 'join' | 'rejoin' | 'leave' }>;

/**
 * Who else joined, came back or left between two room states. None for the first state: whoever
 * is seated then was already there. A seat that disappears (the lobby frees it) is a leave; its
 * player is out of the room either way, so it counts as quit.
 */
export function seatChanges(before: RoomInfo | null, after: RoomInfo, me: string): SeatChange[] {
  if (before === null) return [];
  const changes: SeatChange[] = [];
  for (const seat of after.seats) {
    if (seat.id === me) continue;
    const was = before.seats.find((s) => s.id === seat.id);
    const at = { playerId: seat.id, name: seat.name };
    if (was === undefined) {
      if (seat.connected) changes.push({ type: 'join', ...at });
    } else if (!was.connected && seat.connected) changes.push({ type: 'rejoin', ...at });
    else if (was.connected && !seat.connected) changes.push({ type: 'leave', ...at, quit: seat.quit === true });
  }
  for (const was of before.seats) {
    if (was.id !== me && was.connected && !after.seats.some((s) => s.id === was.id)) changes.push({ type: 'leave', playerId: was.id, name: was.name, quit: true });
  }
  return changes;
}

export function createGuest(options: GuestOptions): RoomSession {
  const { transport, code, me } = options;
  const clock = options.clock ?? systemClock;
  const subscribers = listeners<[SessionState, Change]>();
  let hostPeer: string | null = null;
  let epoch: string | null = null;
  let offsets: number[] = [];
  let state: SessionState = {
    role: 'guest',
    code,
    me: me.id,
    status: 'connecting',
    denied: null,
    room: null,
    view: null,
    seq: -1,
  };

  const hello: GuestMessage = { t: 'hello', v: PROTOCOL_VERSION, playerId: me.id, name: me.name };

  function set(next: Partial<SessionState>, change: Change): void {
    state = { ...state, ...next };
    subscribers.emit(state, change);
  }

  /** host clock − local clock. Network delay only makes a sample smaller, so take the max. */
  function sampleOffset(hostAt: number): void {
    offsets = [...offsets, hostAt - clock()].slice(-OFFSET_SAMPLES);
  }

  const offs = [
    transport.onPeerJoin((peer) => {
      if (state.status !== 'denied') transport.send(peer, hello);
    }),
    transport.onPeerLeave((peer) => {
      if (peer !== hostPeer) return;
      hostPeer = null;
      if (state.status === 'online') set({ status: 'hostAway' }, { type: 'hostAway' });
      transport.broadcast(hello); // whoever hosts now (a reloaded host has a new peer id) will answer
    }),
    transport.onMessage((raw, from) => {
      const message = parseHostMessage(raw);
      if (message === null) return;
      switch (message.t) {
        case 'state': {
          const sameEpoch = message.epoch === epoch;
          if (sameEpoch && message.seq <= state.seq) return; // stale or duplicate
          const contiguous = sameEpoch && message.kind === 'update' && message.seq === state.seq + 1;
          const wasAway = state.status === 'hostAway';
          const seats = seatChanges(state.room, message.room, me.id);
          hostPeer = from;
          epoch = message.epoch;
          sampleOffset(message.at);
          if (wasAway) subscribers.emit(state, { type: 'hostBack' });
          set(
            { status: 'online', denied: null, room: message.room, view: message.view, seq: message.seq },
            { type: 'state', kind: message.kind, events: contiguous ? message.events : [], contiguous },
          );
          for (const change of seats) subscribers.emit(state, change);
          return;
        }
        case 'deny':
          if (state.status === 'online') return;
          set({ status: 'denied', denied: message.reason }, { type: 'denied', reason: message.reason, playerId: me.id, name: me.name });
          return;
        case 'reject':
          subscribers.emit(state, { type: 'rejected', intent: message.intent, reason: message.reason });
          return;
        case 'closed':
          if (from !== hostPeer) return;
          hostPeer = null;
          set({ status: 'closed' }, { type: 'closed' });
          return;
      }
    }),
    transport.onError((error) => subscribers.emit(state, { type: 'error', code: error.code, message: error.message })),
  ];

  return {
    role: 'guest',
    getState: () => state,
    subscribe: (listener: Listener) => subscribers.add(listener),
    act(intent: Intent) {
      if (hostPeer === null) {
        subscribers.emit(state, { type: 'rejected', intent: intent.type, reason: 'offline' });
        return;
      }
      const message: GuestMessage = { t: 'act', intent };
      transport.send(hostPeer, message);
    },
    hostNow: () => clock() + (offsets.length === 0 ? 0 : Math.max(...offsets)),
    resync() {
      if (hostPeer !== null) transport.send(hostPeer, hello);
      else transport.broadcast(hello);
    },
    async leave() {
      // Say we're leaving on purpose, so the others hear "left" rather than "lost connection".
      if (hostPeer !== null) transport.send(hostPeer, { t: 'bye' } satisfies GuestMessage);
      for (const off of offs) off();
      subscribers.clear();
      await transport.leave();
    },
  };
}
