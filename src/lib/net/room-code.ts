/**
 * Room codes: 4 characters from an alphabet without look-alikes (no 0/O, 1/I/L).
 * 31⁴ ≈ 923k codes. The invite link is `<app url>#CODE`.
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;

/** Bytes in [0, 248) map evenly onto 31 symbols (248 = 31 × 8); the rest are redrawn. */
const UNBIASED_LIMIT = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;

export type RandomBytes = (count: number) => Uint8Array;

const cryptoBytes: RandomBytes = (count) => crypto.getRandomValues(new Uint8Array(count));

export function newRoomCode(randomBytes: RandomBytes = cryptoBytes): string {
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const b of randomBytes(CODE_LENGTH * 2)) {
      if (b < UNBIASED_LIMIT && code.length < CODE_LENGTH) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return code;
}

/**
 * Accepts what people type or paste: any case, spaces or dashes, a leading '#', or a whole invite
 * link. Returns the canonical code, or null if it is not a valid code.
 */
export function normalizeCode(input: string): string | null {
  const hash = input.lastIndexOf('#');
  const raw = (hash >= 0 ? input.slice(hash + 1) : input).toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== CODE_LENGTH) return null;
  for (const ch of raw) if (!CODE_ALPHABET.includes(ch)) return null;
  return raw;
}

/** The room code in a location hash ('#K7QX'), or null. */
export function codeFromHash(hash: string): string | null {
  return hash.length > 1 ? normalizeCode(hash) : null;
}

/** `<appUrl>#CODE`, where appUrl is the app's root (e.g. https://cylfox.github.io/trio-game/). */
export function inviteLink(appUrl: string, code: string): string {
  const url = new URL(appUrl);
  url.hash = code;
  url.search = '';
  return url.href;
}
