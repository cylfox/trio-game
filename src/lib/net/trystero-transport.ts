/**
 * Transport over Trystero (WebRTC data channels, serverless signalling).
 *
 * Signalling strategy: Nostr, Trystero's default package (`trystero` re-exports
 * `@trystero-p2p/nostr`). Peers find each other through public Nostr relays (5 in parallel by
 * default) over WebSocket, so a static GitHub Pages site needs no server, account or API key. Of
 * the zero-config strategies it has the largest relay pool and a small bundle (~46 KB vs ~122 KB
 * for MQTT). Only the handshake goes through relays; game traffic is peer to peer.
 *
 * To swap strategies, change only the import below, e.g.
 *   npm i @trystero-p2p/mqtt     →  import { joinRoom } from '@trystero-p2p/mqtt'
 *   npm i @trystero-p2p/torrent  →  import { joinRoom } from '@trystero-p2p/torrent'
 * Strict NATs (some mobile carriers, corporate Wi-Fi) need a TURN relay: pass `turn`.
 */
import { joinRoom } from 'trystero';
import type { JsonValue, TurnServerConfig } from 'trystero';
import { listeners } from './transport.ts';
import type { Transport, TransportError } from './transport.ts';

/** Namespaces our rooms on the shared public relays. Change it to split incompatible builds. */
export const APP_ID = 'cylfox/trio-game';
/** One Trystero action carries every protocol message (namespace: 1–32 bytes). */
const CHANNEL = 'trio';

export interface TrysteroOptions {
  readonly turn?: TurnServerConfig[];
}

export function createTrysteroTransport(code: string, options: TrysteroOptions = {}): Transport {
  const room = joinRoom(
    {
      appId: APP_ID,
      // Our own player id (localStorage) is the identity that matters; a fresh Trystero key per
      // page avoids IndexedDB, which some private modes block.
      identity: 'none',
      ...(options.turn === undefined ? {} : { turnConfig: options.turn }),
    },
    code,
  );
  const channel = room.makeAction<JsonValue>(CHANNEL);
  const errors = listeners<[TransportError]>();
  const report = (error: unknown) =>
    errors.emit({ code: 'send-failed', message: error instanceof Error ? error.message : String(error) });

  room.onError((error) => errors.emit({ code: error.code, message: error.message }));

  return {
    send(to, message) {
      channel.send(message as JsonValue, { target: to }).catch(report);
    },
    broadcast(message) {
      channel.send(message as JsonValue).catch(report);
    },
    onMessage: (handler) => channel.onMessage((data, context) => handler(data, context.peerId)),
    onPeerJoin: (handler) => room.onPeerJoin(({ peerId }) => handler(peerId), { replay: true }),
    onPeerLeave: (handler) => room.onPeerLeave(({ peerId }) => handler(peerId)),
    onError: (handler) => errors.add(handler),
    async leave() {
      errors.clear();
      await room.leave();
    },
  };
}
