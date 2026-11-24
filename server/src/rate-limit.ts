/**
 * Per-IP rate limits for the costly routes: creating rooms, and joining (the existence probe and
 * the WebSocket upgrade). Over the limit: 429 with Retry-After. The client treats a 429 as "server
 * unavailable" and falls back to a peer-to-peer room.
 *
 * Two layers:
 *   1. this isolate's memory (free, instant): stops a single script hammering one isolate without
 *      costing a Durable Object request per refused call;
 *   2. a Limiter Durable Object per (hashed) IP: the strict count, the same in every Cloudflare
 *      location and isolate. If it fails, we let the request through (fail open): the room itself
 *      is the thing to protect, and on the free plan an exhausted quota errors rather than bills.
 *
 * Why not the Workers Rate Limiting binding (`ratelimits`): its docs don't say it is on the Free
 * plan, its counts are approximate and per location, and they recommend Durable Objects for one
 * strict limit. Swapping it in later only means replacing `remote` below.
 */

export type LimitKind = 'create' | 'connect';

export interface LimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

export const RATE_LIMITS: Readonly<Record<LimitKind, LimitRule>> = {
  /** POST /rooms. A real player creates a handful of rooms a minute at most. */
  create: { limit: 10, windowMs: 60_000 },
  /** GET /rooms/:code and /rooms/:code/ws. Reconnects back off to 10 s, so well under this. */
  connect: { limit: 30, windowMs: 60_000 },
};

export interface LimitResult {
  readonly ok: boolean;
  /** Seconds until the next call would be allowed (0 when ok). */
  readonly retryAfter: number;
}

const OK: LimitResult = { ok: true, retryAfter: 0 };

/**
 * Sliding-window log per key: the times of the calls allowed in the last window. Refused calls
 * aren't recorded, so a client that stops hammering is let back in one window later. Memory is
 * bounded: at most `maxKeys` keys, the least recently used dropped first.
 */
export class SlidingWindows {
  private readonly rules: Readonly<Record<LimitKind, LimitRule>>;
  private readonly maxKeys: number;
  private readonly log = new Map<string, number[]>();

  constructor(rules: Readonly<Record<LimitKind, LimitRule>> = RATE_LIMITS, maxKeys = 5000) {
    this.rules = rules;
    this.maxKeys = maxKeys;
  }

  hit(kind: LimitKind, key: string, now: number): LimitResult {
    const rule = this.rules[kind];
    const id = `${kind}:${key}`;
    const recent = (this.log.get(id) ?? []).filter((t) => t > now - rule.windowMs);
    this.log.delete(id); // re-inserted below: Map order = least recently used first
    if (recent.length >= rule.limit) {
      this.log.set(id, recent);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((recent[0] + rule.windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.log.set(id, recent);
    while (this.log.size > this.maxKeys) {
      const oldest = this.log.keys().next().value;
      if (oldest === undefined) break;
      this.log.delete(oldest);
    }
    return OK;
  }

  get size(): number {
    return this.log.size;
  }
}

/** The client's IP, hashed (Durable Object names and memory never hold raw addresses). */
export async function ipKey(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`trio-game:${ip}`));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The caller's IP: Cloudflare sets CF-Connecting-IP on every request (clients can't forge it). */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

export interface LimiterOptions {
  /** This isolate's windows (layer 1). */
  readonly local: SlidingWindows;
  /** The strict count (layer 2): the Limiter Durable Object for this key. */
  readonly remote: (kind: LimitKind, key: string) => Promise<LimitResult>;
  readonly clock?: () => number;
  readonly log?: (message: string, error: unknown) => void;
}

/** (kind, IP) → allowed? Layer 1, then layer 2; fails open if layer 2 is unavailable. */
export function createLimiter(options: LimiterOptions): (kind: LimitKind, ip: string) => Promise<LimitResult> {
  const clock = options.clock ?? (() => Date.now());
  const log = options.log ?? ((message, error) => console.error(message, error));
  return async (kind, ip) => {
    const key = await ipKey(ip);
    const local = options.local.hit(kind, key, clock());
    if (!local.ok) return local;
    try {
      return await options.remote(kind, key);
    } catch (error) {
      log('rate limiter unavailable, letting the request through', error);
      return OK;
    }
  };
}
