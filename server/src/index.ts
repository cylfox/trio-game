/**
 * The Trio room server (Cloudflare Worker "trio-game"). Routes: src/http.ts. One Room Durable
 * Object per room code (src/room.ts), one Limiter per client IP (src/limiter.ts).
 */
import { handle } from './http.ts';
import { SlidingWindows, clientIp, createLimiter } from './rate-limit.ts';

export { Limiter } from './limiter.ts';
export { Room } from './room.ts';

/** Layer 1 of the rate limits: this isolate's memory, shared by its requests. */
const local = new SlidingWindows();

export default {
  fetch(request, env) {
    const limiter = createLimiter({ local, remote: (kind, key) => env.LIMITER.getByName(key).hit(kind) });
    return handle(request, {
      origins: env.ALLOWED_ORIGINS ?? '',
      limit: (kind, req) => limiter(kind, clientIp(req)),
      room: (code) => {
        const stub = env.ROOM.getByName(code);
        return {
          create: (hostId) => stub.create(code, hostId),
          exists: () => stub.exists(),
          fetch: (req) => stub.fetch(req),
        };
      },
    });
  },
} satisfies ExportedHandler<Env>;
