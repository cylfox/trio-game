/**
 * Small local preferences (localStorage through browserStore, which never throws):
 * the Train countdown and the Train personal bests. Plus haptics.
 */
import { browserStore } from '../lib/net/storage.ts';
import { NO_PB, parsePB } from './train-stats.ts';
import type { PersonalBest } from './train-stats.ts';

const store = browserStore();
const COUNT_KEY = 'trio:train-countdown';
const PB_KEY = 'trio:train-pb';

/** Seconds to pick after calling in Train; 0 = no limit. */
export const TRAIN_COUNTS = [3, 5, 8, 0] as const;
export type TrainCount = (typeof TRAIN_COUNTS)[number];

export function loadTrainCount(): TrainCount {
  const v = Number(store.get(COUNT_KEY));
  return (TRAIN_COUNTS as readonly number[]).includes(v) && store.get(COUNT_KEY) !== null ? (v as TrainCount) : 5;
}

export function saveTrainCount(n: TrainCount): void {
  store.set(COUNT_KEY, String(n));
}

export function loadPB(): PersonalBest {
  try {
    return parsePB(store.get(PB_KEY));
  } catch {
    return NO_PB;
  }
}

export function savePB(pb: PersonalBest): void {
  try {
    store.set(PB_KEY, JSON.stringify(pb));
  } catch {
    // storage is optional
  }
}

/** Buzz where supported (Android); a silent no-op elsewhere. */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    // Chrome refuses (and logs) vibration before the first real tap on the page.
    if (navigator.userActivation !== undefined && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate(pattern);
  } catch {
    // not allowed
  }
}
