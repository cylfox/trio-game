/**
 * Build-time network config. VITE_ROOM_SERVER is the room server's base URL, e.g.
 * wss://trio-game.cylfox.workers.dev (.env.production) or ws://127.0.0.1:8787 (.env.development,
 * `npm run server:dev`). Unset or empty: peer-to-peer only (Trystero), as before.
 */
import { serverUrls } from './open.ts';
import type { ServerUrls } from './open.ts';

export const ROOM_SERVER: ServerUrls | null = serverUrls(import.meta.env.VITE_ROOM_SERVER);
