/**
 * The app's sound: one shared synth with a persisted on/off switch (default on).
 *   play(name)        fire a sound (no-op while off, or before the first user gesture)
 *   installAudio()    unlock on the first gesture, suspend/resume with tab visibility
 */
import { browserStore } from '../net/storage.ts';
import { createSound } from './synth.ts';
import type { PlayOptions } from './synth.ts';
import type { SoundName } from './recipes.ts';

export type { SoundName } from './recipes.ts';
export { soundForEvent, tickFor } from './map.ts';

export const sound = createSound({ store: browserStore() });

export function play(name: SoundName, options?: PlayOptions): void {
  sound.play(name, options);
}

let installed = false;

export function installAudio(): () => void {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  // Only trusted gestures may start audio; untrusted ones would leave a suspended context.
  const unlock = (e: Event) => {
    if (e.isTrusted) sound.unlock();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') sound.resume();
    else sound.suspend();
  };
  const opts = { capture: true, passive: true } as const;
  document.addEventListener('pointerdown', unlock, opts);
  document.addEventListener('keydown', unlock, opts);
  document.addEventListener('touchend', unlock, opts);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    installed = false;
    document.removeEventListener('pointerdown', unlock, opts);
    document.removeEventListener('keydown', unlock, opts);
    document.removeEventListener('touchend', unlock, opts);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
