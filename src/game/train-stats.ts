/**
 * Train statistics (pure): spot-time stats, personal bests and the per-call chart model.
 *
 * Spot time is measured by the UI: from "board ready" (the deal or refill has landed and the
 * cards are face up) to the SET! press. Pick time is from SET! to the third card (the engine's
 * pickMs). Sets found with a hint never count for spot stats or bests.
 */

export type TrainResult = 'set' | 'wrong' | 'time';

export interface TrainAttempt {
  /** Spot time (ms) for this call. */
  readonly spot: number;
  /** Pick time (ms): call → claim, or the whole countdown for a timeout. */
  readonly pick: number;
  readonly res: TrainResult;
  /** A set found after a hint (only ever true for res 'set'). */
  readonly hinted: boolean;
}

export interface TrainStats {
  readonly avg: number | null;
  readonly best: number | null;
  readonly median: number | null;
  readonly avgPick: number | null;
  /** Sets found with a hint. */
  readonly hinted: number;
  readonly sets: number;
  readonly wrong: number;
  readonly timeouts: number;
}

export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const isClean = (a: TrainAttempt) => a.res === 'set' && !a.hinted;

export function trainStats(attempts: readonly TrainAttempt[]): TrainStats {
  const clean = attempts.filter(isClean);
  const spots = clean.map((a) => a.spot);
  return {
    avg: mean(spots),
    best: spots.length === 0 ? null : Math.min(...spots),
    median: median(spots),
    avgPick: mean(clean.map((a) => a.pick)),
    hinted: attempts.filter((a) => a.res === 'set' && a.hinted).length,
    sets: attempts.filter((a) => a.res === 'set').length,
    wrong: attempts.filter((a) => a.res === 'wrong').length,
    timeouts: attempts.filter((a) => a.res === 'time').length,
  };
}

// ── Personal bests ───────────────────────────────────────────────────────────────────────────

export interface PersonalBest {
  /** Best average spot time over a full game (ms). */
  readonly avg: number | null;
  /** Best single spot time (ms). */
  readonly single: number | null;
}

export const NO_PB: PersonalBest = { avg: null, single: null };

const positive = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** Whatever was stored (or nothing) → a PersonalBest. Never throws. */
export function parsePB(raw: string | null): PersonalBest {
  if (raw === null) return NO_PB;
  try {
    const o: unknown = JSON.parse(raw);
    if (o !== null && typeof o === 'object') {
      const r = o as Record<string, unknown>;
      return { avg: positive(r.avg), single: positive(r.single) };
    }
  } catch {
    // corrupt: ignore
  }
  return NO_PB;
}

const minN = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));

/**
 * The run's results against the bests it started with. The average only counts for a full game
 * (played to the end). `pb` is what to store: the better of `stored` and this run.
 */
export function judgeRun(before: PersonalBest, stored: PersonalBest, stats: Pick<TrainStats, 'avg' | 'best'>, full: boolean) {
  const newSingle = stats.best !== null && (before.single === null || stats.best < before.single);
  const newAvg = full && stats.avg !== null && (before.avg === null || stats.avg < before.avg);
  const pb: PersonalBest = {
    avg: minN(stored.avg, newAvg ? stats.avg : null),
    single: minN(stored.single, newSingle ? stats.best : null),
  };
  return { newSingle, newAvg, pb };
}

/**
 * A clean set beats the best: this game's best once there is one, else the stored single best.
 * Returns false for the first set of a player with no stored best (nothing to beat yet).
 */
export function beatsBest(spot: number, gameBest: number | null, storedSingle: number | null): boolean {
  const ref = gameBest ?? storedSingle;
  return ref !== null && spot < ref;
}

// ── Chart ────────────────────────────────────────────────────────────────────────────────────

/** The smallest "nice" axis maximum (seconds) at or above `seconds`. */
export function niceMax(seconds: number): number {
  const steps = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 90, 120, 180, 240, 300, 600];
  for (const step of steps) if (seconds <= step) return step;
  return Math.ceil(seconds / 60) * 60;
}

export type BarKind = 'set' | 'best' | 'hint' | 'miss' | 'late';

export interface ChartBar {
  readonly index: number;
  readonly kind: BarKind;
  /** Bar height, 0..100 (% of the axis). */
  readonly height: number;
  readonly attempt: TrainAttempt;
}

export interface ChartModel {
  /** Axis maximum in seconds. */
  readonly axis: number;
  readonly bars: readonly ChartBar[];
  /** Legend entries in display order: 'set' always, the others when present. */
  readonly legend: readonly BarKind[];
}

/** Bars drawn to scale from 0 to a rounded axis maximum. null when there are no calls. */
export function chartModel(attempts: readonly TrainAttempt[]): ChartModel | null {
  if (attempts.length === 0) return null;
  const axis = niceMax(Math.max(...attempts.map((a) => a.spot)) / 1000);
  let bestIndex = -1;
  attempts.forEach((a, i) => {
    if (isClean(a) && (bestIndex < 0 || a.spot < attempts[bestIndex].spot)) bestIndex = i;
  });
  const kindOf = (a: TrainAttempt, i: number): BarKind =>
    a.res === 'wrong' ? 'miss' : a.res === 'time' ? 'late' : a.hinted ? 'hint' : i === bestIndex ? 'best' : 'set';
  const bars = attempts.map((attempt, index) => ({
    index,
    kind: kindOf(attempt, index),
    height: Math.max(0, Math.min(100, (attempt.spot / (axis * 1000)) * 100)),
    attempt,
  }));
  const kinds = new Set(bars.map((b) => b.kind));
  const legend = (['set', 'best', 'hint', 'miss', 'late'] as const).filter((k) => k === 'set' || kinds.has(k));
  return { axis, bars, legend };
}
