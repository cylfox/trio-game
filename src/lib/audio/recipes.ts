/**
 * Every game sound as data: short chiptune voices for a tiny Web Audio synth (synth.ts).
 * No audio files. Times are seconds from the trigger; vol is a peak gain before the master bus
 * (kept ≤ 0.14 so overlapping sounds stay well under the limiter).
 *
 * Notes: equal temperament, A4 = 440 Hz.
 */

export type Wave = 'square' | 'triangle' | 'sawtooth' | 'sine' | 'noise';

export interface Tone {
  readonly wave: Wave;
  /** Start frequency (Hz). For noise: the playback rate (1 = as recorded). */
  readonly f: number;
  /** End frequency for a slide (exponential). */
  readonly f2?: number;
  /** Start offset (s). */
  readonly at: number;
  /** Length (s), attack included. */
  readonly dur: number;
  /** Peak gain. */
  readonly vol: number;
  /** Attack (s). Default 4 ms. */
  readonly attack?: number;
  readonly filter?: { readonly type: BiquadFilterType; readonly f: number; readonly f2?: number; readonly q?: number };
}

export const SOUND_NAMES = [
  'ui',
  'toggle',
  'deal',
  'flip',
  'select',
  'deselect',
  'nudge',
  'callMine',
  'callTheirs',
  'tick',
  'tickUrgent',
  'foundMine',
  'foundTheirs',
  'wrong',
  'timeout',
  'count',
  'shuffle',
  'hint',
  'newBest',
  'join',
  'leave',
  'error',
  'win',
  'lose',
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

/** Semitones from A4 → Hz. */
const n = (semitones: number): number => 440 * 2 ** (semitones / 12);
const C4 = n(-9);
const E4 = n(-5);
const G4 = n(-2);
const B4 = n(2);
const C5 = n(3);
const D5 = n(5);
const E5 = n(7);
const G5 = n(10);
const B5 = n(14);
const C6 = n(15);
const E6 = n(19);
const G6 = n(22);
const C7 = n(27);
const E7 = n(31);
const G7 = n(34);

const arp = (wave: Wave, notes: readonly number[], step: number, dur: number, vol: number, last = dur): Tone[] =>
  notes.map((f, i) => ({ wave, f, at: i * step, dur: i === notes.length - 1 ? last : dur, vol }));

export const RECIPES: Readonly<Record<SoundName, readonly Tone[]>> = {
  // UI press: a quick upward blip.
  ui: [{ wave: 'square', f: 520, f2: 760, at: 0, dur: 0.055, vol: 0.07 }],
  toggle: [
    { wave: 'square', f: 660, at: 0, dur: 0.045, vol: 0.06 },
    { wave: 'square', f: 990, at: 0.05, dur: 0.06, vol: 0.06 },
  ],
  // A card leaving the deck: a soft papery flick (quiet: twelve of them fly in a wave).
  deal: [
    { wave: 'noise', f: 1, at: 0, dur: 0.045, vol: 0.05, filter: { type: 'bandpass', f: 3200, q: 1.4 } },
    { wave: 'triangle', f: 1700, f2: 900, at: 0, dur: 0.03, vol: 0.012 },
  ],
  flip: [
    { wave: 'noise', f: 1.2, at: 0, dur: 0.03, vol: 0.03, filter: { type: 'highpass', f: 2400 } },
    { wave: 'square', f: 1400, f2: 1050, at: 0, dur: 0.024, vol: 0.018 },
  ],
  select: [{ wave: 'square', f: 880, f2: 1320, at: 0, dur: 0.05, vol: 0.06 }],
  deselect: [{ wave: 'square', f: 990, f2: 660, at: 0, dur: 0.05, vol: 0.05 }],
  // Tapped a card before calling: a dull bonk.
  nudge: [
    { wave: 'triangle', f: 250, f2: 170, at: 0, dur: 0.09, vol: 0.13 },
    { wave: 'square', f: 125, at: 0, dur: 0.045, vol: 0.03, filter: { type: 'lowpass', f: 900 } },
  ],
  // Your SET!: a punchy power-up (rising sweep + arpeggio).
  callMine: [
    { wave: 'sawtooth', f: 220, f2: 880, at: 0, dur: 0.2, vol: 0.05, filter: { type: 'lowpass', f: 900, f2: 3200 } },
    ...arp('square', [C5, E5, G5, C6], 0.045, 0.07, 0.09, 0.18),
  ],
  // The opponent's SET!: an alert (high-low-high).
  callTheirs: [
    { wave: 'square', f: B5, at: 0, dur: 0.085, vol: 0.08 },
    { wave: 'square', f: G5, at: 0.1, dur: 0.085, vol: 0.08 },
    { wave: 'square', f: B5, at: 0.2, dur: 0.13, vol: 0.08 },
    { wave: 'triangle', f: B4, at: 0, dur: 0.33, vol: 0.05 },
  ],
  tick: [{ wave: 'square', f: 1150, at: 0, dur: 0.018, vol: 0.03, filter: { type: 'lowpass', f: 2600 } }],
  tickUrgent: [
    { wave: 'square', f: 1600, at: 0, dur: 0.03, vol: 0.06 },
    { wave: 'square', f: 800, at: 0, dur: 0.03, vol: 0.035 },
  ],
  // Your set: a bright coin chime with a sparkle on top.
  foundMine: [
    { wave: 'square', f: B5, at: 0, dur: 0.06, vol: 0.09 },
    { wave: 'square', f: E6, at: 0.06, dur: 0.3, vol: 0.09 },
    ...arp('triangle', [C6, E6, G6, C7], 0.045, 0.08, 0.05, 0.2).map((t) => ({ ...t, at: t.at + 0.03 })),
  ],
  // The opponent's set: the same idea, lower and softer.
  foundTheirs: arp('triangle', [G4, B4, D5, G5], 0.06, 0.09, 0.1, 0.2),
  wrong: [
    { wave: 'sawtooth', f: 140, f2: 68, at: 0, dur: 0.26, vol: 0.12, filter: { type: 'lowpass', f: 700 } },
    { wave: 'square', f: 73, at: 0, dur: 0.2, vol: 0.05, filter: { type: 'lowpass', f: 500 } },
  ],
  // TIME!: a descending wah.
  timeout: [
    { wave: 'square', f: 660, f2: 150, at: 0, dur: 0.55, vol: 0.09, filter: { type: 'lowpass', f: 2600, f2: 380, q: 6 } },
    { wave: 'triangle', f: 330, f2: 80, at: 0, dur: 0.55, vol: 0.06 },
  ],
  count: [{ wave: 'square', f: 1320, at: 0, dur: 0.025, vol: 0.035 }],
  // No set on the table: a little shuffle ripple.
  shuffle: [0, 0.05, 0.1, 0.15, 0.2].map((at, i) => ({
    wave: 'noise' as const,
    f: 0.9 + i * 0.08,
    at,
    dur: 0.04,
    vol: 0.04,
    filter: { type: 'bandpass' as const, f: 2400 + i * 300, q: 1.2 },
  })),
  hint: arp('triangle', [C7, E7, G7], 0.05, 0.08, 0.045, 0.16),
  newBest: [
    ...arp('square', [G5, C6, E6], 0.08, 0.08, 0.07),
    { wave: 'square', f: G6, at: 0.24, dur: 0.34, vol: 0.08 },
    { wave: 'triangle', f: C6, at: 0.24, dur: 0.34, vol: 0.05 },
    { wave: 'triangle', f: E6, at: 0.24, dur: 0.34, vol: 0.04 },
  ],
  join: [
    { wave: 'square', f: G5, at: 0, dur: 0.07, vol: 0.06 },
    { wave: 'square', f: D5 * 2, at: 0.08, dur: 0.12, vol: 0.06 },
  ],
  leave: [
    { wave: 'square', f: G5, at: 0, dur: 0.07, vol: 0.06 },
    { wave: 'square', f: C5, at: 0.08, dur: 0.14, vol: 0.06 },
  ],
  error: [
    { wave: 'square', f: 220, at: 0, dur: 0.09, vol: 0.07, filter: { type: 'lowpass', f: 1200 } },
    { wave: 'square', f: 196, at: 0.12, dur: 0.15, vol: 0.07, filter: { type: 'lowpass', f: 1200 } },
  ],
  // Game over, you won (or drew): a short fanfare.
  win: [
    ...arp('square', [C5, E5, G5], 0.1, 0.09, 0.07),
    { wave: 'square', f: C6, at: 0.3, dur: 0.5, vol: 0.08 },
    { wave: 'triangle', f: C4, at: 0.3, dur: 0.5, vol: 0.06 },
    { wave: 'triangle', f: G4, at: 0.3, dur: 0.5, vol: 0.05 },
    { wave: 'triangle', f: E6, at: 0.42, dur: 0.38, vol: 0.035 },
  ],
  // Game over, you lost: a soft falling cadence.
  lose: [
    { wave: 'triangle', f: G4, at: 0, dur: 0.16, vol: 0.1 },
    { wave: 'triangle', f: E4, at: 0.18, dur: 0.16, vol: 0.1 },
    { wave: 'triangle', f: C4, at: 0.36, dur: 0.45, vol: 0.1 },
    { wave: 'square', f: C5, at: 0.36, dur: 0.3, vol: 0.02, filter: { type: 'lowpass', f: 900 } },
  ],
};

/** Random pitch spread per sound (± fraction), so repeats don't grate. */
export const JITTER: Readonly<Partial<Record<SoundName, number>>> = {
  ui: 0.03,
  deal: 0.1,
  flip: 0.08,
  select: 0.03,
  deselect: 0.03,
  nudge: 0.04,
  tick: 0.01,
  count: 0,
  shuffle: 0.06,
  hint: 0.02,
  wrong: 0.03,
};

/** Seconds until the last voice of a sound ends. */
export function soundLength(name: SoundName): number {
  return Math.max(...RECIPES[name].map((t) => t.at + t.dur));
}
