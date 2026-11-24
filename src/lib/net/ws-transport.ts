/**
 * Transport over one WebSocket to the room server. The server is the only peer ('server'): it
 * "joins" when the socket opens and "leaves" when it drops, so guest.ts says hello again (and gets
 * a fresh snapshot) after every reconnect.
 *
 * Staying connected on a phone:
 *   reconnect     exponential backoff with jitter (0.5 s → 10 s), forever, until leave()
 *   wake-up       the tab becoming visible or the network coming back reconnects at once, or
 *                 pings an open socket and drops it if no answer comes (sockets die while asleep)
 *   heartbeat     'ping' every 20 s; the server answers 'pong' without waking the room
 *   for good      close codes 4400–4499 (room not found, full, expired) stop reconnecting
 *   unreachable   two failed attempts in a row report 'server-unreachable' (once per outage)
 */
import { systemSchedule } from './session.ts';
import type { Schedule } from './session.ts';
import { listeners } from './transport.ts';
import type { Transport, TransportError } from './transport.ts';

/** The only peer of a server transport. */
export const SERVER_PEER = 'server';

/** The part of the browser WebSocket we use (fakeable in tests). */
export interface SocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface ReconnectTiming {
  readonly baseMs: number;
  readonly maxMs: number;
  /** A socket still not open after this is dropped and retried. */
  readonly connectTimeoutMs: number;
  readonly pingEveryMs: number;
  /** No message (pong or anything) this long after a ping: the socket is dead. */
  readonly pongTimeoutMs: number;
  /** Failed attempts in a row before 'server-unreachable' is reported. */
  readonly unreachableAfter: number;
}

export const TIMING: ReconnectTiming = {
  baseMs: 500,
  maxMs: 10_000,
  connectTimeoutMs: 8000,
  pingEveryMs: 20_000,
  pongTimeoutMs: 6000,
  unreachableAfter: 2,
};

export interface WebSocketTransportOptions {
  readonly open?: (url: string) => SocketLike;
  readonly schedule?: Schedule;
  readonly random?: () => number;
  /** Calls `fn` when it's worth checking the connection now. Default: visibilitychange + online. */
  readonly onWake?: (fn: () => void) => () => void;
  readonly timing?: Partial<ReconnectTiming>;
}

export interface WebSocketTransport extends Transport {
  /** Check the connection now (reconnect, or ping an open socket). */
  wake(): void;
}

/** Close codes from the server that mean "don't come back". */
export function isFinalClose(code: number): boolean {
  return code >= 4400 && code < 4500;
}

function browserOpen(url: string): SocketLike {
  return new WebSocket(url) as unknown as SocketLike;
}

function browserWake(fn: () => void): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  const visible = () => {
    if (document.visibilityState === 'visible') fn();
  };
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('online', fn);
  window.addEventListener('pageshow', fn);
  return () => {
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('online', fn);
    window.removeEventListener('pageshow', fn);
  };
}

export function createWebSocketTransport(url: string, options: WebSocketTransportOptions = {}): WebSocketTransport {
  const open = options.open ?? browserOpen;
  const schedule = options.schedule ?? systemSchedule;
  const random = options.random ?? Math.random;
  const timing: ReconnectTiming = { ...TIMING, ...options.timing };

  const messages = listeners<[unknown, string]>();
  const joins = listeners<[string]>();
  const leaves = listeners<[string]>();
  const errors = listeners<[TransportError]>();

  let ws: SocketLike | null = null;
  let isOpen = false;
  let stopped = false;
  let attempts = 0;
  let failures = 0;
  let reported = false;
  let cancelRetry: (() => void) | null = null;
  let cancelConnect: (() => void) | null = null;
  let cancelPing: (() => void) | null = null;
  let cancelPong: (() => void) | null = null;

  const clear = (cancel: (() => void) | null): null => {
    cancel?.();
    return null;
  };

  function connect(): void {
    if (stopped || ws !== null) return;
    cancelRetry = clear(cancelRetry);
    let socket: SocketLike;
    try {
      socket = open(url);
    } catch (error) {
      errors.emit({ code: 'server-url', message: error instanceof Error ? error.message : String(error) });
      lost(null, undefined);
      return;
    }
    ws = socket;
    isOpen = false;
    cancelConnect = schedule(() => {
      cancelConnect = null;
      if (ws === socket && !isOpen) drop(socket);
    }, timing.connectTimeoutMs);
    socket.onopen = () => {
      if (ws !== socket) return;
      isOpen = true;
      attempts = 0;
      failures = 0;
      reported = false;
      cancelConnect = clear(cancelConnect);
      heartbeat();
      joins.emit(SERVER_PEER);
    };
    socket.onmessage = (event) => {
      if (ws !== socket) return;
      cancelPong = clear(cancelPong);
      if (typeof event.data !== 'string' || event.data === 'pong') return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      messages.emit(message, SERVER_PEER);
    };
    socket.onclose = (event) => {
      if (ws === socket) lost(socket, event.code);
    };
    socket.onerror = () => {}; // a close event follows
  }

  function detach(socket: SocketLike): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
  }

  /** Give up on a socket now (no answer): don't wait for its close handshake. */
  function drop(socket: SocketLike): void {
    if (ws !== socket) return;
    detach(socket);
    try {
      socket.close();
    } catch {
      // ignore
    }
    lost(socket, undefined);
  }

  function lost(socket: SocketLike | null, code: number | undefined): void {
    if (socket !== null) detach(socket);
    ws = null;
    const wasOpen = isOpen;
    isOpen = false;
    cancelConnect = clear(cancelConnect);
    cancelPing = clear(cancelPing);
    cancelPong = clear(cancelPong);
    if (wasOpen) leaves.emit(SERVER_PEER);
    if (code !== undefined && isFinalClose(code)) {
      stopped = true;
      return;
    }
    if (stopped) return;
    if (!wasOpen) {
      failures += 1;
      if (failures >= timing.unreachableAfter && !reported) {
        reported = true;
        errors.emit({ code: 'server-unreachable', message: `no connection to ${url}` });
      }
    }
    const delay = Math.min(timing.maxMs, timing.baseMs * 2 ** attempts);
    attempts += 1;
    cancelRetry = schedule(connect, Math.round(delay * (0.5 + random() * 0.5)));
  }

  function heartbeat(): void {
    cancelPing = schedule(() => {
      cancelPing = null;
      ping();
      heartbeat();
    }, timing.pingEveryMs);
  }

  /** Send 'ping'; if nothing at all arrives within pongTimeoutMs, the socket is dead. */
  function ping(): void {
    const socket = ws;
    if (socket === null || !isOpen || cancelPong !== null) return;
    try {
      socket.send('ping');
    } catch {
      drop(socket);
      return;
    }
    // Any message (the pong or anything else) cancels this.
    cancelPong = schedule(() => {
      cancelPong = null;
      if (ws === socket) drop(socket);
    }, timing.pongTimeoutMs);
  }

  function wake(): void {
    if (stopped) return;
    if (ws === null) {
      attempts = 0;
      connect();
    } else if (isOpen) ping();
  }

  const offWake = (options.onWake ?? browserWake)(wake);
  connect();

  function send(message: unknown): void {
    if (ws === null || !isOpen) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // closing: the close event reconnects
    }
  }

  return {
    send: (_to, message) => send(message),
    broadcast: send,
    onMessage: (handler) => messages.add(handler),
    onPeerJoin(handler) {
      const off = joins.add(handler);
      if (isOpen) handler(SERVER_PEER);
      return off;
    },
    onPeerLeave: (handler) => leaves.add(handler),
    onError: (handler) => errors.add(handler),
    wake,
    async leave() {
      stopped = true;
      offWake();
      cancelRetry = clear(cancelRetry);
      cancelConnect = clear(cancelConnect);
      cancelPing = clear(cancelPing);
      cancelPong = clear(cancelPong);
      const socket = ws;
      ws = null;
      isOpen = false;
      if (socket !== null) {
        detach(socket);
        try {
          socket.close(1000, 'bye');
        } catch {
          // ignore
        }
      }
      messages.clear();
      joins.clear();
      leaves.clear();
      errors.clear();
    },
  };
}
