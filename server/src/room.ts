/**
 * The Room Durable Object: one per room code (env.ROOM.idFromName(code)). Cloudflare glue only;
 * the room's behaviour is RoomHost (room-host.ts), and its rules are room-core.ts.
 *
 * WebSocket Hibernation API: sockets are accepted with ctx.acceptWebSocket, so the object can be
 * evicted from memory between messages while the sockets stay open. Each socket's attachment
 * ({ peer, playerId }) survives that; the room itself is in SQLite-backed storage (sync KV), saved
 * after every change. On wake-up the constructor runs again and RoomHost rebuilds from both.
 * 'ping' is answered with 'pong' by the runtime (auto-response), without waking the object.
 */
import { DurableObject } from 'cloudflare:workers';
import { RoomHost } from './room-host.ts';

export class Room extends DurableObject<Env> {
  private host: RoomHost | null = null;
  private alarmAtWake: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      this.alarmAtWake = await ctx.storage.getAlarm();
    });
  }

  private room(): RoomHost {
    this.host ??= new RoomHost({
      storage: {
        get: (key) => this.ctx.storage.kv.get(key),
        put: (key, value) => this.ctx.storage.kv.put(key, value),
        deleteAll: () => void this.ctx.storage.deleteAll().catch((error: unknown) => console.error('deleteAll failed', error)),
        setAlarm: (at) => void this.ctx.storage.setAlarm(at).catch((error: unknown) => console.error('setAlarm failed', error)),
      },
      sockets: () => this.ctx.getWebSockets(),
      alarm: this.alarmAtWake,
    });
    return this.host;
  }

  /** RPC from the Worker: claim this room for a new game. false: the code is in use. */
  create(code: string, hostId: string | null): boolean {
    return this.room().create(code, hostId);
  }

  /** RPC from the Worker: is there a room here? */
  exists(): boolean {
    return this.room().exists();
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade', { status: 426 });
    const room = this.room();
    if (!room.canAccept()) return new Response('Too many connections', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    room.connect(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    this.room().message(ws, message);
  }

  // From compatibility date 2026-04-07 the runtime answers the peer's Close frame itself.
  override webSocketClose(ws: WebSocket): void {
    this.room().closed(ws);
  }

  override webSocketError(ws: WebSocket): void {
    this.room().closed(ws);
  }

  override alarm(): void {
    this.room().alarm();
  }
}
