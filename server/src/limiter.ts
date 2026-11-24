/**
 * The Limiter Durable Object: one per hashed client IP (env.LIMITER.getByName(key)), holding that
 * IP's recent calls in memory. Nothing is stored: if the object is evicted after a quiet spell,
 * the count starts over, which is fine for limits measured per minute. See rate-limit.ts.
 */
import { DurableObject } from 'cloudflare:workers';
import { SlidingWindows } from './rate-limit.ts';
import type { LimitKind, LimitResult } from './rate-limit.ts';

export class Limiter extends DurableObject<Env> {
  private readonly windows = new SlidingWindows(undefined, 4);

  /** RPC: count one call of this kind for this object's IP. */
  hit(kind: LimitKind): LimitResult {
    return this.windows.hit(kind === 'create' ? 'create' : 'connect', 'ip', Date.now());
  }
}
