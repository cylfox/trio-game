/**
 * A tiny Web Audio synth for the game's chiptune effects, with an on/off switch that persists.
 *
 *   voices → master gain → compressor (limiter) → speakers
 *
 * The AudioContext is created on the first user gesture (iOS requires it) and resumed when the
 * tab is visible again. On iOS the audio session is set to "ambient" where supported, so the
 * silent switch is respected and the user's music keeps playing. Sounds are synthesised on the
 * fly (oscillators plus one pre-built noise buffer): no files, no decoding, low latency.
 */
import type { KeyValueStore } from '../net/storage.ts';
import { JITTER, RECIPES } from './recipes.ts';
import type { SoundName, Tone } from './recipes.ts';

export const SOUND_KEY = 'trio:sound';
/** Voices allowed at once; more are dropped (a 12-card deal wave stays light). */
const MAX_VOICES = 40;

export interface PlayOptions {
  /** Pitch multiplier (1 = as written). */
  readonly pitch?: number;
  /** Volume multiplier. */
  readonly vol?: number;
  /** Start later (s). */
  readonly delay?: number;
}

/** The parts of AudioContext the synth uses (a fake one in tests). */
export type AudioContextLike = Pick<
  AudioContext,
  'currentTime' | 'state' | 'destination' | 'sampleRate' | 'createGain' | 'createOscillator' | 'createBiquadFilter' | 'createBufferSource' | 'createBuffer' | 'createDynamicsCompressor' | 'resume' | 'suspend'
>;

export interface SoundOptions {
  readonly store: KeyValueStore;
  /** Makes the AudioContext; null where Web Audio is missing. */
  readonly createContext?: () => AudioContextLike | null;
  readonly random?: () => number;
}

export interface Sound {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  /** Call from a user gesture: creates or resumes the AudioContext. */
  unlock(): void;
  /** Tab hidden / visible. */
  suspend(): void;
  resume(): void;
  play(name: SoundName, options?: PlayOptions): void;
  /** Voices started so far (tests and diagnostics). */
  readonly voices: number;
}

function browserContext(): AudioContextLike | null {
  const Ctor =
    typeof AudioContext === 'function'
      ? AudioContext
      : (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (typeof Ctor !== 'function') return null;
  // Respect the iPhone silent switch and don't stop the user's music (Safari 17+).
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'ambient';
  } catch {
    // not supported
  }
  return new Ctor({ latencyHint: 'interactive' });
}

export function createSound(options: SoundOptions): Sound {
  const { store } = options;
  const random = options.random ?? Math.random;
  const makeContext = options.createContext ?? browserContext;
  let enabled = store.get(SOUND_KEY) !== 'off';
  let ctx: AudioContextLike | null = null;
  let out: AudioNode | null = null;
  let noise: AudioBuffer | null = null;
  let active = 0;
  let started = 0;
  let failed = false;

  function setup(): void {
    if (ctx !== null || failed) return;
    try {
      ctx = makeContext();
      if (ctx === null) {
        failed = true;
        return;
      }
      const master = ctx.createGain();
      master.gain.value = 0.7;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      master.connect(limiter);
      limiter.connect(ctx.destination);
      out = master;
      const length = Math.floor(ctx.sampleRate * 0.25);
      noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = random() * 2 - 1;
    } catch {
      failed = true;
      ctx = null;
    }
  }

  function voice(tone: Tone, t0: number, pitch: number, volume: number): void {
    if (ctx === null || out === null || active >= MAX_VOICES) return;
    const start = t0 + tone.at;
    const end = start + tone.dur;
    let source: AudioScheduledSourceNode;
    if (tone.wave === 'noise') {
      const b = ctx.createBufferSource();
      b.buffer = noise;
      b.playbackRate.value = tone.f * pitch;
      source = b;
    } else {
      const o = ctx.createOscillator();
      o.type = tone.wave;
      o.frequency.setValueAtTime(tone.f * pitch, start);
      if (tone.f2 !== undefined) o.frequency.exponentialRampToValueAtTime(tone.f2 * pitch, end);
      source = o;
    }
    const gain = ctx.createGain();
    const peak = Math.max(0.0002, Math.min(0.2, tone.vol * volume));
    const attack = Math.min(tone.attack ?? 0.004, tone.dur / 2);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    let node: AudioNode = source;
    if (tone.filter !== undefined) {
      const f = ctx.createBiquadFilter();
      f.type = tone.filter.type;
      f.frequency.setValueAtTime(tone.filter.f, start);
      if (tone.filter.f2 !== undefined) f.frequency.exponentialRampToValueAtTime(tone.filter.f2, end);
      if (tone.filter.q !== undefined) f.Q.value = tone.filter.q;
      source.connect(f);
      node = f;
    }
    node.connect(gain);
    gain.connect(out);
    active++;
    started++;
    source.onended = () => {
      active--;
      try {
        gain.disconnect();
      } catch {
        // already gone
      }
    };
    source.start(start);
    source.stop(end + 0.02);
  }

  return {
    get enabled() {
      return enabled;
    },
    get voices() {
      return started;
    },
    setEnabled(on) {
      enabled = on;
      store.set(SOUND_KEY, on ? 'on' : 'off');
      if (on) this.unlock();
    },
    unlock() {
      if (!enabled) return;
      setup();
      if (ctx !== null && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    suspend() {
      if (ctx !== null && ctx.state === 'running') ctx.suspend().catch(() => {});
    },
    resume() {
      if (ctx !== null && enabled && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    play(name, playOptions = {}) {
      if (!enabled || ctx === null || ctx.state === 'closed') return;
      try {
        const spread = JITTER[name] ?? 0.015;
        const pitch = (playOptions.pitch ?? 1) * (1 + (random() * 2 - 1) * spread);
        const t0 = ctx.currentTime + 0.005 + (playOptions.delay ?? 0);
        for (const tone of RECIPES[name]) voice(tone, t0, pitch, playOptions.vol ?? 1);
      } catch {
        // never let a sound break the game
      }
    },
  };
}
