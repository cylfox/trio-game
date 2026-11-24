/**
 * Browser wiring for open.ts: server rooms are a guest session over a WebSocket; P2P rooms load
 * Trystero (connect.ts) on demand, so server-mode players never download it unless they fall back.
 */
import { createGuest } from './guest.ts';
import type { OpenDeps, ServerUrls } from './open.ts';
import type { Identity } from './room-core.ts';
import type { KeyValueStore } from './storage.ts';
import { createWebSocketTransport } from './ws-transport.ts';

export function browserOpenDeps(server: ServerUrls | null, me: Identity, store: KeyValueStore): OpenDeps {
  return {
    server,
    fetch: (input, init) => fetch(input, init),
    openServer(code) {
      if (server === null) throw new Error('no room server configured');
      const transport = createWebSocketTransport(`${server.ws}/rooms/${encodeURIComponent(code)}/ws`);
      return createGuest({ transport, code, me });
    },
    async openP2P(code) {
      const { openRoom } = await import('./connect.ts');
      return openRoom(code, me, store);
    },
  };
}
