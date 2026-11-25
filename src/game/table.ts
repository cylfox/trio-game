/**
 * The card table (browser only): one persistent element per card in a single absolutely
 * positioned layer. Port of the approved mockup's CardView and geometry.
 *
 * In flight a card is a fixed 120 px box scaled by transform. At rest on the table it is re-laid
 * at its real size with no scale (rotation only), so the pixel symbols stay crisp and even.
 * All positions are relative to the game element.
 */
import type { CardId } from '../lib/engine/engine.ts';
import { cardHtml, symPx } from './card-html.ts';
import { CARD_RATIO, computeLayout } from './layout.ts';
import type { Layout, Rect } from './layout.ts';
import { EASE, S, T, anim, rand, reducedMotion, wait } from './motion.ts';
import { diffBoard } from './steps.ts';

const BW = 120;
const BH = 180;
const MINI_W = 26;
const FAN = [
  { dx: -11, dy: 2, r: -14 },
  { dx: 0, dy: -2, r: 0 },
  { dx: 11, dy: 2, r: 14 },
] as const;

export interface Pos {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly s: number;
  /** Real card width at rest (table slots only). */
  readonly w?: number;
}

export interface FlyOptions {
  readonly duration?: number;
  readonly delay?: number;
  readonly easing?: string;
  readonly z?: number;
}

export interface TableElements {
  readonly game: HTMLElement;
  readonly board: HTMLElement;
  readonly layer: HTMLElement;
  /** The top card of the deck pile (or the empty pile outline). */
  readonly deckTop: () => HTMLElement | null;
  /** A player's pile fan. */
  readonly pile: (playerId: string) => HTMLElement | null;
}

export interface TableHandlers {
  tap(view: CardView): void;
  label(card: CardId): string;
  layout?(layout: Layout): void;
}

export class CardView {
  ready = false;
  locked = false;
  retiring = false;
  private anim: Animation | null = null;
  pos: Pos | null = null;
  readonly tilt = rand(-1.8, 1.8);
  private native = false;
  readonly el: HTMLButtonElement;
  readonly fx: HTMLElement;
  private readonly flipEl: HTMLElement;

  private readonly table: Table;
  readonly id: CardId;

  constructor(table: Table, id: CardId, faceUp = false) {
    this.table = table;
    this.id = id;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'card';
    el.dataset.card = String(id);
    el.tabIndex = -1;
    el.setAttribute('aria-pressed', 'false');
    el.setAttribute('aria-label', table.handlers.label(id));
    el.style.setProperty('--sd', `${rand(2.4, 4.2).toFixed(2)}s`);
    el.style.setProperty('--sdl', `${(-rand(0, 4)).toFixed(2)}s`);
    el.style.setProperty('--sa', `${rand(0.5, 1.4).toFixed(2)}deg`);
    el.innerHTML = cardHtml(id, faceUp);
    this.el = el;
    this.fx = el.querySelector('.c-fx') as HTMLElement;
    this.flipEl = el.querySelector('.c-flip') as HTMLElement;
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      table.handlers.tap(this);
    });
    // Keyboard activation (Enter / Space) arrives as a click with detail 0; taps use pointerdown.
    el.addEventListener('click', (e) => {
      if (e.detail === 0) table.handlers.tap(this);
    });
    table.els.layer.appendChild(el);
    table.views.set(id, this);
  }

  private tf(p: Pos): string {
    return `translate3d(${(p.x - BW / 2).toFixed(2)}px,${(p.y - BH / 2).toFixed(2)}px,0) rotate(${p.r.toFixed(2)}deg) scale(${p.s.toFixed(4)})`;
  }

  private symFor(p: Pos | null): void {
    if (p?.w) this.el.style.setProperty('--symw', `${(symPx(p.w) / p.w).toFixed(6)}em`);
  }

  private rest(): void {
    const p = this.pos;
    const w = p?.w;
    if (!p || !w) return;
    this.el.style.fontSize = `${w}px`;
    this.el.style.setProperty('--symw', `${symPx(w)}px`);
    this.el.style.transform = `translate3d(${(p.x - w / 2).toFixed(2)}px,${(p.y - (w * CARD_RATIO) / 2).toFixed(2)}px,0) rotate(${p.r.toFixed(2)}deg)`;
    this.native = true;
  }

  /** Back to the scalable flight form: the same picture, ready to animate. */
  private unrest(): void {
    if (!this.native || this.pos === null) return;
    this.native = false;
    this.el.style.fontSize = '';
    this.symFor(this.pos);
    this.el.style.transform = this.tf(this.pos);
  }

  place(p: Pos): void {
    this.anim?.cancel();
    this.anim = null;
    this.native = false;
    this.el.style.fontSize = '';
    this.pos = p;
    this.el.style.zIndex = '';
    this.symFor(p);
    this.el.style.transform = this.tf(p);
    this.rest();
  }

  fly(p: Pos, o: FlyOptions = {}): Promise<void> {
    this.unrest();
    this.symFor(p);
    const to = this.tf(p);
    let from = this.el.style.transform;
    try {
      const cs = getComputedStyle(this.el).transform;
      if (cs && cs !== 'none') from = cs;
    } catch {
      // keep the inline transform
    }
    this.anim?.cancel();
    this.anim = null;
    this.pos = p;
    this.el.style.transform = to;
    this.el.style.zIndex = o.z === undefined ? '' : String(o.z);
    const duration = T(o.duration ?? 420);
    const delay = S(o.delay ?? 0);
    if (!from || typeof this.el.animate !== 'function') {
      this.el.style.zIndex = '';
      this.rest();
      return Promise.resolve();
    }
    const a = this.el.animate([{ transform: from }, { transform: to }], { duration, delay, easing: o.easing ?? EASE.out, fill: 'backwards' });
    this.anim = a;
    // A hidden tab may never deliver `finished`: never wait much longer than the flight itself.
    const done = Promise.race([a.finished.then(noop, noop), wait(duration + delay + 400)]);
    return done.then(() => {
      if (this.anim === a) {
        this.anim = null;
        this.el.style.zIndex = '';
        if (!this.retiring) this.rest();
      }
    });
  }

  faceUp(up: boolean): void {
    this.flipEl.classList.toggle('down', !up);
  }

  setSel(on: boolean): void {
    this.el.classList.toggle('sel', on);
    this.el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  makeReady(): void {
    this.ready = true;
    this.el.classList.add('ready');
    if (!this.locked) this.el.tabIndex = 0;
  }

  lock(): void {
    this.locked = true;
    this.el.tabIndex = -1;
    this.el.classList.add('locked');
  }

  /** Light the card in a player's colour. */
  tint(color: string, glow: string): void {
    this.el.style.setProperty('--pc', color);
    this.el.style.setProperty('--pg', glow);
  }

  relabel(): void {
    this.el.setAttribute('aria-label', this.table.handlers.label(this.id));
  }

  destroy(): void {
    this.anim?.cancel();
    this.el.remove();
    if (this.table.views.get(this.id) === this) this.table.views.delete(this.id);
  }
}

function noop(): void {}

export class Table {
  readonly views = new Map<CardId, CardView>();
  /** The displayed board: slot → card (null = hole). */
  board: (CardId | null)[] = [];
  L: Layout | null = null;

  readonly els: TableElements;
  readonly handlers: TableHandlers;

  constructor(els: TableElements, handlers: TableHandlers) {
    this.els = els;
    this.handlers = handlers;
  }

  rel(el: Element): Rect {
    const g = this.els.game.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - g.left, y: r.top - g.top, w: r.width, h: r.height };
  }

  slotPos(i: number, v: CardView): Pos | null {
    const L = this.L;
    const s = L?.slots[i];
    if (!L || !s) return null;
    return { x: s.x, y: s.y, r: v.tilt, s: L.w / BW, w: L.w };
  }

  relayout(animate: boolean): void {
    const L = computeLayout(this.rel(this.els.board), this.board.length);
    if (!L) return;
    this.L = L;
    this.handlers.layout?.(L);
    this.board.forEach((id, i) => {
      if (id === null) return;
      const v = this.views.get(id);
      if (!v || v.retiring) return;
      const p = this.slotPos(i, v);
      if (!p) return;
      if (animate) void v.fly(p, { duration: 380, easing: EASE.spring });
      else v.place(p);
    });
  }

  /** The board element changed size: lay out again without animation. */
  onResize(): void {
    const r = this.rel(this.els.board);
    if (r.w < 40) return;
    if (this.L && Math.abs(r.w - this.L.bw) < 0.5 && Math.abs(r.h - this.L.bh) < 0.5) return;
    this.relayout(false);
  }

  deckPos(): Pos {
    const top = this.els.deckTop();
    if (!top) return { x: 0, y: this.els.game.clientHeight, r: 0, s: 40 / BW };
    const r = this.rel(top);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2, r: rand(-6, 6), s: r.w / BW };
  }

  pileTargets(playerId: string): Pos[] {
    const fan = this.els.pile(playerId);
    if (!fan) return FAN.map(() => ({ x: this.els.game.clientWidth / 2, y: -60, r: 0, s: MINI_W / BW }));
    const r = this.rel(fan);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return FAN.map((f) => ({ x: cx + f.dx, y: cy + f.dy, r: f.r, s: MINI_W / BW }));
  }

  centroid(vs: readonly CardView[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const v of vs) {
      x += v.pos?.x ?? 0;
      y += v.pos?.y ?? 0;
    }
    const n = Math.max(1, vs.length);
    return { x: x / n, y: y / n };
  }

  viewsOf(cards: readonly CardId[]): CardView[] {
    return cards.map((id) => this.views.get(id)).filter((v): v is CardView => v !== undefined);
  }

  /**
   * Deal: each card leaves the deck face down (staggered), lands in its slot, then they flip.
   * `deckCounts[k]` is the deck size once card k has left. The cards must already be in `board`.
   */
  async dealCards(cards: readonly CardId[], deckCounts: readonly number[], setDeck: (n: number) => void, alive: () => boolean): Promise<void> {
    if (cards.length === 0) return;
    const src = this.deckPos();
    const vs = cards.map((id, k) => {
      this.views.get(id)?.destroy();
      const v = new CardView(this, id);
      v.place({ ...src, r: src.r + k * 0.4 });
      v.el.style.zIndex = String(60 - k);
      return v;
    });
    const stagger = S(70);
    const flights = vs.map((v, k) => {
      setTimeout(() => {
        if (alive()) setDeck(deckCounts[k]);
      }, k * stagger);
      const slot = this.board.indexOf(v.id);
      const p = this.slotPos(slot < 0 ? 0 : slot, v);
      return p ? v.fly(p, { duration: 460, delay: k * stagger, easing: EASE.land, z: 60 - k }) : Promise.resolve();
    });
    await Promise.all(flights);
    if (!alive()) return;
    setDeck(deckCounts[deckCounts.length - 1]);
    vs.forEach((v, k) =>
      setTimeout(() => {
        if (alive()) v.faceUp(true);
      }, k * S(65)),
    );
    await wait((vs.length - 1) * S(65) + T(400));
    if (!alive()) return;
    for (const v of vs) v.makeReady();
  }

  /** Found set: the cards fly into the finder's pile and are removed. */
  async retire(cards: readonly CardId[], playerId: string): Promise<void> {
    const vs = this.viewsOf(cards);
    const targets = this.pileTargets(playerId);
    for (const v of vs) {
      v.retiring = true;
      v.el.classList.remove('claim', 'sel', 'hint', 'ready', 'pick');
      v.el.classList.add('retiring');
      v.el.tabIndex = -1;
    }
    await Promise.all(vs.map((v, k) => v.fly(targets[k] ?? targets[0], { duration: 540, delay: k * 70, easing: EASE.retire, z: 80 + k })));
    for (const v of vs) v.destroy();
  }

  /**
   * Jump to a board without flights: kept cards are placed in their slots, gone cards fade out,
   * new cards fade in face up.
   */
  reconcile(target: readonly (CardId | null)[]): void {
    const diff = diffBoard(this.views.keys(), target);
    for (const id of diff.remove) {
      const v = this.views.get(id);
      if (!v) continue;
      this.views.delete(id);
      v.retiring = true;
      void anim(v.el, [{ opacity: 1 }, { opacity: 0 }], { duration: T(200), fill: 'forwards' }).then(() => v.el.remove());
    }
    this.board = target.slice();
    const fresh = diff.add.map(({ card }) => {
      const v = new CardView(this, card, true);
      v.el.style.opacity = '0';
      return v;
    });
    this.relayout(false);
    for (const v of fresh) {
      v.el.style.opacity = '';
      void anim(v.el, [{ opacity: 0 }, { opacity: 1 }], { duration: T(260), easing: 'ease-out' });
      v.makeReady();
    }
    for (const { card } of diff.keep) {
      const v = this.views.get(card);
      if (!v) continue;
      v.retiring = false;
      v.faceUp(true);
      v.el.classList.remove('retiring', 'claim', 'pick', 'wrong', 'locked');
      v.locked = false;
      v.makeReady();
    }
  }

  /** Remove every card (a new game). */
  clear(fade: boolean): void {
    for (const v of [...this.views.values()]) {
      this.views.delete(v.id);
      if (fade) void anim(v.el, [{ opacity: 1 }, { opacity: 0 }], { duration: T(220), fill: 'forwards' }).then(() => v.el.remove());
      else v.destroy();
    }
    this.board = [];
  }

  relabel(): void {
    for (const v of this.views.values()) v.relabel();
  }

  destroy(): void {
    for (const v of [...this.views.values()]) v.destroy();
    this.views.clear();
    this.els.layer.querySelectorAll('.floaty, .spark').forEach((n) => n.remove());
    this.els.game.querySelectorAll('.stamp').forEach((n) => n.remove());
  }

  // ── Effects ────────────────────────────────────────────────────────────────────────────────

  floatText(text: string, x: number, y: number, color: string): void {
    const f = document.createElement('div');
    f.className = 'floaty';
    f.textContent = text;
    f.style.left = `${x}px`;
    f.style.top = `${y}px`;
    f.style.setProperty('--fc', color);
    this.els.layer.appendChild(f);
    void anim(
      f,
      [
        { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
        { transform: 'translate(-50%,-90%) scale(1.35)', opacity: 1, offset: 0.22 },
        { transform: 'translate(-50%,-160%) scale(1)', opacity: 1, offset: 0.7 },
        { transform: 'translate(-50%,-220%) scale(.9)', opacity: 0 },
      ],
      { duration: reducedMotion() ? 600 : 1050, easing: 'ease-out' },
    ).then(() => f.remove());
  }

  /** A big rubber stamp over the board (TIME!). Resolves when it has cleared. */
  stamp(text: string): Promise<void> {
    const r = this.rel(this.els.board);
    const s = document.createElement('div');
    s.className = 'stamp';
    s.textContent = text;
    this.els.game.appendChild(s);
    s.style.left = `${r.x + r.w / 2 - s.offsetWidth / 2}px`;
    s.style.top = `${r.y + r.h / 2 - s.offsetHeight / 2}px`;
    return anim(
      s,
      [
        { transform: 'scale(2.6) rotate(-14deg)', opacity: 0 },
        { transform: 'scale(.92) rotate(-8deg)', opacity: 1, offset: 0.35 },
        { transform: 'scale(1.04) rotate(-8deg)', opacity: 1, offset: 0.5 },
        { transform: 'scale(1) rotate(-8deg)', opacity: 1, offset: 0.85 },
        { transform: 'scale(1) rotate(-8deg)', opacity: 0 },
      ],
      { duration: STAMP_MS(), easing: 'ease-out', fill: 'forwards' },
    ).then(() => s.remove());
  }

  sparks(el: Element | null, color: string): void {
    if (reducedMotion() || !el) return;
    const r = this.rel(el);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    for (let i = 0; i < 12; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      s.style.setProperty('--sc', color);
      this.els.layer.appendChild(s);
      const a = (i / 12) * Math.PI * 2 + rand(-0.2, 0.2);
      const d = rand(50, 95);
      void anim(
        s,
        [
          { transform: `translate(${cx}px,${cy}px) scale(1.4)`, opacity: 1 },
          { transform: `translate(${cx + Math.cos(a) * d}px,${cy + Math.sin(a) * d * 0.6 - 20}px) scale(.3)`, opacity: 0 },
        ],
        { duration: rand(420, 620), easing: 'cubic-bezier(.1,.8,.3,1)' },
      ).then(() => s.remove());
    }
  }

  popCards(vs: readonly CardView[]): void {
    vs.forEach((v, k) =>
      anim(
        v.fx,
        [{ transform: 'scale(1)' }, { transform: 'scale(1.18) rotate(-3deg)', offset: 0.35 }, { transform: 'scale(.95) rotate(1deg)', offset: 0.7 }, { transform: 'scale(1)' }],
        { duration: T(380), delay: S(k * 40), easing: 'ease-out' },
      ),
    );
  }

  /** Wrong pick: red flash and shake. */
  shakeCards(vs: readonly CardView[]): void {
    for (const v of vs) {
      v.setSel(false);
      v.el.classList.remove('pick', 'wrong');
      void v.el.offsetWidth;
      v.el.classList.add('wrong');
      setTimeout(() => v.el.classList.remove('wrong'), 600);
      if (!reducedMotion()) void anim(v.fx, SHAKE_KF, { duration: 420, easing: 'ease-out' });
    }
  }

  screenShake(): void {
    if (!reducedMotion()) void anim(this.els.game, SCREEN_SHAKE_KF, { duration: 300, easing: 'ease-out' });
  }

  nudge(v: CardView): void {
    if (!reducedMotion())
      void anim(v.fx, [{ transform: 'translateY(0)' }, { transform: 'translateY(-.05em) rotate(-2deg)' }, { transform: 'translateY(0)' }], {
        duration: 220,
        easing: 'ease-out',
      });
  }
}

/** How long the TIME! stamp stays up. */
export const STAMP_MS = (): number => (reducedMotion() ? 900 : 1250);
/** How long the wrong-pick flash and shake take. */
export const WRONG_MS = 600;

const SHAKE_KF: Keyframe[] = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-.07em) rotate(-3deg)' },
  { transform: 'translateX(.07em) rotate(3deg)' },
  { transform: 'translateX(-.05em) rotate(-2deg)' },
  { transform: 'translateX(.03em)' },
  { transform: 'translateX(0)' },
];
const SCREEN_SHAKE_KF: Keyframe[] = [
  { transform: 'translate(0,0)' },
  { transform: 'translate(-6px,2px)' },
  { transform: 'translate(5px,-2px)' },
  { transform: 'translate(-3px,1px)' },
  { transform: 'translate(2px,0)' },
  { transform: 'translate(0,0)' },
];
