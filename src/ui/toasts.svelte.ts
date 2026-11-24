/**
 * App-wide toasts and screen-reader announcements.
 */
export type ToastKind = 'gold' | 'partner' | 'bad' | 'info';

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly kind: ToastKind;
  leaving: boolean;
}

export const ui = $state<{ toasts: Toast[]; toastTop: number; said: string; saidId: number }>({
  toasts: [],
  toastTop: 14,
  said: '',
  saidId: 0,
});

let nextId = 0;

export function toast(text: string, kind: ToastKind = 'gold', ms = 1800): void {
  const id = ++nextId;
  ui.toasts = [...ui.toasts, { id, text, kind, leaving: false }].slice(-3);
  setTimeout(() => {
    const t = ui.toasts.find((x) => x.id === id);
    if (t) t.leaving = true;
    setTimeout(() => (ui.toasts = ui.toasts.filter((x) => x.id !== id)), 240);
  }, ms);
}

/** Say something to screen readers (polite live region). */
export function announce(text: string): void {
  // Re-announce identical text by clearing first.
  ui.said = '';
  ui.saidId++;
  const id = ui.saidId;
  setTimeout(() => {
    if (ui.saidId === id) ui.said = text;
  }, 30);
}
