/**
 * Animation helpers shared by the table and the screens (browser only).
 * Reduced motion: durations are capped (T) and staggers / dramatic delays drop to 0 (S).
 */

const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
let reduced = query?.matches ?? false;
query?.addEventListener?.('change', (e) => {
  reduced = e.matches;
});

export function reducedMotion(): boolean {
  return reduced;
}

/** Animation duration: short under reduced motion. */
export const T = (ms: number): number => (reduced ? Math.min(ms, 140) : ms);
/** Stagger or dramatic delay: none under reduced motion. */
export const S = (ms: number): number => (reduced ? 0 : ms);

export const EASE = {
  land: 'cubic-bezier(.2, 1.3, .4, 1)',
  spring: 'cubic-bezier(.34, 1.56, .64, 1)',
  out: 'cubic-bezier(.2, .8, .2, 1)',
  retire: 'cubic-bezier(.5, -0.45, .7, .7)',
} as const;

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** Web Animations, resolving when done (or at once where unsupported). Never rejects. */
export function anim(el: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (el === null || el === undefined || typeof el.animate !== 'function') return Promise.resolve();
  try {
    const a = el.animate(keyframes, options);
    return a.finished.then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

/** Restart a CSS class animation (remove, reflow, add). */
export function replayClass(el: HTMLElement | null | undefined, cls: string, removeAfterMs?: number): void {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  if (removeAfterMs !== undefined) setTimeout(() => el.classList.remove(cls), removeAfterMs);
}

export const ROLL_KF: Keyframe[] = [
  { transform: 'translateY(45%) scale(.7)', opacity: 0.2 },
  { transform: 'translateY(-12%) scale(1.4) rotate(-5deg)', opacity: 1, offset: 0.45 },
  { transform: 'translateY(0) scale(1)', opacity: 1 },
];

export function rollIn(el: Element | null | undefined): void {
  void anim(el, ROLL_KF, { duration: T(460), easing: 'ease-out' });
}

export function wiggle(el: Element | null | undefined): void {
  void anim(
    el,
    [
      { transform: 'rotate(0)' },
      { transform: 'rotate(-5deg) scale(1.05)' },
      { transform: 'rotate(5deg) scale(1.05)' },
      { transform: 'rotate(-3deg)' },
      { transform: 'rotate(2deg)' },
      { transform: 'rotate(0)' },
    ],
    { duration: T(460), easing: 'ease-out' },
  );
}

export function popIn(el: Element | null | undefined, delay = 0): void {
  void anim(
    el,
    [
      { transform: 'scale(.7)', opacity: 0 },
      { transform: 'scale(1.06)', opacity: 1, offset: 0.6 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: T(320), delay: S(delay), easing: 'ease-out', fill: 'backwards' },
  );
}
