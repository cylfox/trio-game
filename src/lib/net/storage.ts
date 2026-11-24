/**
 * Small persistent bits, all in localStorage and all optional: storage can be blocked (private
 * mode, embedded views) or full, so every access is wrapped and falls back to memory.
 *   trio:player       { id, name }   who this browser is, kept across rooms and reloads
 *   trio:room:CODE    SavedRoom      the host's room, saved after every change
 */
import { cleanName } from './protocol.ts';
import { isSavedRoom } from './room-core.ts';
import type { Identity, SavedRoom } from './room-core.ts';

export type { Identity, SavedRoom, SavedSeat } from './room-core.ts';

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}

/** localStorage when it works; otherwise (and additionally) an in-memory copy for this page. */
export function browserStore(): KeyValueStore {
  const memory = memoryStore();
  const local = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      try {
        const value = local()?.getItem(key);
        if (value !== undefined && value !== null) return value;
      } catch {
        // fall through to memory
      }
      return memory.get(key);
    },
    set(key, value) {
      memory.set(key, value);
      try {
        local()?.setItem(key, value);
      } catch {
        // quota or blocked: memory only
      }
    },
    remove(key) {
      memory.remove(key);
      try {
        local()?.removeItem(key);
      } catch {
        // ignore
      }
    },
    keys() {
      const keys = new Set(memory.keys());
      try {
        const storage = local();
        if (storage !== null) for (let i = 0; i < storage.length; i++) keys.add(storage.key(i) ?? '');
      } catch {
        // ignore
      }
      keys.delete('');
      return [...keys];
    },
  };
}

function readJson(store: KeyValueStore, key: string): unknown {
  const raw = store.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Identity ─────────────────────────────────────────────────────────────────────────────────

const PLAYER_KEY = 'trio:player';

export function newPlayerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, '0')).join('-');
}

export function loadIdentity(store: KeyValueStore): Identity {
  const saved = readJson(store, PLAYER_KEY);
  if (saved !== null && typeof saved === 'object') {
    const { id, name } = saved as Record<string, unknown>;
    if (typeof id === 'string' && id.length >= 8 && id.length <= 64) return { id, name: cleanName(name) };
  }
  const fresh: Identity = { id: newPlayerId(), name: '' };
  store.set(PLAYER_KEY, JSON.stringify(fresh));
  return fresh;
}

export function saveName(store: KeyValueStore, name: string): Identity {
  const identity = { ...loadIdentity(store), name: cleanName(name) };
  store.set(PLAYER_KEY, JSON.stringify(identity));
  return identity;
}

// ── The host's room ──────────────────────────────────────────────────────────────────────────

/** Saved rooms older than this are ignored and pruned. */
export const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

const roomKey = (code: string) => `trio:room:${code}`;

/** The saved room for `code` if this browser hosts it (and it is not stale). */
export function loadRoom(store: KeyValueStore, code: string, now: number): SavedRoom | null {
  const saved = readJson(store, roomKey(code));
  if (!isSavedRoom(saved, code)) return null;
  if (now - saved.savedAt > ROOM_TTL_MS) {
    store.remove(roomKey(code));
    return null;
  }
  return saved;
}

export function saveRoom(store: KeyValueStore, room: SavedRoom): void {
  store.set(roomKey(room.code), JSON.stringify(room));
}

export function forgetRoom(store: KeyValueStore, code: string): void {
  store.remove(roomKey(code));
}

/** Drop saved rooms past their TTL. */
export function pruneRooms(store: KeyValueStore, now: number): void {
  for (const key of store.keys()) {
    if (!key.startsWith('trio:room:')) continue;
    const code = key.slice('trio:room:'.length);
    if (loadRoom(store, code, now) === null) store.remove(key);
  }
}
