/**
 * The network as the sessions see it: a room of peers that can message each other. Messages are
 * plain JSON. Implementations: one WebSocket to the room server, whose only peer is the server
 * (ws-transport.ts); Trystero/WebRTC for P2P rooms (trystero-transport.ts); and an in-memory hub
 * for tests (memory-transport.ts).
 */
export type Unsubscribe = () => void;

export interface TransportError {
  /** e.g. 'relay-failed', 'peer-connect-failed' (Trystero RoomError codes). */
  readonly code: string;
  readonly message: string;
}

export interface Transport {
  /** Send to one peer. Fire and forget; a peer that is gone simply never gets it. */
  send(to: string, message: unknown): void;
  /** Send to every connected peer. */
  broadcast(message: unknown): void;
  onMessage(handler: (message: unknown, from: string) => void): Unsubscribe;
  /** A peer (one browser tab) connected. */
  onPeerJoin(handler: (peerId: string) => void): Unsubscribe;
  onPeerLeave(handler: (peerId: string) => void): Unsubscribe;
  onError(handler: (error: TransportError) => void): Unsubscribe;
  leave(): Promise<void>;
}

export interface Listeners<A extends unknown[]> {
  add(fn: (...args: A) => void): Unsubscribe;
  emit(...args: A): void;
  clear(): void;
}

/** A tiny listener set shared by transports and sessions. */
export function listeners<A extends unknown[]>(): Listeners<A> {
  const set = new Set<(...args: A) => void>();
  return {
    add(fn: (...args: A) => void): Unsubscribe {
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(...args: A): void {
      for (const fn of [...set]) fn(...args);
    },
    clear(): void {
      set.clear();
    },
  };
}
