/**
 * Small Svelte helpers: element registration attachments, and enter / leave animations in the
 * mockup's motion language. These run Web Animations directly (like the mockup) rather than Svelte
 * transitions, so they start at once and never stall behind a busy frame.
 */
import { EASE, T, anim } from '../game/motion.ts';

/** `{@attach into(map, key)}`: keep an element in a map while it is mounted. */
export function into(map: Map<string, HTMLElement>, key: string) {
  return (el: HTMLElement) => {
    map.set(key, el);
    return () => {
      if (map.get(key) === el) map.delete(key);
    };
  };
}

/** `{@attach ref((el) => (x = el))}`: a setter called with the element, then null. */
export function ref(set: (el: HTMLElement | null) => void) {
  return (el: HTMLElement) => {
    set(el);
    return () => set(null);
  };
}

const ENTER = {
  /** Banners and toasts: drop in with a little overshoot. */
  pop: {
    kf: [
      { transform: 'translateY(-14px) scale(.9)', opacity: 0 },
      { transform: 'translateY(2px) scale(1.03)', opacity: 1, offset: 0.6 },
      { transform: 'none', opacity: 1 },
    ],
    ms: 300,
    easing: 'ease-out',
  },
  /** A screen appearing (the mockup's show()). */
  screen: {
    kf: [
      { opacity: 0, transform: 'translateY(10px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    ms: 280,
    easing: EASE.out,
  },
  /** A modal card. */
  modal: {
    kf: [
      { transform: 'scale(.85)', opacity: 0 },
      { transform: 'scale(1.03)', opacity: 1, offset: 0.6 },
      { transform: 'none', opacity: 1 },
    ],
    ms: 260,
    easing: 'ease-out',
  },
  /** The tip bubble over SET! (it is centred with translateX(-50%)). */
  tip: {
    kf: [
      { transform: 'translateX(-50%) translateY(6px) scale(.7)', opacity: 0 },
      { transform: 'translateX(-50%) scale(1.05)', opacity: 1, offset: 0.6 },
      { transform: 'translateX(-50%) scale(1)', opacity: 1 },
    ],
    ms: 260,
    easing: 'ease-out',
  },
} as const satisfies Record<string, { kf: Keyframe[]; ms: number; easing: string }>;

/** `{@attach enter('pop')}`: animate the element in when it mounts. */
export function enter(kind: keyof typeof ENTER) {
  return (el: HTMLElement) => {
    const e = ENTER[kind];
    void anim(el, e.kf, { duration: T(e.ms), easing: e.easing });
  };
}

/** Fade up and away; resolves when done. */
export function leave(el: Element | null | undefined): Promise<void> {
  return anim(
    el,
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translateY(-8px) scale(.96)' },
    ],
    { duration: T(200), fill: 'forwards' },
  );
}
