/**
 * Phone lifecycle helpers (browser only): keep the screen on during a game, and catch up when the
 * tab comes back to the foreground.
 */

/** Calls `fn` whenever the page becomes visible again. Returns an unsubscribe. */
export function onVisible(fn: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible') fn();
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

export interface WakeLock {
  /** Want the screen kept on (true during a game). Failures are ignored. */
  set(active: boolean): void;
  destroy(): void;
}

/**
 * Screen Wake Lock, tolerant of everything: unsupported browsers, denied requests (low battery,
 * no user gesture yet) and the browser releasing the lock when the tab is hidden. It re-requests
 * when the tab is visible again.
 */
export function createWakeLock(): WakeLock {
  let wanted = false;
  let sentinel: WakeLockSentinel | null = null;
  let pending = false;

  async function acquire(): Promise<void> {
    if (!wanted || sentinel !== null || pending || document.visibilityState !== 'visible') return;
    if (!('wakeLock' in navigator)) return;
    pending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => {
        if (sentinel === lock) sentinel = null;
      });
      sentinel = lock;
      if (!wanted) release();
    } catch {
      // not allowed right now; try again on the next visibility change or set(true)
    } finally {
      pending = false;
    }
  }

  function release(): void {
    const lock = sentinel;
    sentinel = null;
    lock?.release().catch(() => {});
  }

  const off = onVisible(() => void acquire());

  return {
    set(active) {
      wanted = active;
      if (active) void acquire();
      else release();
    },
    destroy() {
      wanted = false;
      release();
      off();
    },
  };
}
