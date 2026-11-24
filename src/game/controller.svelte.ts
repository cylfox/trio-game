/**
 * The game screen's director: takes session changes, replays engine events in order through one
 * queue that animates the table, and keeps the reactive state the components render.
 *
 *   immediate   the lock (call banner, frozen board, SET! state) always follows the latest view;
 *               cue events (call, locked, cooldown, stale, hint) give feedback on arrival
 *   queued      board events run one step at a time (steps.ts): deals fly and flip, found sets
 *               pop and retire into the finder's pile, compaction slides, wrong picks shake,
 *               TIME! stamps. Scores, piles and the deck count change with their animation.
 *   reconcile   a view that can't be replayed (snapshot on join or rejoin, a missed seq, a
 *               backlog, a hidden tab) is placed directly: cards fade in, no flight storm.
 *
 * After each animated change the folded view is compared with the session's view; any drift is
 * reconciled at once. Train adds the spot clock (spot-clock.ts) and per-call records.
 */
import { applyEvent, findSets, playerStats } from '../lib/engine/engine.ts';
import type { CardId, GameEvent, Mode, PublicView } from '../lib/engine/engine.ts';
import { play, soundForEvent } from '../lib/audio/index.ts';
import { locale, t } from '../lib/i18n/locale.svelte.ts';
import type { Change, RoomSession, SessionState } from '../lib/net/session.ts';
import { announce, toast } from '../ui/toasts.svelte.ts';
import { fmtSpotU } from './format.ts';
import { S, T, reducedMotion, replayClass, rollIn, wait, wiggle } from './motion.ts';
import { loadPB, savePB, vibrate } from './prefs.ts';
import { SpotClock } from './spot-clock.ts';
import type { SpotState } from './spot-clock.ts';
import { pileOf, planChange, sameBoard, toSteps } from './steps.ts';
import type { Step } from './steps.ts';
import { STAMP_MS, WRONG_MS } from './table.ts';
import type { CardView, Table } from './table.ts';
import { beatsBest, judgeRun, trainStats } from './train-stats.ts';
import type { PersonalBest, TrainAttempt } from './train-stats.ts';

export interface PlayerColor {
  readonly c: string;
  readonly dim: string;
  readonly glow: string;
}

/** Player colours by panel position. Position 0 is always the local player. */
export const PCOLORS: readonly PlayerColor[] = [
  { c: 'var(--you)', dim: 'var(--you-dim)', glow: 'var(--you-glow)' },
  { c: 'var(--partner)', dim: 'var(--partner-dim)', glow: 'var(--partner-glow)' },
  { c: 'var(--p3)', dim: 'var(--p3-dim)', glow: 'var(--p3-glow)' },
  { c: 'var(--p4)', dim: 'var(--p4-dim)', glow: 'var(--p4-glow)' },
];

export interface ControllerOptions {
  readonly session: RoomSession;
  readonly me: string;
  /** The local player's display name ('' = not set). */
  readonly myName: () => string;
  /** The game ended (after its end animation), or "End game" in Train. */
  readonly onOver: () => void;
  /** Online rooms: the room server or a direct (P2P) connection. */
  readonly net?: 'server' | 'p2p' | null;
}

type El = HTMLElement | null;

const EMPTY_VIEW: PublicView = {
  schema: 2,
  seq: -1,
  mode: 'versus',
  config: { callMs: 5000, setPoints: 3, penalty: { full: 3, partial: 1 }, cooldownMs: 0, maxAttempts: 100 },
  startedAt: 0,
  deckCount: 0,
  board: [],
  players: [],
  lock: null,
  over: false,
};

export class GameController {
  readonly session: RoomSession;
  readonly me: string;
  private readonly opts: ControllerOptions;

  /** Latest session state. The lock, names and seats come from here. */
  snap = $state.raw<SessionState>(null as unknown as SessionState);
  /** Queue-driven display state. */
  scores = $state<Record<string, number>>({});
  piles = $state<Record<string, { last: CardId[]; sets: number }>>({});
  deckCount = $state(81);
  /** The opening deal has landed. */
  active = $state(false);
  /** The game-over step ran (or the game ended from the menu). */
  ended = $state(false);
  menuOpen = $state(false);
  claimPending = $state(false);
  callPending = $state(false);
  tip = $state<{ text: string; id: number } | null>(null);

  // Train
  attempts = $state<TrainAttempt[]>([]);
  hero = $state<SpotState>('init');
  /** Game start (performance.now) and end, for the Total clock. */
  t0 = $state(0);
  tEnd = $state(0);
  /** The game was played to the end (not ended from the menu). */
  full = $state(false);
  pbBefore: PersonalBest = loadPB();
  gameBest: number | null = null;
  /** The run against the personal bests, judged once when the results first show. */
  private verdictCache: ReturnType<typeof judgeRun> | null = null;
  readonly clock = new SpotClock();
  private hinted = false;

  /** Host-clock time the versus game ended. */
  endedAt = 0;

  // Queue
  private table: Table | null = null;
  private attachedResolve: (() => void) | null = null;
  private attached: Promise<void>;
  private q: Promise<void> = Promise.resolve();
  private pending = 0;
  private gen = 0;
  private shown: PublicView | null = null;
  /** Game seq of the latest change handed to the queue. */
  private targetSeq: number | null = null;
  /** Animated changes still in the queue (a long backlog is reconciled instead). */
  private backlog = 0;
  /** My picks when my call timed out (they shake with the TIME! stamp). */
  private timedOut: CardId[] = [];
  private readonly bests = new WeakSet<GameEvent>();
  private selection = new Set<CardId>();
  private hintSet: CardId[] | null = null;
  private hintLevel = 0;
  private callTimer = 0;
  private tipTimer = 0;
  private dead = false;

  /** Elements the effects need (registered by the components). */
  readonly refs: {
    setBtn: El;
    heroNum: El;
    hero: El;
    hud: El;
    panels: Map<string, HTMLElement>;
    scores: Map<string, HTMLElement>;
    piles: Map<string, HTMLElement>;
    stats: Map<string, HTMLElement>;
  } = { setBtn: null, heroNum: null, hero: null, hud: null, panels: new Map(), scores: new Map(), piles: new Map(), stats: new Map() };

  constructor(options: ControllerOptions) {
    this.opts = options;
    this.session = options.session;
    this.me = options.me;
    this.snap = options.session.getState();
    this.attached = new Promise((resolve) => (this.attachedResolve = resolve));
  }

  // ── Derived ──────────────────────────────────────────────────────────────────────────────

  get view(): PublicView | null {
    return this.snap?.view ?? null;
  }

  get mode(): Mode {
    return this.view?.mode ?? (this.session.role === 'train' ? 'train' : 'versus');
  }

  get isTrain(): boolean {
    return this.session.role === 'train';
  }

  /** The room's creator: starts games, new games and rematches. (On the room server everyone is a protocol guest.) */
  get isHost(): boolean {
    const room = this.snap?.room;
    return room ? room.hostId === this.me : this.session.role === 'host';
  }

  get net(): 'server' | 'p2p' | null {
    return this.opts.net ?? null;
  }

  /** Player ids in panel order: me first, then seat order. */
  get order(): string[] {
    const ids = this.view?.players.map((p) => p.id) ?? [];
    return [...ids.filter((id) => id === this.me), ...ids.filter((id) => id !== this.me)];
  }

  colorOf(id: string): PlayerColor {
    const i = this.order.indexOf(id);
    return PCOLORS[i < 0 ? 0 : i] ?? PCOLORS[0];
  }

  nameOf(id: string): string {
    const seat = this.snap?.room?.seats.find((s) => s.id === id);
    if (id === this.me) return seat?.name || this.opts.myName() || t('lobby.defaultName');
    return seat?.name || t('player.unnamed', { tag: id.slice(0, 4).toUpperCase() });
  }

  /** Has a real name (the "you" tag shows next to it). */
  namedMe(): boolean {
    return this.nameOf(this.me).toLowerCase() !== t('lobby.defaultName').toLowerCase();
  }

  away(id: string): boolean {
    const seat = this.snap?.room?.seats.find((s) => s.id === id);
    return seat !== undefined && !seat.connected;
  }

  // ── Wiring ───────────────────────────────────────────────────────────────────────────────

  attach(table: Table): void {
    this.table = table;
    this.attachedResolve?.();
    if (this.pending > 0) return; // queued work will draw the table
    if (this.shown !== null) {
      table.reconcile(this.shown.board);
      this.applyHints();
    } else if (this.view !== null) this.enqueueReconcile(this.view);
  }

  detach(): void {
    this.table?.destroy();
    this.table = null;
    this.attached = new Promise((resolve) => (this.attachedResolve = resolve));
  }

  destroy(): void {
    this.dead = true;
    this.gen++;
    clearTimeout(this.callTimer);
    clearTimeout(this.tipTimer);
    this.detach();
  }

  handle(state: SessionState, change: Change): void {
    if (this.dead) return;
    this.snap = state;
    if (change.type === 'rejected') {
      if (change.intent === 'claim') this.clearSelection();
      if (change.intent === 'call') this.callPending = false;
      return;
    }
    if (change.type !== 'state') return;
    const view = state.view;
    if (view === null) return;
    if (view.lock?.playerId !== this.me) {
      if (change.events.some((e) => e.type === 'timeout' && e.playerId === this.me)) this.timedOut = [...this.selection];
      this.clearSelection();
      this.claimPending = false;
    }
    if (view.lock !== null) this.callPending = false;

    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const plan = planChange(change, this.targetSeq, view.seq, { hidden, backlog: this.backlog });
    if (plan === 'none') return;
    this.targetSeq = view.seq;
    if (plan === 'reconcile') {
      if (this.isTrain && change.events.some((e) => e.type === 'newGame')) this.resetTrain();
      this.recordTrain(change.events);
      this.enqueueReconcile(view);
      return;
    }
    for (const e of change.events) if (isCueEvent(e)) this.cue(e);
    this.recordTrain(change.events);
    const steps = toSteps(change.events).filter((step) => step.kind !== 'cue');
    if (steps.length === 0) return; // cues only (a call, a hint): nothing moves on the table
    for (const step of steps) this.enqueue(() => this.runStep(step), true);
    const target = view;
    this.backlog++;
    this.enqueue(async () => {
      this.backlog = Math.max(0, this.backlog - 1);
      if (this.shown === null || !sameBoard(this.shown.board, target.board) || this.shown.deckCount !== target.deckCount) this.reconcileNow(target);
      else this.shown = { ...this.shown, seq: target.seq };
    }, false);
  }

  private enqueue(task: () => Promise<void>, waits: boolean): void {
    this.pending++;
    if (waits && this.isTrain) this.spotWait();
    const gen = this.gen;
    this.q = this.q
      .then(() => this.attached)
      .then(() => (gen === this.gen && !this.dead ? task() : undefined))
      .catch((err: unknown) => console.error(err))
      .finally(() => {
        this.pending--;
        if (this.pending === 0) this.onSettled();
      });
  }

  private enqueueReconcile(view: PublicView): void {
    this.gen++; // drop queued animations: the reconcile lands on the latest view anyway
    this.backlog = 0;
    this.enqueue(async () => this.reconcileNow(view), false);
  }

  private alive = (): boolean => !this.dead && this.table !== null;

  // ── Steps ────────────────────────────────────────────────────────────────────────────────

  private async runStep(step: Step): Promise<void> {
    const table = this.table;
    if (table === null) return;
    switch (step.kind) {
      case 'newGame':
        return this.stepNewGame(table, step.event);
      case 'deals':
        return this.stepDeals(table, step);
      case 'found':
        return this.stepFound(table, step);
      case 'wrong':
        return this.stepWrong(table, step.event);
      case 'timeout':
        return this.stepTimeout(table, step.event);
      case 'gameOver':
        return this.stepGameOver(step.event);
      case 'cue':
        return;
    }
  }

  private async stepNewGame(table: Table, e: Extract<GameEvent, { type: 'newGame' }>): Promise<void> {
    table.clear(true);
    this.shown = applyEvent(this.shown ?? { ...EMPTY_VIEW, mode: e.mode }, e);
    this.scores = Object.fromEntries(e.players.map((id) => [id, 0]));
    this.piles = Object.fromEntries(e.players.map((id) => [id, { last: [], sets: 0 }]));
    this.deckCount = e.deckCount;
    this.active = false;
    this.ended = false;
    this.endedAt = 0;
    this.hintSet = null;
    this.hintLevel = 0;
    if (this.isTrain) this.resetTrain();
    play('shuffle');
    await wait(S(260));
  }

  private async stepDeals(table: Table, step: Extract<Step, { kind: 'deals' }>): Promise<void> {
    if (step.reason === 'auto') {
      toast(t('toast.noSetDeal'), 'info', 1600);
      play('shuffle');
      await wait(S(520));
      if (!this.alive()) return;
    }
    let shown = this.shown ?? EMPTY_VIEW;
    for (const d of step.deals) shown = applyEvent(shown, d);
    this.shown = shown;
    table.board = shown.board.slice();
    table.relayout(step.reason !== 'initial');
    await this.deal(
      table,
      step.deals.map((d) => d.card),
      step.deals.map((d) => d.deckCount),
    );
    if (step.reason === 'initial' && this.alive()) {
      this.active = true;
      this.t0 = performance.now();
    }
  }

  private deal(table: Table, cards: CardId[], counts: number[]): Promise<void> {
    const stagger = S(70);
    cards.forEach((_, k) => setTimeout(() => this.alive() && play('deal', { vol: cards.length > 3 ? 0.75 : 1 }), k * stagger));
    const flipAt = 460 + (cards.length - 1) * stagger;
    cards.forEach((_, k) => setTimeout(() => this.alive() && play('flip', { vol: cards.length > 3 ? 0.7 : 1 }), T(flipAt) + k * S(65)));
    return table.dealCards(
      cards,
      counts,
      (n) => (this.deckCount = n),
      () => this.alive(),
    ).then(() => this.applyHints());
  }

  private async stepFound(table: Table, step: Extract<Step, { kind: 'found' }>): Promise<void> {
    const { retire, refill, moves } = step;
    const isMe = retire.playerId === this.me;
    const color = this.colorOf(retire.playerId);
    const vs = table.viewsOf(retire.cards);
    this.clearHints();
    for (const v of vs) {
      v.lock();
      v.tint(color.c, color.glow);
      v.setSel(false);
      v.el.classList.remove('pick');
      v.el.classList.add('claim');
    }
    this.shown = applyEvent(this.shown ?? EMPTY_VIEW, retire);
    const gained = retire.score - (this.scores[retire.playerId] ?? 0);
    if (this.isTrain) this.bumpHud(['sets', 'last', 'best', 'avg']);
    else this.setScore(retire.playerId, retire.score, `+${gained}`, false);
    const c = table.centroid(vs);
    table.popCards(vs);
    const spot = this.isTrain ? this.attempts.at(-1)?.spot : undefined;
    table.floatText(spot !== undefined ? fmtSpotU(locale.lang, spot) : `+${gained}`, c.x, c.y - 10, color.c);
    play(soundForEvent(retire, this.me) ?? 'foundMine');
    if (isMe) vibrate(30);
    announce(this.isTrain ? t('ev.foundTrain', { time: fmtSpotU(locale.lang, retire.at - retire.calledAt) }) : isMe ? t('say.foundYou', { points: gained }) : t('ev.found', { name: this.nameOf(retire.playerId), points: t('score.points', { count: retire.score }) }));
    if (this.bests.has(retire)) this.celebrateBest(table);
    await wait(isMe ? 380 : 520);
    if (!this.alive()) return;

    const retired = table.retire(retire.cards, retire.playerId).then(() => {
      if (!this.alive()) return;
      this.piles = { ...this.piles, [retire.playerId]: pileOf(this.shown ?? EMPTY_VIEW, retire.playerId) };
      const pile = this.refs.piles.get(retire.playerId);
      replayClass(pile, 'got', 420);
      rollIn(pile?.querySelector('.pile-count'));
    });
    await wait(S(160));
    if (!this.alive()) return;
    let shown = this.shown ?? EMPTY_VIEW;
    for (const d of refill) shown = applyEvent(shown, d);
    for (const m of moves) shown = applyEvent(shown, m);
    this.shown = shown;
    const sizeChanged = table.board.length !== shown.board.length;
    table.board = shown.board.slice();
    if (moves.length > 0 || sizeChanged) table.relayout(true);
    if (refill.length > 0) {
      await this.deal(
        table,
        refill.map((d) => d.card),
        refill.map((d) => d.deckCount),
      );
    } else {
      this.deckCount = shown.deckCount;
      await wait(T(380));
    }
    await retired;
  }

  private async stepWrong(table: Table, e: Extract<GameEvent, { type: 'wrong' }>): Promise<void> {
    const isMe = e.playerId === this.me;
    this.shown = applyEvent(this.shown ?? EMPTY_VIEW, e);
    const vs = table.viewsOf(e.cards);
    if (!isMe) {
      // Their picks light up in their colour, then shake.
      const color = this.colorOf(e.playerId);
      for (const v of vs) {
        v.tint(color.c, color.glow);
        v.el.classList.add('pick');
      }
      table.popCards(vs);
      await wait(S(420));
      if (!this.alive()) return;
    }
    table.shakeCards(vs);
    this.penaltyFeedback(table, e.playerId, e.score, e.penalty);
    play('wrong');
    if (isMe) vibrate([70, 50, 70]);
    announce(this.isTrain ? t('ev.wrongTrain') : isMe ? t('say.wrongYou') : t('ev.wrong', { name: this.nameOf(e.playerId), penalty: e.penalty, points: t('score.points', { count: e.score }) }));
    if (this.isTrain) {
      this.bumpHud(['wrong', 'last']);
      // The next spot starts once the flash has cleared, so it doesn't count against the player.
      await wait(WRONG_MS);
    }
  }

  private async stepTimeout(table: Table, e: Extract<GameEvent, { type: 'timeout' }>): Promise<void> {
    const isMe = e.playerId === this.me;
    this.shown = applyEvent(this.shown ?? EMPTY_VIEW, e);
    if (isMe) table.shakeCards(table.viewsOf(this.timedOut));
    this.timedOut = [];
    this.clearSelection();
    this.penaltyFeedback(table, e.playerId, e.score, e.penalty);
    play('timeout');
    if (isMe) vibrate(180);
    announce(this.isTrain ? t('ev.timeoutTrain') : isMe ? t('say.timeoutYou') : t('ev.timeout', { name: this.nameOf(e.playerId), penalty: e.penalty, points: t('score.points', { count: e.score }) }));
    const stamp = table.stamp(t('stamp.time'));
    if (this.isTrain) {
      this.bumpHud(['to', 'last']);
      // The next spot starts only once the TIME! stamp has cleared.
      await Promise.race([stamp, wait(STAMP_MS() + 300)]);
    }
  }

  private async stepGameOver(e: Extract<GameEvent, { type: 'gameOver' }>): Promise<void> {
    this.shown = applyEvent(this.shown ?? EMPTY_VIEW, e);
    this.endedAt = this.session.hostNow();
    this.finish(true);
    toast(t('toast.deckEmptyEnd'), 'gold', 1500);
    await wait(reducedMotion() ? 400 : 1500);
    if (this.dead) return;
    this.opts.onOver();
  }

  private finish(full: boolean): void {
    this.ended = true;
    this.clearSelection();
    if (this.isTrain) {
      this.full = full;
      this.tEnd = performance.now();
      this.clock.over(performance.now());
      this.hero = this.clock.state;
    }
  }

  /** Train: "End game" from the menu. */
  endTrain(): void {
    if (!this.isTrain || this.ended) return;
    this.gen++;
    this.finish(false);
    this.opts.onOver();
  }

  private reconcileNow(view: PublicView): void {
    if (!view.over) this.ended = false;
    this.shown = view;
    this.table?.reconcile(view.board);
    this.scores = Object.fromEntries(view.players.map((p) => [p.id, p.score]));
    this.piles = Object.fromEntries(view.players.map((p) => [p.id, pileOf(view, p.id)]));
    this.deckCount = view.deckCount;
    this.active = true;
    this.applyHints();
    if (this.t0 === 0) this.t0 = performance.now();
    if (view.over && !this.ended) {
      this.endedAt = Math.max(view.startedAt, ...view.players.flatMap((p) => p.attempts.map((a) => a.resolvedAt)));
      this.finish(true);
      this.opts.onOver();
    }
  }

  // ── Feedback ─────────────────────────────────────────────────────────────────────────────

  private setScore(id: string, value: number, delta: string, bad: boolean): void {
    this.scores = { ...this.scores, [id]: value };
    const el = this.refs.scores.get(id);
    if (!el) return;
    rollIn(el);
    spawnDelta(el.parentElement, delta, bad);
  }

  private penaltyFeedback(table: Table, id: string, score: number, penalty: number): void {
    if (!this.isTrain) this.setScore(id, score, `−${penalty}`, true);
    replayClass(this.refs.panels.get(id), 'bad', 500);
    table.screenShake();
  }

  private bumpHud(keys: readonly string[]): void {
    for (const k of keys) {
      const el = this.refs.stats.get(k);
      if (!el) continue;
      rollIn(el);
      if (k === 'sets') spawnDelta(el, '+1', false);
      else if (k === 'wrong' || k === 'to') spawnDelta(el, '+1', true);
    }
  }

  private celebrateBest(table: Table): void {
    setTimeout(
      () => {
        if (!this.alive()) return;
        replayClass(this.refs.hero, 'flash', 1300);
        replayClass(this.refs.hud, 'flash', 1300);
        table.sparks(this.refs.heroNum, 'var(--you)');
        hudStamp(this.refs.hud, t('stamp.newBest'));
        play('newBest');
      },
      S(220) || 60,
    );
  }

  showTip(text: string): void {
    this.tip = { text, id: (this.tip?.id ?? 0) + 1 };
    clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => (this.tip = null), 1300);
  }

  private cue(e: Extract<GameEvent, { type: 'call' | 'locked' | 'cooldown' | 'stale' | 'hint' }>): void {
    const sound = soundForEvent(e, this.me);
    switch (e.type) {
      case 'call':
        if (sound) play(sound);
        if (e.playerId === this.me) announce(t('say.youCalled'));
        else {
          if (!this.isTrain) this.clearHints();
          toast(t('game.theirCall', { name: this.nameOf(e.playerId) }), 'partner', 1200);
          announce(t('game.theirCall', { name: this.nameOf(e.playerId) }));
        }
        return;
      case 'locked':
      case 'cooldown':
        if (e.playerId !== this.me) return;
        this.callPending = false;
        if (sound) play(sound);
        wiggle(this.refs.setBtn);
        if (e.type === 'locked') this.showTip(t('tip.picking', { name: this.nameOf(e.holder) }));
        return;
      case 'stale':
        if (e.playerId !== this.me) return;
        this.clearSelection();
        this.claimPending = false;
        if (sound) play(sound);
        toast(t('toast.stale'), 'bad', 1400);
        return;
      case 'hint':
        if (e.playerId !== this.me) return;
        this.onHint(e.card);
        if (sound) play(sound);
        return;
    }
  }

  // ── Train records and spot clock ─────────────────────────────────────────────────────────

  private resetTrain(): void {
    this.attempts = [];
    this.gameBest = null;
    this.verdictCache = null;
    this.pbBefore = loadPB();
    this.full = false;
    this.t0 = 0;
    this.tEnd = 0;
    this.hinted = false;
    this.clock.state = 'init';
    this.hero = 'init';
  }

  private recordTrain(events: readonly GameEvent[]): void {
    if (!this.isTrain) return;
    for (const e of events) {
      if (e.type !== 'retire' && e.type !== 'wrong' && e.type !== 'timeout') continue;
      if (e.playerId !== this.me) continue;
      const res = e.type === 'retire' ? 'set' : e.type === 'wrong' ? 'wrong' : 'time';
      const spot = this.clock.callSpot;
      const hinted = res === 'set' && this.hinted;
      if (res === 'set' && !hinted) {
        if (beatsBest(spot, this.gameBest, this.pbBefore.single)) this.bests.add(e);
        if (this.gameBest === null || spot < this.gameBest) this.gameBest = spot;
      }
      this.attempts = [...this.attempts, { spot, pick: e.at - e.calledAt, res, hinted }];
      if (res === 'set') this.hinted = false;
    }
  }

  /** Personal bests for this run; stored (once) when beaten. */
  verdict(): ReturnType<typeof judgeRun> {
    if (this.verdictCache === null) {
      const v = judgeRun(this.pbBefore, loadPB(), this.trainStats, this.full);
      if (v.newAvg || v.newSingle) savePB(v.pb);
      this.verdictCache = v;
    }
    return this.verdictCache;
  }

  get trainStats() {
    return trainStats(this.attempts);
  }

  /** Engine stats for the local player (hints pressed, etc.). */
  get myStats() {
    return this.view === null ? undefined : playerStats(this.view, this.me);
  }

  private spotWait(): void {
    // A frozen (gold) spot stays on show while the claimed cards fly off.
    const frozen = this.clock.state === 'frozen';
    this.clock.wait(performance.now());
    this.hero = frozen ? 'frozen' : this.clock.state;
  }

  private onSettled(): void {
    if (!this.isTrain || this.dead || this.ended || !this.active) return;
    if (this.view?.lock) return;
    const s = this.clock.state;
    if (s !== 'wait' && s !== 'init') return;
    this.hinted = this.hintLevel > 0; // a hint still glowing on the table carries over
    if (this.menuOpen || document.visibilityState === 'hidden') this.clock.readyPaused();
    else {
      this.clock.start(performance.now());
      if (!reducedMotion()) this.refs.heroNum?.animate?.([{ transform: 'scale(1.3) rotate(-4deg)' }, { transform: 'scale(1)' }], { duration: 280, easing: 'cubic-bezier(.34, 1.56, .64, 1)' });
    }
    this.hero = this.clock.state;
  }

  pauseSpot(): void {
    if (!this.isTrain) return;
    this.clock.pause(performance.now());
    this.hero = this.clock.state;
  }

  resumeSpot(): void {
    if (!this.isTrain || this.menuOpen || document.visibilityState === 'hidden') return;
    if (this.clock.state === 'wait' && this.pending === 0 && !this.view?.lock && !this.ended) {
      this.clock.start(performance.now());
    } else this.clock.resume(performance.now());
    this.hero = this.clock.state;
  }

  setMenu(open: boolean): void {
    this.menuOpen = open;
    if (open) this.pauseSpot();
    else this.resumeSpot();
  }

  // ── Input ────────────────────────────────────────────────────────────────────────────────

  pressSet(): void {
    const view = this.view;
    if (view === null || this.menuOpen || this.dead) return;
    if (this.ended || view.over || !this.active) {
      wiggle(this.refs.setBtn);
      return;
    }
    const lock = view.lock;
    if (lock !== null) {
      if (lock.playerId !== this.me) {
        wiggle(this.refs.setBtn);
        this.showTip(t('tip.picking', { name: this.nameOf(lock.playerId) }));
        play('nudge');
      }
      return;
    }
    if (this.callPending) return;
    if (this.isTrain) {
      if (this.clock.state !== 'run') {
        wiggle(this.refs.setBtn);
        this.showTip(t('tip.wait'));
        play('nudge');
        return;
      }
      this.clock.freeze(performance.now());
      this.hero = this.clock.state;
      rollIn(this.refs.heroNum);
    }
    this.table?.sparks(this.refs.setBtn, 'var(--you)');
    this.callPending = true;
    clearTimeout(this.callTimer);
    this.callTimer = window.setTimeout(() => (this.callPending = false), 2500);
    this.session.act({ type: 'call' });
  }

  tap(v: CardView): void {
    const view = this.view;
    if (view === null || this.menuOpen || this.ended || !v.ready || v.locked || this.dead) return;
    const lock = view.lock;
    if (lock === null) {
      wiggle(this.refs.setBtn);
      this.table?.nudge(v);
      this.showTip(t('tip.callFirst'));
      play('nudge');
      return;
    }
    if (lock.playerId !== this.me || this.claimPending) return;
    if (this.selection.has(v.id)) {
      this.selection.delete(v.id);
      v.setSel(false);
      play('deselect');
      return;
    }
    this.selection.add(v.id);
    v.setSel(true);
    play('select', { pitch: 1 + (this.selection.size - 1) * 0.12 });
    if (this.selection.size < 3) return;
    this.claimPending = true;
    this.session.act({ type: 'claim', cards: [...this.selection], hinted: this.isTrain && this.hinted });
  }

  hint(): void {
    if (!this.isTrain || this.ended || !this.active || this.view?.over) return;
    this.session.act({ type: 'hint' });
  }

  private onHint(card: CardId): void {
    const board = (this.view?.board ?? []).filter((c): c is CardId => c !== null);
    const valid = this.hintSet !== null && this.hintSet.includes(card) && this.hintSet.every((c) => board.includes(c));
    if (!valid) {
      const set = findSets(board).find((s) => s.includes(card));
      if (!set) {
        toast(t('toast.holdOn'), 'info', 1200);
        return;
      }
      this.hintSet = [card, ...set.filter((c) => c !== card)];
      this.hintLevel = 0;
    }
    this.hintLevel = Math.min(3, this.hintLevel + 1);
    this.hinted = true;
    this.applyHints();
    this.bumpHud(['hints']);
    if (this.hintLevel === 3) toast(t('toast.wholeSet'), 'info', 1200);
  }

  private applyHints(): void {
    const table = this.table;
    if (!table) return;
    const lit = new Set(this.hintSet?.slice(0, this.hintLevel) ?? []);
    for (const v of table.views.values()) v.el.classList.toggle('hint', lit.has(v.id) && !v.retiring);
  }

  private clearHints(): void {
    this.hintSet = null;
    this.hintLevel = 0;
    this.applyHints();
  }

  private clearSelection(): void {
    if (this.selection.size === 0) return;
    for (const id of this.selection) this.table?.views.get(id)?.setSel(false);
    this.selection.clear();
  }

  relabel(): void {
    this.table?.relabel();
  }

}

function isCueEvent(e: GameEvent): e is Extract<GameEvent, { type: 'call' | 'locked' | 'cooldown' | 'stale' | 'hint' }> {
  return e.type === 'call' || e.type === 'locked' || e.type === 'cooldown' || e.type === 'stale' || e.type === 'hint';
}

/** "+3" / "−1" next to a score or HUD stat. */
export function spawnDelta(host: Element | null | undefined, text: string, bad: boolean): void {
  if (!host) return;
  const d = document.createElement('span');
  d.className = `delta${bad ? ' neg' : ''}`;
  d.textContent = text;
  host.appendChild(d);
  const a = d.animate?.(
    [
      { transform: 'translateY(6px) scale(.5)', opacity: 0 },
      { transform: 'translateY(-8px) scale(1.3)', opacity: 1, offset: 0.3 },
      { transform: 'translateY(-26px) scale(1)', opacity: 0 },
    ],
    { duration: reducedMotion() ? 600 : 950, easing: 'ease-out' },
  );
  if (a) a.finished.then(() => d.remove(), () => d.remove());
  else setTimeout(() => d.remove(), 900);
}

function hudStamp(host: Element | null, text: string): void {
  if (!host) return;
  const s = document.createElement('div');
  s.className = 'hud-stamp';
  s.textContent = text;
  host.appendChild(s);
  const kf: Keyframe[] = reducedMotion()
    ? [
        { transform: 'translateY(-50%) rotate(-7deg)', opacity: 1 },
        { transform: 'translateY(-50%) rotate(-7deg)', opacity: 1, offset: 0.85 },
        { transform: 'translateY(-50%) rotate(-7deg)', opacity: 0 },
      ]
    : [
        { transform: 'translateY(-50%) scale(2.4) rotate(-14deg)', opacity: 0 },
        { transform: 'translateY(-50%) scale(.94) rotate(-7deg)', opacity: 1, offset: 0.3 },
        { transform: 'translateY(-50%) scale(1.05) rotate(-7deg)', opacity: 1, offset: 0.45 },
        { transform: 'translateY(-50%) scale(1) rotate(-7deg)', opacity: 1, offset: 0.85 },
        { transform: 'translateY(-50%) scale(1) rotate(-7deg)', opacity: 0 },
      ];
  const a = s.animate?.(kf, { duration: reducedMotion() ? 1100 : 1500, easing: 'ease-out', fill: 'both' });
  if (a) a.finished.then(() => s.remove(), () => s.remove());
  else setTimeout(() => s.remove(), 1500);
}

