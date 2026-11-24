/**
 * One room on the room server: what the Room Durable Object does, minus the Cloudflare glue
 * (room.ts), so tests can drive it through fakes.
 *
 * The rules are room-core.ts, shared with the P2P host. This file adds what a server needs:
 *   sockets      one peer per WebSocket; its attachment { peer, playerId } survives hibernation
 *   storage      the room is saved after every change and rebuilt when the object wakes up
 *   alarms       one alarm serves both the call deadline (expire) and the 24 h idle cleanup
 *   abuse        size cap, schema check (room-core), per-socket rate limit, close on flooding
 *
 * Nothing here throws on bad input: anything off the wire is checked, and every entry point is
 * guarded.
 */
import { mulberry32 } from '../../src/lib/engine/engine.ts';
import { MAX_PLAYERS } from '../../src/lib/net/protocol.ts';
import type { DenyReason, HostMessage } from '../../src/lib/net/protocol.ts';
import { createRoomCore, isSavedRoom } from '../../src/lib/net/room-core.ts';
import type { RoomCore, SavedRoom } from '../../src/lib/net/room-core.ts';
import type { Clock, Schedule } from '../../src/lib/net/session.ts';

/** A hibernatable WebSocket, as the Durable Object sees it (the server side of the pair). */
export interface RoomSocket {
  send(message: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

/** Synchronous storage (SQLite-backed Durable Object KV) and the object's one alarm. */
export interface RoomStorage {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
  /** Delete everything, the alarm included. */
  deleteAll(): void;
  setAlarm(at: number): void;
}

export interface Limits {
  /** Largest accepted message, in characters. */
  readonly messageChars: number;
  /** Token bucket per socket: burst size and refill per second. */
  readonly burst: number;
  readonly perSecond: number;
  /** Invalid messages tolerated per socket before it is closed. */
  readonly badMessages: number;
  /** Open sockets per room (2 players, a few tabs, reconnects). */
  readonly sockets: number;
  /** A room with no change for this long is deleted. */
  readonly idleMs: number;
}

export const LIMITS: Limits = {
  messageChars: 4096,
  burst: 20,
  perSecond: 8,
  badMessages: 10,
  sockets: 8,
  idleMs: 24 * 60 * 60 * 1000,
};

/** Close codes. 4400–4499 tell the client not to reconnect. */
export const CLOSE = {
  notFound: 4404,
  full: 4409,
  expired: 4410,
  version: 4426,
  duplicate: 4429,
  /** Policy violation (flooding, garbage): the client may reconnect after backoff. */
  abuse: 1008,
  /** Our bookkeeping lost this socket: reconnect and say hello again. */
  retry: 4000,
} as const;

const DENY_CLOSE: Record<DenyReason, number> = {
  notFound: CLOSE.notFound,
  full: CLOSE.full,
  version: CLOSE.version,
  duplicate: CLOSE.duplicate,
};

const ROOM_KEY = 'room';

export interface RoomHostOptions {
  readonly storage: RoomStorage;
  /** The object's accepted WebSockets (ctx.getWebSockets()). */
  readonly sockets: () => readonly RoomSocket[];
  /** The alarm already set when the object woke up (ctx.storage.getAlarm()), or null. */
  readonly alarm: number | null;
  readonly clock?: Clock;
  readonly newPeerId?: () => string;
  /** Seed for a new game's shuffle. */
  readonly seed?: () => number;
  readonly limits?: Partial<Limits>;
  readonly log?: (message: string, error?: unknown) => void;
}

interface Attachment {
  readonly peer: string;
  readonly playerId: string | null;
}

interface Meter {
  tokens: number;
  at: number;
  bad: number;
}

function readAttachment(ws: RoomSocket): Attachment | null {
  try {
    const raw = ws.deserializeAttachment() as Partial<Attachment> | null;
    if (raw === null || typeof raw !== 'object' || typeof raw.peer !== 'string') return null;
    return { peer: raw.peer, playerId: typeof raw.playerId === 'string' ? raw.playerId : null };
  } catch {
    return null;
  }
}

function safeClose(ws: RoomSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // already closed
  }
}

function randomPeerId(): string {
  return crypto.randomUUID();
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export class RoomHost {
  private readonly storage: RoomStorage;
  private readonly listSockets: () => readonly RoomSocket[];
  private readonly clock: Clock;
  private readonly newPeerId: () => string;
  private readonly seed: () => number;
  private readonly limits: Limits;
  private readonly log: (message: string, error?: unknown) => void;

  private core: RoomCore | null = null;
  /** peer id → its socket. */
  private readonly sockets = new Map<string, RoomSocket>();
  private readonly meters = new Map<string, Meter>();
  /** The call deadline the driver wants a timer for. */
  private lock: { at: number } | null = null;
  /** The alarm as set in storage. */
  private alarmAt: number | null;
  /** savedAt of the last change. */
  private lastActive = 0;

  constructor(options: RoomHostOptions) {
    this.storage = options.storage;
    this.listSockets = options.sockets;
    this.clock = options.clock ?? (() => Date.now());
    this.newPeerId = options.newPeerId ?? randomPeerId;
    this.seed = options.seed ?? randomSeed;
    this.limits = { ...LIMITS, ...options.limits };
    this.log = options.log ?? ((message, error) => console.error(message, error));
    this.alarmAt = options.alarm;
    this.guard('wake', () => this.wake());
  }

  /** The room exists (created and not expired). */
  exists(): boolean {
    return this.core !== null;
  }

  /** Room for one more socket? */
  canAccept(): boolean {
    return this.listSockets().length < this.limits.sockets;
  }

  /** Claim this (empty) room for a new game. hostId: the creator's player id. false: in use. */
  create(code: string, hostId: string | null): boolean {
    if (this.core !== null) return false;
    const core = this.makeCore(code, hostId, null, []);
    this.core = core;
    this.save(core.saved());
    this.syncAlarm();
    return true;
  }

  /** A WebSocket was just accepted (ctx.acceptWebSocket). */
  connect(ws: RoomSocket): void {
    this.guard('connect', () => {
      if (this.core === null) {
        this.sendTo(ws, { t: 'deny', reason: 'notFound', maxPlayers: MAX_PLAYERS });
        safeClose(ws, CLOSE.notFound, 'notFound');
        return;
      }
      const peer = this.newPeerId();
      ws.serializeAttachment({ peer, playerId: null } satisfies Attachment);
      this.sockets.set(peer, ws);
    });
  }

  /** webSocketMessage. */
  message(ws: RoomSocket, data: string | ArrayBuffer): void {
    this.guard('message', () => {
      const a = readAttachment(ws);
      if (a === null) return safeClose(ws, CLOSE.retry, 'unknown socket');
      if (this.core === null) return safeClose(ws, CLOSE.notFound, 'notFound');
      if (!this.sockets.has(a.peer)) this.sockets.set(a.peer, ws);
      if (!this.allow(a.peer)) return this.kick(ws, a.peer, 'rate limit');
      if (typeof data !== 'string' || data.length > this.limits.messageChars) return this.bad(ws, a.peer);
      if (data === 'ping') return this.sendTo(ws, 'pong'); // normally answered by the auto-response
      let raw: unknown;
      try {
        raw = JSON.parse(data);
      } catch {
        return this.bad(ws, a.peer);
      }
      const before = this.core.playerOf(a.peer);
      if (!this.core.receive(a.peer, raw)) return this.bad(ws, a.peer);
      const after = this.core?.playerOf(a.peer);
      if (after !== before && this.sockets.has(a.peer)) ws.serializeAttachment({ peer: a.peer, playerId: after ?? null } satisfies Attachment);
      this.syncAlarm();
    });
  }

  /** webSocketClose / webSocketError. */
  closed(ws: RoomSocket): void {
    this.guard('close', () => {
      const a = readAttachment(ws);
      if (a === null) return;
      this.sockets.delete(a.peer);
      this.meters.delete(a.peer);
      this.core?.drop(a.peer);
      this.syncAlarm();
    });
  }

  /** The alarm fired: expire an overdue call, or delete an idle room. */
  alarm(): void {
    this.alarmAt = null; // a fired alarm is gone
    this.guard('alarm', () => {
      const core = this.core;
      if (core === null) return;
      if (this.clock() >= this.lastActive + this.limits.idleMs) return this.expire();
      core.tick();
      this.syncAlarm();
    });
  }

  // ── Internals ───────────────────────────────────────────────────────────────────────────

  private wake(): void {
    for (const ws of this.listSockets()) {
      const a = readAttachment(ws);
      if (a !== null) this.sockets.set(a.peer, ws);
    }
    const saved = this.storage.get(ROOM_KEY);
    if (!isSavedRoom(saved)) return;
    const live: Array<[string, string]> = [];
    for (const ws of this.sockets.values()) {
      const a = readAttachment(ws);
      if (a?.playerId != null) live.push([a.peer, a.playerId]);
    }
    const core = this.makeCore(saved.code, saved.hostId === '' ? null : saved.hostId, saved, live);
    this.core = core;
    this.lastActive = saved.savedAt;
    // A socket that said hello but lost its seat meanwhile: have it reconnect and say hello again.
    for (const [peer, playerId] of live) {
      if (core.playerOf(peer) === playerId) continue;
      const ws = this.sockets.get(peer);
      this.sockets.delete(peer);
      if (ws !== undefined) safeClose(ws, CLOSE.retry, 'resync');
    }
    core.settle(); // players whose sockets closed while we slept
    this.syncAlarm();
  }

  private makeCore(code: string, hostId: string | null, saved: SavedRoom | null, live: Array<[string, string]>): RoomCore {
    return createRoomCore({
      code,
      hostId,
      saved,
      peers: live,
      send: (peer, message) => this.send(peer, message),
      persist: (room) => this.save(room),
      clock: this.clock,
      schedule: this.schedule,
      rng: mulberry32(this.seed()),
    });
  }

  /** The driver's timer: kept as a deadline; alarm() runs the room's tick when it is due. */
  private readonly schedule: Schedule = (_fn, ms) => {
    const lock = { at: this.clock() + ms };
    this.lock = lock;
    this.syncAlarm();
    return () => {
      if (this.lock === lock) this.lock = null;
    };
  };

  /**
   * Keep the one alarm no later than both the call deadline and the idle deadline. An alarm that
   * fires early is harmless (it re-checks and re-arms), so it is only moved when it would be late.
   */
  private syncAlarm(): void {
    if (this.core === null) return;
    const idleAt = this.lastActive + this.limits.idleMs;
    const want = this.lock === null ? idleAt : Math.min(this.lock.at, idleAt);
    if (this.alarmAt !== null && this.alarmAt <= want) return;
    this.alarmAt = want;
    this.storage.setAlarm(want);
  }

  private save(room: SavedRoom): void {
    this.lastActive = room.savedAt;
    this.storage.put(ROOM_KEY, room);
  }

  private expire(): void {
    const core = this.core;
    this.core = null;
    this.lock = null;
    core?.close(); // tells identified peers 'closed'
    for (const ws of this.listSockets()) safeClose(ws, CLOSE.expired, 'expired');
    this.sockets.clear();
    this.meters.clear();
    this.storage.deleteAll();
    this.alarmAt = null;
  }

  private send(peer: string, message: HostMessage): void {
    const ws = this.sockets.get(peer);
    if (ws === undefined) return;
    this.sendTo(ws, message);
    if (message.t === 'deny') {
      // Turned away: close it, so it doesn't hold a slot. The client won't reconnect (44xx).
      this.sockets.delete(peer);
      this.meters.delete(peer);
      safeClose(ws, DENY_CLOSE[message.reason], message.reason);
    }
  }

  private sendTo(ws: RoomSocket, message: HostMessage | string): void {
    try {
      ws.send(typeof message === 'string' ? message : JSON.stringify(message));
    } catch {
      // closing or gone; its close event will clean up
    }
  }

  /** Token bucket per socket. */
  private allow(peer: string): boolean {
    const now = this.clock();
    let m = this.meters.get(peer);
    if (m === undefined) {
      m = { tokens: this.limits.burst, at: now, bad: 0 };
      this.meters.set(peer, m);
    }
    m.tokens = Math.min(this.limits.burst, m.tokens + ((now - m.at) * this.limits.perSecond) / 1000);
    m.at = now;
    if (m.tokens < 1) return false;
    m.tokens -= 1;
    return true;
  }

  private bad(ws: RoomSocket, peer: string): void {
    const m = this.meters.get(peer);
    if (m === undefined) return;
    m.bad += 1;
    if (m.bad > this.limits.badMessages) this.kick(ws, peer, 'bad messages');
  }

  private kick(ws: RoomSocket, peer: string, reason: string): void {
    this.sockets.delete(peer);
    this.meters.delete(peer);
    safeClose(ws, CLOSE.abuse, reason);
    this.core?.drop(peer);
    this.syncAlarm();
  }

  private guard(where: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.log(`room ${where} failed`, error);
    }
  }
}
