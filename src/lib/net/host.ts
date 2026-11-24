/**
 * The host: owns the room and the only GameState. Guests' intents are applied in arrival order;
 * the host's own intents take the same path (act → handleIntent). After every change the host
 * saves the room, bumps seq and sends { view, events } to every identified peer.
 *
 * Seats: the host is seats[0]. A new player id takes a free seat (up to maxPlayers) or is denied
 * 'full'. A seat stays reserved for its player id while a game is on, so a reconnect (new peer id,
 * same player id) gets the seat, score and all, back. In the lobby a disconnected guest's seat is
 * freed. Players who join mid-game watch and play from the next game.
 */
import { mulberry32, publicView } from '../engine/engine.ts';
import type { Action, GameConfigInput, GameEvent, Rng } from '../engine/engine.ts';
import { createGameDriver } from './driver.ts';
import { MAX_PLAYERS, MIN_PLAYERS, PROTOCOL_VERSION, cleanName, parseGuestMessage } from './protocol.ts';
import type { DenyReason, HostMessage, Intent, IntentType, Phase, RoomInfo, StateMessage } from './protocol.ts';
import { systemClock, systemSchedule } from './session.ts';
import type { Change, Clock, Listener, RoomSession, Schedule, SessionState } from './session.ts';
import type { Identity, SavedRoom } from './storage.ts';
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

interface SeatDraft {
  id: string;
  name: string;
  connected: boolean;
  rematch: boolean;
}

function randomEpoch(): string {
  return Math.floor(Math.random() * 2 ** 48).toString(36);
}

function randomRng(): Rng {
  return mulberry32(Math.floor(Math.random() * 2 ** 32));
}

export function createHost(options: HostOptions): RoomSession {
  const { transport, code, me } = options;
  const clock = options.clock ?? systemClock;
  const schedule = options.schedule ?? systemSchedule;
  const maxPlayers = options.maxPlayers ?? MAX_PLAYERS;
  const minPlayers = options.minPlayers ?? MIN_PLAYERS;
  const rng = options.rng ?? randomRng();
  const persist = options.persist ?? (() => {});
  const saved = options.saved ?? null;

  const subscribers = listeners<[SessionState, Change]>();
  /** peer id → player id, for peers that said hello. */
  const peers = new Map<string, string>();
  let epoch = saved?.epoch ?? (options.newEpoch ?? randomEpoch)();
  let seq = saved?.seq ?? 0;
  let phase: Phase = saved?.phase ?? 'lobby';
  let seats: SeatDraft[] = [{ id: me.id, name: me.name, connected: true, rematch: false }];
  if (saved !== null) {
    const guests = saved.seats.filter((s) => s.id !== me.id).map((s) => ({ ...s, connected: false }));
    // In the lobby nobody has a stake yet: free the guests' seats; they re-take them on hello.
    if (phase !== 'lobby') seats.push(...guests);
  }

  const driver = createGameDriver({
    clock,
    schedule,
    onCommit: ({ state: game, events }) => {
      if (game.over && phase === 'playing') {
        phase = 'over';
        for (const s of seats) s.rematch = false;
      }
      publish(events);
    },
  });
  driver.load(saved?.game ?? null);
  let state: SessionState = snapshotState();

  function room(): RoomInfo {
    return { code, hostId: me.id, maxPlayers, phase, seats: seats.map((s) => ({ ...s })) };
  }

  function snapshotState(): SessionState {
    const game = driver.game;
    return {
      role: 'host',
      code,
      me: me.id,
      status: 'online',
      denied: null,
      room: room(),
      view: game === null ? null : publicView(game),
      seq,
    };
  }

  function savedRoom(): SavedRoom {
    return {
      v: 1,
      code,
      epoch,
      seq,
      savedAt: clock(),
      hostId: me.id,
      maxPlayers,
      phase,
      seats: seats.map(({ id, name, rematch }) => ({ id, name, rematch })),
      game: driver.game,
    };
  }

  function stateMessage(kind: 'snapshot' | 'update', events: readonly GameEvent[]): StateMessage {
    return {
      t: 'state',
      v: PROTOCOL_VERSION,
      kind,
      epoch,
      seq,
      at: clock(),
      room: state.room ?? room(),
      view: state.view,
      events: kind === 'snapshot' ? [] : events,
    };
  }

  function notify(change: Change): void {
    subscribers.emit(state, change);
  }

  /** A change happened: bump seq, save, send to every identified peer, tell the local UI. */
  function publish(events: readonly GameEvent[], extra?: { snapshotFor?: string; change?: Change }): void {
    seq += 1;
    state = snapshotState();
    persist(savedRoom());
    const update = stateMessage('update', events);
    const snapshot = extra?.snapshotFor === undefined ? null : stateMessage('snapshot', []);
    for (const peer of peers.keys()) transport.send(peer, peer === extra?.snapshotFor && snapshot !== null ? snapshot : update);
    if (extra?.change !== undefined) notify(extra.change);
    notify({ type: 'state', kind: 'update', events, contiguous: true });
  }

  function send(peer: string, message: HostMessage): void {
    transport.send(peer, message);
  }

  function deny(peer: string, reason: DenyReason, playerId: string, name: string): void {
    send(peer, { t: 'deny', reason, maxPlayers });
    notify({ type: 'denied', reason, playerId, name });
  }

  function reject(replyTo: string | null, intent: IntentType, reason: string): void {
    if (replyTo === null) notify({ type: 'rejected', intent, reason });
    else send(replyTo, { t: 'reject', intent, reason });
  }

  function seatOf(playerId: string): SeatDraft | undefined {
    return seats.find((s) => s.id === playerId);
  }

  function onHello(peer: string, v: number, playerId: string, rawName: string): void {
    const name = cleanName(rawName);
    if (v !== PROTOCOL_VERSION) return deny(peer, 'version', playerId, name);
    if (playerId === me.id) return deny(peer, 'duplicate', playerId, name);
    let seat = seatOf(playerId);
    let change: Change | undefined;
    if (seat === undefined) {
      if (seats.length >= maxPlayers) return deny(peer, 'full', playerId, name);
      seat = { id: playerId, name, connected: true, rematch: false };
      seats.push(seat);
      change = { type: 'join', playerId, name };
    } else if (!seat.connected) {
      change = { type: 'rejoin', playerId, name };
    }
    const unchanged = change === undefined && peers.get(peer) === playerId && seat.name === name;
    seat.connected = true;
    seat.name = name;
    peers.set(peer, playerId);
    if (unchanged) send(peer, stateMessage('snapshot', [])); // a resync: just the snapshot
    else publish([], { snapshotFor: peer, change });
  }

  function onPeerLeave(peer: string): void {
    const playerId = peers.get(peer);
    if (playerId === undefined) return;
    peers.delete(peer);
    if ([...peers.values()].includes(playerId)) return; // another tab of the same player is still here
    const seat = seatOf(playerId);
    if (seat === undefined) return;
    seat.connected = false;
    if (phase === 'lobby') seats = seats.filter((s) => s !== seat);
    publish([], { change: { type: 'leave', playerId, name: seat.name } });
  }

  function canStart(): boolean {
    return seats.length >= minPlayers && seats.every((s) => s.connected);
  }

  function startGame(): void {
    phase = 'playing';
    for (const s of seats) s.rematch = false;
    driver.start(
      seats.map((s) => s.id),
      rng,
      { mode: 'versus', config: options.config },
    );
  }

  function toAction(playerId: string, intent: Intent): Action | null {
    switch (intent.type) {
      case 'call':
        return { type: 'call', playerId };
      case 'claim':
        return { type: 'claim', playerId, cards: intent.cards, hinted: intent.hinted === true };
      default:
        return null;
    }
  }

  function handleIntent(playerId: string, intent: Intent, replyTo: string | null): void {
    switch (intent.type) {
      case 'call':
      case 'claim': {
        const action = toAction(playerId, intent);
        if (phase !== 'playing' || action === null) return reject(replyTo, intent.type, 'notPlaying');
        const step = driver.apply(action);
        if (step === null) return reject(replyTo, intent.type, 'notPlaying');
        if (step.events.length === 0 && step.result !== 'called') reject(replyTo, intent.type, step.result);
        return;
      }
      case 'hint':
      case 'dealMore':
        return reject(replyTo, intent.type, 'notInVersus');
      case 'start':
        // The host starts the first game from the lobby, and can start a new one at any time
        // after that (the menu's "New game", or a rematch without waiting for every request).
        if (playerId !== me.id) return reject(replyTo, 'start', 'hostOnly');
        if (!canStart()) return reject(replyTo, 'start', 'needPlayers');
        return startGame();
      case 'rematch': {
        if (phase !== 'over') return reject(replyTo, 'rematch', 'notOver');
        const seat = seatOf(playerId);
        if (seat === undefined) return reject(replyTo, 'rematch', 'noSeat');
        seat.rematch = true;
        if (canStart() && seats.every((s) => s.rematch)) return startGame();
        return publish([]);
      }
    }
  }

  // ── Wiring ────────────────────────────────────────────────────────────────────────────────

  const offs = [
    transport.onMessage((raw, from) => {
      const message = parseGuestMessage(raw);
      if (message === null) return;
      if (message.t === 'hello') return onHello(from, message.v, message.playerId, message.name);
      const playerId = peers.get(from);
      if (playerId !== undefined) handleIntent(playerId, message.intent, from);
    }),
    transport.onPeerLeave(onPeerLeave),
    transport.onError((error) => notify({ type: 'error', code: error.code, message: error.message })),
  ];

  persist(savedRoom());

  return {
    role: 'host',
    getState: () => state,
    subscribe: (listener: Listener) => subscribers.add(listener),
    act: (intent) => handleIntent(me.id, intent, null),
    hostNow: clock,
    resync() {
      driver.tick();
      for (const peer of peers.keys()) send(peer, stateMessage('snapshot', []));
    },
    async leave() {
      driver.stop();
      for (const peer of peers.keys()) send(peer, { t: 'closed' });
      for (const off of offs) off();
      subscribers.clear();
      await transport.leave();
    },
  };
}
