/**
 * The Worker's routes. Plain fetch API (Request/Response), no Cloudflare globals, so tests run in
 * Node with a fake room namespace.
 *
 *   GET  /health             liveness
 *   POST /rooms              create a room: { playerId? } → 201 { code }
 *   GET  /rooms/:code        does the room exist? 200 { code, exists } (a malformed code: 404)
 *                            Not a 404 for "no such room": browsers log failed loads as errors.
 *   GET  /rooms/:code/ws     WebSocket upgrade, forwarded to the room's Durable Object
 *
 * POST, the probe and the upgrade only answer allowed origins (ALLOWED_ORIGINS), and the HTTP
 * routes send CORS headers for them. The allowlist stops other *websites* from using the server
 * from their visitors' browsers; it can't stop scripts, which send any Origin they like. That is
 * what the per-IP rate limits are for (rate-limit.ts): over the limit, 429 with Retry-After.
 */
import { CODE_LENGTH, newRoomCode, normalizeCode } from '../../src/lib/net/room-code.ts';
import type { LimitKind, LimitResult } from './rate-limit.ts';

export interface RoomStub {
  /** Claim the room for a new game. false: the code is in use. */
  create(hostId: string | null): Promise<boolean>;
  exists(): Promise<boolean>;
  fetch(request: Request): Promise<Response>;
}

export interface Routes {
  /** Comma-separated origins; a trailing ':*' allows any port (http://localhost:*). */
  readonly origins: string;
  readonly room: (code: string) => RoomStub;
  /** Per-IP rate limit for a kind of call (rate-limit.ts). Absent: no limit. */
  readonly limit?: (kind: LimitKind, request: Request) => Promise<LimitResult>;
  /** For tests: the code generator. */
  readonly newCode?: () => string;
}

/** Fresh codes tried before giving up (31⁴ codes: a collision is already rare). */
const CREATE_TRIES = 8;
const BODY_MAX = 1024;
const ID_MAX = 64;

export function originAllowed(origin: string | null, allowList: string): boolean {
  if (origin === null || origin === '') return false;
  for (const raw of allowList.split(',')) {
    const entry = raw.trim();
    if (entry === '') continue;
    if (entry === origin) return true;
    if (entry.endsWith(':*')) {
      const base = entry.slice(0, -1); // 'http://localhost:'
      if (origin.startsWith(base) && /^\d{1,5}$/.test(origin.slice(base.length))) return true;
      if (origin === entry.slice(0, -2)) return true; // default port
    }
  }
  return false;
}

function cors(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

async function readHostId(request: Request): Promise<string | null | undefined> {
  const length = Number(request.headers.get('Content-Length') ?? '0');
  if (length > BODY_MAX) return undefined;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return undefined;
  }
  if (text.length > BODY_MAX) return undefined;
  if (text.trim() === '') return null;
  try {
    const body = JSON.parse(text) as unknown;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const id = (body as Record<string, unknown>).playerId;
    if (id === undefined) return null;
    return typeof id === 'string' && id.length > 0 && id.length <= ID_MAX ? id : undefined;
  } catch {
    return undefined;
  }
}

function tooMany(result: LimitResult, headers: Record<string, string>): Response {
  return json(429, { error: 'rateLimited' }, { ...headers, 'Retry-After': String(result.retryAfter) });
}

export async function handle(request: Request, routes: Routes): Promise<Response> {
  const limit = routes.limit ?? (async () => ({ ok: true, retryAfter: 0 }));
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const origin = request.headers.get('Origin');
  const allowed = originAllowed(origin, routes.origins);
  const headers = allowed && origin !== null ? cors(origin) : {};

  if (path === '/health') return json(200, { ok: true }, { 'Access-Control-Allow-Origin': '*' });

  const match = /^\/rooms(?:\/([^/]+)(\/ws)?)?$/.exec(path);
  if (match === null) return json(404, { error: 'notFound' }, headers);
  const [, rawCode, ws] = match;

  if (request.method === 'OPTIONS') {
    return allowed ? new Response(null, { status: 204, headers }) : json(403, { error: 'origin' });
  }

  // WebSocket upgrade: /rooms/:code/ws
  if (ws !== undefined) {
    if (request.method !== 'GET') return json(405, { error: 'method' }, headers);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json(426, { error: 'upgrade' }, headers);
    if (!allowed) return json(403, { error: 'origin' });
    const code = normalizeCode(rawCode ?? '');
    if (code === null || code !== rawCode) return json(404, { error: 'notFound' });
    const limited = await limit('connect', request);
    if (!limited.ok) return tooMany(limited, {});
    return routes.room(code).fetch(request);
  }

  // Probe: GET /rooms/:code
  if (rawCode !== undefined) {
    if (request.method !== 'GET') return json(405, { error: 'method' }, headers);
    if (!allowed) return json(403, { error: 'origin' });
    const code = rawCode.length === CODE_LENGTH ? normalizeCode(rawCode) : null;
    if (code === null || code !== rawCode) return json(404, { error: 'notFound' }, headers);
    const limited = await limit('connect', request);
    if (!limited.ok) return tooMany(limited, headers);
    return json(200, { code, exists: await routes.room(code).exists() }, headers);
  }

  // Create: POST /rooms
  if (request.method !== 'POST') return json(405, { error: 'method' }, headers);
  if (!allowed) return json(403, { error: 'origin' });
  const limited = await limit('create', request);
  if (!limited.ok) return tooMany(limited, headers);
  const hostId = await readHostId(request);
  if (hostId === undefined) return json(400, { error: 'body' }, headers);
  const newCode = routes.newCode ?? newRoomCode;
  for (let i = 0; i < CREATE_TRIES; i++) {
    const code = newCode();
    if (await routes.room(code).create(hostId)) return json(201, { code }, headers);
  }
  return json(503, { error: 'busy' }, headers);
}
