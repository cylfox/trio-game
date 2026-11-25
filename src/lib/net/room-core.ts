/**
 * The room rules, in one place for both authorities:
 *   P2P host     host.ts, in the creator's browser (Trystero)
 *   room server  server/src/room-host.ts, in a Cloudflare Durable Object (WebSockets)
 *
 * A room owns the only GameState. Peers are opaque ids (a Trystero peer, or one server WebSocket);
 * the room answers them through `send`. Intents are applied in arrival order. After every change
 * the room bumps seq, saves (persist) and sends { view, events } to every identified peer.
 *
 * Seats: the host is seats[0] once seated. A new player id takes a free seat (up to maxPlayers,
 * with one kept for the host until they arrive) or is denied 'full'. A seat stays reserved for its
 * player id while a game is on, so a reconnect (new peer id, same player id) gets the seat, score
 * and all, back. In the lobby a disconnected seat is freed, except the host's. Players who join
 * mid-game watch and play from the next game. Only the host starts games (any phase).
 *
 * Leaving: a guest that leaves on purpose says bye first; its seat is marked quit, so the others
 * hear "left" rather than "lost connection". While a seated player is away mid-game the game is
 * paused (isPaused): calls are refused, a call already running still resolves.
 *
 * No DOM, no storage, no timers of its own: the clock and schedule are injected.
 */
import { mulberry32, publicView } from '../engine/engine.ts';
import type { Action, GameConfigInput, GameEvent, GameState, PublicView, Rng } from '../engine/engine.ts';
import { createGameDriver } from './driver.ts';
import { MAX_PLAYERS, MIN_PLAYERS, PROTOCOL_VERSION, cleanName, isPaused, parseGuestMessage } from './protocol.ts';
import type { DenyReason, HostMessage, Intent, IntentType, Phase, RoomInfo, StateMessage } from './protocol.ts';
import { systemClock, systemSchedule } from './session.ts';
import type { Change, Clock, Schedule } from './session.ts';

export interface Identity {
  /** Stable per browser. Maps this player to their seat when they reconnect. */
  readonly id: string;
  /** Display name; '' means "not set" (the UI shows a fallback). */
  readonly name: string;
}

export interface SavedSeat {
  readonly id: string;
  readonly name: string;
  readonly rematch: boolean;
  /** Had a live connection when saved (the room server uses it to notice drops while asleep). */
  readonly connected?: boolean;
  /** Left on purpose (bye). */
  readonly quit?: boolean;
}

/** A room as saved after every change: localStorage (P2P host) or Durable Object storage. */
export interface SavedRoom {
  readonly v: 1;
  readonly code: string;
  readonly epoch: string;
  readonly seq: number;
  readonly savedAt: number;
  /** '' while nobody claimed the host's seat yet. */
  readonly hostId: string;
  readonly maxPlayers: number;
  readonly phase: Phase;
  readonly seats: readonly SavedSeat[];
  readonly game: GameState | null;
}

/** Light structural check of a saved room (it comes from storage we wrote, but may be stale). */
export function isSavedRoom(raw: unknown, code?: string): raw is SavedRoom {
  if (raw === null || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  const game = r.game as Record<string, unknown> | null | undefined;
  return (
    r.v === 1 &&
    typeof r.code === 'string' &&
    (code === undefined || r.code === code) &&
    typeof r.epoch === 'string' &&
    typeof r.seq === 'number' &&
    typeof r.savedAt === 'number' &&
    typeof r.hostId === 'string' &&
    typeof r.maxPlayers === 'number' &&
    (r.phase === 'lobby' || r.phase === 'playing' || r.phase === 'over') &&
    Array.isArray(r.seats) &&
    (game === null || (typeof game === 'object' && game !== undefined && game.schema === 2))
  );
}

export interface RoomCoreOptions {
  readonly code: string;
  /** Who may start games: the creator. null: the first player to say hello. */
  readonly hostId: string | null;
  /** P2P: the host's own player. Seated first and always connected; a hello with its id is a 'duplicate'. */
  readonly local?: Identity | null;
  /** Resume this saved room (same epoch, seq, seats and game). */
  readonly saved?: SavedRoom | null;
  /** Peers already identified (peer id → player id), e.g. a room server waking up with open sockets. */
  readonly peers?: Iterable<readonly [string, string]>;
  /** Deliver a message to one peer. */
  readonly send: (peer: string, message: HostMessage) => void;
  /** Called after every change with the room to save. */
  readonly persist?: (room: SavedRoom) => void;
  /** Every change, for a local UI (P2P host). */
  readonly onChange?: (change: Change) => void;
  readonly maxPlayers?: number;
  readonly minPlayers?: number;
  /** Versus config overrides (callMs, setPoints, penalty, ...). */
  readonly config?: GameConfigInput;
  readonly clock?: Clock;
  readonly schedule?: Schedule;
  readonly rng?: Rng;
  readonly newEpoch?: () => string;
}

export interface RoomCore {
  readonly code: string;
  readonly hostId: string | null;
  readonly seq: number;
  readonly phase: Phase;
  readonly game: GameState | null;
  info(): RoomInfo;
  view(): PublicView | null;
  /** A message from a peer. Untrusted: returns false (and changes nothing) if it is not valid. */
  receive(peer: string, raw: unknown): boolean;
  /** A peer disconnected. */
  drop(peer: string): void;
  /** The player behind a peer that said hello. */
  playerOf(peer: string): string | undefined;
  /** Identified peers. */
  peers(): string[];
  /** A player's intent. replyTo: the peer to tell about a refusal (null: the local player). */
  act(playerId: string, intent: Intent, replyTo: string | null): void;
  /** Expire an overdue call now (a timer fired, or the tab woke up). */
  tick(): void;
  /** After a restart: tell everyone about players whose connection went away meanwhile. */
  settle(): void;
  /** Send a fresh snapshot to every identified peer. */
  snapshotAll(): void;
  /** Tell every peer the room is gone, and stop the timer. */
  close(): void;
  /** The room as saved. */
  saved(): SavedRoom;
}

interface SeatDraft {
  id: string;
  name: string;
  connected: boolean;
  rematch: boolean;
  quit: boolean;
}

function randomEpoch(): string {
  return Math.floor(Math.random() * 2 ** 48).toString(36);
}

function randomRng(): Rng {
  return mulberry32(Math.floor(Math.random() * 2 ** 32));
}

export function createRoomCore(options: RoomCoreOptions): RoomCore {
  const { code, send } = options;
  const local = options.local ?? null;
  const clock = options.clock ?? systemClock;
  const schedule = options.schedule ?? systemSchedule;
  const maxPlayers = options.maxPlayers ?? MAX_PLAYERS;
  const minPlayers = options.minPlayers ?? MIN_PLAYERS;
  const rng = options.rng ?? randomRng();
  const persist = options.persist ?? (() => {});
  const onChange = options.onChange ?? (() => {});
  const saved = options.saved ?? null;

  let hostId: string | null = options.hostId ?? (saved !== null && saved.hostId !== '' ? saved.hostId : null);
  let epoch = saved?.epoch ?? (options.newEpoch ?? randomEpoch)();
  let seq = saved?.seq ?? 0;
  let phase: Phase = saved?.phase ?? 'lobby';
  /** peer id → player id, for peers that said hello. */
  const peers = new Map<string, string>();
  const initialPeers = [...(options.peers ?? [])];
  const live = new Set(initialPeers.map(([, playerId]) => playerId));

  let seats: SeatDraft[] = local === null ? [] : [{ id: local.id, name: local.name, connected: true, rematch: false, quit: false }];
  /** Saved as connected, but no connection is left: settle() announces them. */
  let gone: Array<{ id: string; name: string }> = [];
  for (const s of saved?.seats ?? []) {
    if (typeof s?.id !== 'string' || s.id === local?.id || seats.some((x) => x.id === s.id)) continue;
    const name = cleanName(s.name);
    const connected = live.has(s.id);
    if (s.connected === true && !connected) gone.push({ id: s.id, name });
    // In the lobby nobody has a stake yet: free absent players' seats; they re-take them on hello.
    if (phase === 'lobby' && !connected && s.id !== hostId) continue;
    seats.push({ id: s.id, name, connected, rematch: s.rematch === true, quit: !connected && s.quit === true });
  }
  for (const [peer, playerId] of initialPeers) if (seats.some((s) => s.id === playerId)) peers.set(peer, playerId);

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

  function info(): RoomInfo {
    return { code, hostId: hostId ?? '', maxPlayers, phase, seats: seats.map((s) => ({ ...s })) };
  }

  function view(): PublicView | null {
    const game = driver.game;
    return game === null ? null : publicView(game);
  }

  function savedRoom(): SavedRoom {
    return {
      v: 1,
      code,
      epoch,
      seq,
      savedAt: clock(),
      hostId: hostId ?? '',
      maxPlayers,
      phase,
      seats: seats.map(({ id, name, rematch, connected, quit }) => ({ id, name, rematch, connected, quit })),
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
      room: info(),
      view: view(),
      events: kind === 'snapshot' ? [] : events,
    };
  }

  /** A change happened: bump seq, save, send to every identified peer, tell the local UI. */
  function publish(events: readonly GameEvent[], extra?: { snapshotFor?: string; change?: Change }): void {
    seq += 1;
    persist(savedRoom());
    const update = stateMessage('update', events);
    const snapshot = extra?.snapshotFor === undefined ? null : stateMessage('snapshot', []);
    for (const peer of [...peers.keys()]) send(peer, peer === extra?.snapshotFor && snapshot !== null ? snapshot : update);
    if (extra?.change !== undefined) onChange(extra.change);
    onChange({ type: 'state', kind: 'update', events, contiguous: true });
  }

  function deny(peer: string, reason: DenyReason, playerId: string, name: string): void {
    send(peer, { t: 'deny', reason, maxPlayers });
    onChange({ type: 'denied', reason, playerId, name });
  }

  function reject(replyTo: string | null, intent: IntentType, reason: string): void {
    if (replyTo === null) onChange({ type: 'rejected', intent, reason });
    else send(replyTo, { t: 'reject', intent, reason });
  }

  function seatOf(playerId: string | null): SeatDraft | undefined {
    return playerId === null ? undefined : seats.find((s) => s.id === playerId);
  }

  function hello(peer: string, v: number, playerId: string, rawName: string): void {
    const name = cleanName(rawName);
    if (v !== PROTOCOL_VERSION) return deny(peer, 'version', playerId, name);
    if (playerId === local?.id) return deny(peer, 'duplicate', playerId, name);
    const previous = peers.get(peer);
    if (previous !== undefined && previous !== playerId) drop(peer); // same connection, another player: the old one left
    if (hostId === null) hostId = playerId; // nobody claimed the room: the first player hosts it
    let seat = seatOf(playerId);
    let change: Change | undefined;
    if (seat === undefined) {
      const reserved = seatOf(hostId) === undefined && playerId !== hostId ? 1 : 0;
      if (seats.length + reserved >= maxPlayers) return deny(peer, 'full', playerId, name);
      seat = { id: playerId, name, connected: true, rematch: false, quit: false };
      if (playerId === hostId) seats.unshift(seat);
      else seats.push(seat);
      change = { type: 'join', playerId, name };
    } else if (!seat.connected) {
      change = { type: 'rejoin', playerId, name };
    }
    const unchanged = change === undefined && peers.get(peer) === playerId && seat.name === name;
    seat.connected = true;
    seat.quit = false;
    seat.name = name;
    peers.set(peer, playerId);
    if (unchanged) send(peer, stateMessage('snapshot', [])); // a resync: just the snapshot
    else publish([], { snapshotFor: peer, change });
  }

  /** A peer went away. quit: it said bye (left on purpose) rather than lost its connection. */
  function drop(peer: string, quit = false): void {
    const playerId = peers.get(peer);
    if (playerId === undefined) return;
    peers.delete(peer);
    if ([...peers.values()].includes(playerId)) return; // another tab of the same player is still here
    const seat = seatOf(playerId);
    if (seat === undefined || playerId === local?.id) return;
    seat.connected = false;
    seat.quit = quit;
    if (phase === 'lobby' && playerId !== hostId) seats = seats.filter((s) => s !== seat);
    publish([], { change: { type: 'leave', playerId, name: seat.name, quit } });
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

  function act(playerId: string, intent: Intent, replyTo: string | null): void {
    switch (intent.type) {
      case 'call':
      case 'claim': {
        const action = toAction(playerId, intent);
        if (phase !== 'playing' || action === null) return reject(replyTo, intent.type, 'notPlaying');
        if (intent.type === 'call' && isPaused(info())) return reject(replyTo, 'call', 'paused');
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
        if (playerId !== hostId) return reject(replyTo, 'start', 'hostOnly');
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

  return {
    code,
    get hostId() {
      return hostId;
    },
    get seq() {
      return seq;
    },
    get phase() {
      return phase;
    },
    get game() {
      return driver.game;
    },
    info,
    view,
    receive(peer, raw) {
      const message = parseGuestMessage(raw);
      if (message === null) return false;
      if (message.t === 'hello') {
        hello(peer, message.v, message.playerId, message.name);
        return true;
      }
      if (message.t === 'bye') {
        drop(peer, true);
        return true;
      }
      const playerId = peers.get(peer);
      if (playerId !== undefined) act(playerId, message.intent, peer);
      return true;
    },
    drop,
    playerOf: (peer) => peers.get(peer),
    peers: () => [...peers.keys()],
    act,
    tick: () => driver.tick(),
    settle() {
      const left = gone;
      gone = [];
      for (const { id, name } of left) if (seatOf(id)?.connected !== true) publish([], { change: { type: 'leave', playerId: id, name, quit: false } });
    },
    snapshotAll() {
      for (const peer of [...peers.keys()]) send(peer, stateMessage('snapshot', []));
    },
    close() {
      driver.stop();
      for (const peer of [...peers.keys()]) send(peer, { t: 'closed' });
    },
    saved: savedRoom,
  };
}
