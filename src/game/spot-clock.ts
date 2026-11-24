/**
 * The Train spot clock (pure; time is passed in).
 *
 * Spot time runs from "board ready" to the SET! press.
 *   init    before the first deal has landed
 *   run     counting
 *   frozen  SET! pressed: shows the spot time of this call
 *   wait    cards are moving (or a stamp is on show): the clock is off until the board is ready
 *   paused  menu open or tab hidden: keeps its value and continues on resume
 *   over    the game ended
 */
export type SpotState = 'init' | 'run' | 'frozen' | 'wait' | 'paused' | 'over';

export class SpotClock {
  state: SpotState = 'init';
  /** Accumulated ms before the current run segment. */
  private acc = 0;
  private runT0 = 0;
  /** The value on show while not running. */
  private shown = 0;
  /** Spot time of the last SET! press. */
  callSpot = 0;

  value(now: number): number {
    return this.acc + (this.state === 'run' ? now - this.runT0 : 0);
  }

  /** What the hero number shows. */
  display(now: number): number {
    return this.state === 'run' || this.state === 'paused' ? this.value(now) : this.shown;
  }

  /** The board is ready: a new spot starts at 0. */
  start(now: number): void {
    if (this.state === 'over') return;
    this.acc = 0;
    this.shown = 0;
    this.runT0 = now;
    this.state = 'run';
  }

  /** Cards are about to move. A frozen value stays on show. */
  wait(now: number): void {
    if (this.state === 'over' || this.state === 'wait') return;
    if (this.state === 'run' || this.state === 'paused') this.shown = this.value(now);
    this.state = 'wait';
  }

  pause(now: number): void {
    if (this.state !== 'run') return;
    this.acc = this.value(now);
    this.state = 'paused';
  }

  /** Continue a paused spot. Returns false when not paused. */
  resume(now: number): boolean {
    if (this.state !== 'paused') return false;
    this.runT0 = now;
    this.state = 'run';
    return true;
  }

  /** SET! pressed. Returns the spot time. */
  freeze(now: number): number {
    const v = this.value(now);
    this.acc = v;
    this.callSpot = v;
    this.shown = v;
    this.state = 'frozen';
    return v;
  }

  over(now: number): void {
    if (this.state === 'over') return;
    if (this.state === 'run' || this.state === 'paused') this.shown = this.value(now);
    this.state = 'over';
  }

  /** The board settled while the menu was open: start paused at 0. */
  readyPaused(): void {
    if (this.state === 'over') return;
    this.acc = 0;
    this.shown = 0;
    this.state = 'paused';
  }
}
