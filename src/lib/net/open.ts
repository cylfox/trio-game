/**
 * Which network a room uses, decided once when it is opened (no switching mid-game):
 *
 *   server  the room server (Cloudflare Worker + Durable Object) over a WebSocket. The default
 *           whenever VITE_ROOM_SERVER is set. Links: <app>#K7QX
 *   p2p     Trystero/WebRTC, the creator's phone hosts. Links: <app>#p-K7QX
 *
 * Create room   POST /rooms (4 s). Unreachable, timed out, 5xx or 429 → a P2P room instead (with
 *               a notice). A 4xx refusal from the room server itself ({ error }) is a real error:
 *               no fallback. (A 4xx without that body is something else on the way: unreachable.)
 * Plain code    (typed, or a #K7QX link) → GET /rooms/:code (4 s): exists → server; not found →
 *               "Room not found or expired" (no P2P); unreachable/5xx/429 → P2P with the same code.
 * #p- code      → P2P directly.
 * Known server room (Try again on one) → the server only: a room never changes network.
 * No server     → P2P for everything, as before.
 *
 * Trystero is loaded only when a P2P room is opened (the caller's openP2P imports it lazily).
 */
import { CODE_LENGTH, normalizeCode } from './room-code.ts';
import { systemClock } from './session.ts';
import type { RoomSession, SessionState } from './session.ts';
import type { Identity } from './room-core.ts';

export type NetMode = 'server' | 'p2p';

/** A room to open: a code and, if known, its mode (null = plain code: server first, then P2P). */
export interface RoomLink {
  readonly code: string;
  readonly mode: NetMode | null;
}

export interface ServerUrls {
  /** https://… (create, probe) */
  readonly http: string;
  /** wss://… (rooms/:code/ws) */
  readonly ws: string;
}

/** Wait this long for the room server before falling back to P2P. */
export const SERVER_TIMEOUT_MS = 4000;

const P2P_PREFIX = 'p-';

/**
 * VITE_ROOM_SERVER → its http and ws bases. Accepts ws(s):// or http(s)://, with or without a
 * trailing slash. Empty, malformed or placeholder values ("<account>") → null (P2P only).
 */
export function serverUrls(raw: string | null | undefined): ServerUrls | null {
  const value = (raw ?? '').trim();
  if (value === '' || /[<>\s]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const secure = url.protocol === 'wss:' || url.protocol === 'https:';
  if (!secure && url.protocol !== 'ws:' && url.protocol !== 'http:') return null;
  const rest = `${url.host}${url.pathname.replace(/\/+$/, '')}`;
  return { http: `${secure ? 'https' : 'http'}://${rest}`, ws: `${secure ? 'wss' : 'ws'}://${rest}` };
}

/** The room part of a location hash: '#K7QX' → plain, '#p-K7QX' → P2P. Anything else → null. */
export function parseRoomHash(hash: string): RoomLink | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const p2p = raw.slice(0, P2P_PREFIX.length).toLowerCase() === P2P_PREFIX;
  const body = p2p ? raw.slice(P2P_PREFIX.length) : raw;
  if (body.length !== CODE_LENGTH) return null;
  const code = normalizeCode(body);
  return code === null ? null : { code, mode: p2p ? 'p2p' : null };
}

/** The hash for a room: 'K7QX' (server) or 'p-K7QX' (P2P). */
export function roomHash(code: string, mode: NetMode): string {
  return mode === 'p2p' ? `${P2P_PREFIX}${code}` : code;
}

// ── Asking the server ────────────────────────────────────────────────────────────────────────

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type CreateOutcome =
  | { readonly kind: 'created'; readonly code: string }
  /** No usable answer: network error, timeout, 5xx, 429. Fall back to P2P. */
  | { readonly kind: 'unreachable'; readonly why: string }
  /** The server answered no (a 4xx that a retry or P2P won't fix). */
  | { readonly kind: 'error'; readonly status: number };

export type ProbeOutcome =
  | { readonly kind: 'exists' }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'unreachable'; readonly why: string }
  | { readonly kind: 'error'; readonly status: number };

/** Statuses worth falling back on: the server is down, overloaded or out of quota. */
export function isUnavailable(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

async function call(fetchImpl: Fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response | string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      resolve('timeout'); // settles the race first; the abort only frees the request
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetchImpl(url, { ...init, signal: controller.signal, cache: 'no-store' }), timeout]);
  } catch (error) {
    return error instanceof Error ? error.message || error.name : 'network';
  } finally {
    clearTimeout(timer);
  }
}

/** The JSON body, or null if it isn't JSON. */
async function body(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = (await res.json()) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The room server's own refusal ({ error: '…' }), as opposed to a 4xx from something else on the
 * way (say, a Worker that isn't deployed yet), which counts as unreachable.
 */
async function refusal(res: Response): Promise<string | null> {
  const json = await body(res);
  return typeof json?.error === 'string' ? json.error : null;
}

/** POST /rooms. The body is text/plain JSON, so no CORS preflight (one round trip on 4G). */
export async function requestCreate(server: ServerUrls, playerId: string, fetchImpl: Fetch, timeoutMs = SERVER_TIMEOUT_MS): Promise<CreateOutcome> {
  const res = await call(fetchImpl, `${server.http}/rooms`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ playerId }) }, timeoutMs);
  if (typeof res === 'string') return { kind: 'unreachable', why: res };
  if (isUnavailable(res.status)) return { kind: 'unreachable', why: `HTTP ${res.status}` };
  if (!res.ok) return (await refusal(res)) === null ? { kind: 'unreachable', why: `HTTP ${res.status}` } : { kind: 'error', status: res.status };
  const json = await body(res);
  const code = typeof json?.code === 'string' ? normalizeCode(json.code) : null;
  return code === null ? { kind: 'unreachable', why: 'bad answer' } : { kind: 'created', code };
}

/** GET /rooms/:code. */
export async function probeRoom(server: ServerUrls, code: string, fetchImpl: Fetch, timeoutMs = SERVER_TIMEOUT_MS): Promise<ProbeOutcome> {
  const res = await call(fetchImpl, `${server.http}/rooms/${encodeURIComponent(code)}`, { method: 'GET' }, timeoutMs);
  if (typeof res === 'string') return { kind: 'unreachable', why: res };
  if (isUnavailable(res.status)) return { kind: 'unreachable', why: `HTTP ${res.status}` };
  if (res.ok) {
    const json = await body(res);
    if (json?.exists === true) return { kind: 'exists' };
    if (json?.exists === false) return { kind: 'notFound' };
    return { kind: 'unreachable', why: 'bad answer' };
  }
  const why = await refusal(res);
  if (why === null) return { kind: 'unreachable', why: `HTTP ${res.status}` };
  return why === 'notFound' ? { kind: 'notFound' } : { kind: 'error', status: res.status };
}

// ── Opening a room ───────────────────────────────────────────────────────────────────────────

export interface OpenedRoom {
  readonly session: RoomSession;
  readonly code: string;
  readonly mode: NetMode;
  /** P2P because the room server could not be reached. */
  readonly fallback: boolean;
}

export type OpenResult =
  | { readonly ok: true; readonly room: OpenedRoom }
  | { readonly ok: false; readonly status: number };

export interface OpenDeps {
  readonly server: ServerUrls | null;
  readonly fetch: Fetch;
  readonly timeoutMs?: number;
  /** Join a server room (always as the protocol's guest, creator included). */
  readonly openServer: (code: string) => RoomSession;
  /** Open a P2P room: create (null) or join/resume a code. Loads Trystero. */
  readonly openP2P: (code: string | null) => Promise<{ readonly session: RoomSession; readonly code: string }>;
}

/** A session that is already over: the server said there is no such room. */
export function deniedSession(code: string, me: string): RoomSession {
  const state: SessionState = { role: 'guest', code, me, status: 'denied', denied: 'notFound', room: null, view: null, seq: -1 };
  return {
    role: 'guest',
    getState: () => state,
    subscribe: () => () => {},
    act: () => {},
    hostNow: systemClock,
    resync: () => {},
    leave: async () => {},
  };
}

/** Create (link null) or join a room, choosing its network as described at the top. */
export async function openOnline(link: RoomLink | null, me: Identity, deps: OpenDeps): Promise<OpenResult> {
  const p2p = async (code: string | null, fallback: boolean): Promise<OpenResult> => {
    const opened = await deps.openP2P(code);
    return { ok: true, room: { session: opened.session, code: opened.code, mode: 'p2p', fallback } };
  };
  const server = deps.server;
  if (server === null) return p2p(link?.code ?? null, false);
  if (link?.mode === 'p2p') return p2p(link.code, false);
  if (link?.mode === 'server') return { ok: true, room: { session: deps.openServer(link.code), code: link.code, mode: 'server', fallback: false } };
  const timeoutMs = deps.timeoutMs ?? SERVER_TIMEOUT_MS;

  if (link === null) {
    const created = await requestCreate(server, me.id, deps.fetch, timeoutMs);
    if (created.kind === 'unreachable') return p2p(null, true);
    if (created.kind === 'error') return { ok: false, status: created.status };
    return { ok: true, room: { session: deps.openServer(created.code), code: created.code, mode: 'server', fallback: false } };
  }

  const probe = await probeRoom(server, link.code, deps.fetch, timeoutMs);
  switch (probe.kind) {
    case 'exists':
      return { ok: true, room: { session: deps.openServer(link.code), code: link.code, mode: 'server', fallback: false } };
    case 'notFound':
      return { ok: true, room: { session: deniedSession(link.code, me.id), code: link.code, mode: 'server', fallback: false } };
    case 'unreachable':
      return p2p(link.code, true);
    case 'error':
      return { ok: false, status: probe.status };
  }
}
