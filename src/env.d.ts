interface ImportMetaEnv {
  /** The room server, e.g. wss://trio-game.cylfox.workers.dev. Unset: peer-to-peer only. */
  readonly VITE_ROOM_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
