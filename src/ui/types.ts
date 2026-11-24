/**
 * Why a room can't connect: a WebRTC failure ('peer-connect-failed', P2P rooms), no answer at all,
 * or the room server can't be reached ('server').
 */
export type ConnectIssue = 'peer' | 'noAnswer' | 'server' | null;

/** The network a room uses (open.ts), and whether it is P2P because the server was unreachable. */
export interface RoomNet {
  readonly mode: 'server' | 'p2p';
  readonly fallback: boolean;
}
