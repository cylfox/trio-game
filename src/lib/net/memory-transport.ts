/**
 * In-memory Transport for tests: every peer joins one hub. Nothing is delivered until flush(), and
 * flush() delivers in one global FIFO order, so a test decides exactly what arrives first.
 * Messages go through JSON, like the real wire.
 */
import { listeners } from './transport.ts';
import type { Listeners, Transport, TransportError } from './transport.ts';

export interface MemoryTransport extends Transport {
  readonly peerId: string;
}

export interface MemoryHub {
  /** Connect a new peer. Existing peers and the newcomer learn about each other on flush(). */
  join(peerId: string): MemoryTransport;
  /** Deliver everything queued, including what deliveries queue in turn. */
  flush(): void;
  /** Queued deliveries. */
  pending(): number;
  /** Deliver a raw message as if `from` sent it (e.g. a replayed or forged message). */
  inject(to: string, from: string, message: unknown): void;
  /** Lose the next queued delivery to `to` (a dropped packet). Returns false if there is none. */
  drop(to: string): boolean;
}

interface Endpoint {
  readonly message: Listeners<[unknown, string]>;
  readonly join: Listeners<[string]>;
  readonly leave: Listeners<[string]>;
  readonly error: Listeners<[TransportError]>;
}

export function createMemoryHub(): MemoryHub {
  const peers = new Map<string, Endpoint>();
  const queue: Array<{ readonly to: string; readonly run: () => void }> = [];

  const deliver = (to: string, fn: (endpoint: Endpoint) => void) => {
    queue.push({
      to,
      run: () => {
        const endpoint = peers.get(to);
        if (endpoint !== undefined) fn(endpoint);
      },
    });
  };

  return {
    join(peerId) {
      if (peers.has(peerId)) throw new Error(`peer ${peerId} already joined`);
      const endpoint: Endpoint = {
        message: listeners<[unknown, string]>(),
        join: listeners<[string]>(),
        leave: listeners<[string]>(),
        error: listeners<[TransportError]>(),
      };
      for (const other of peers.keys()) {
        deliver(other, (e) => e.join.emit(peerId));
        deliver(peerId, (e) => e.join.emit(other));
      }
      peers.set(peerId, endpoint);
      const post = (to: string, message: unknown) => {
        const wire = JSON.stringify(message);
        deliver(to, (e) => e.message.emit(JSON.parse(wire), peerId));
      };
      return {
        peerId,
        send(to, message) {
          if (peers.get(peerId) === endpoint && to !== peerId) post(to, message);
        },
        broadcast(message) {
          if (peers.get(peerId) !== endpoint) return;
          for (const other of peers.keys()) if (other !== peerId) post(other, message);
        },
        onMessage: (h) => endpoint.message.add(h),
        onPeerJoin: (h) => endpoint.join.add(h),
        onPeerLeave: (h) => endpoint.leave.add(h),
        onError: (h) => endpoint.error.add(h),
        async leave() {
          if (peers.get(peerId) !== endpoint) return;
          peers.delete(peerId);
          for (const other of peers.keys()) deliver(other, (e) => e.leave.emit(peerId));
        },
      };
    },
    flush() {
      for (let guard = 0; queue.length > 0; guard++) {
        if (guard > 100_000) throw new Error('memory hub: delivery loop');
        queue.shift()?.run();
      }
    },
    pending: () => queue.length,
    inject(to, from, message) {
      const wire = JSON.stringify(message);
      deliver(to, (e) => e.message.emit(JSON.parse(wire), from));
    },
    drop(to) {
      const index = queue.findIndex((d) => d.to === to);
      if (index < 0) return false;
      queue.splice(index, 1);
      return true;
    },
  };
}
