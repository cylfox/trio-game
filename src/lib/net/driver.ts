/**
 * Holds one GameState, applies actions with the clock's `now`, and arms a timer that calls
 * expire() at the lock deadline. Used by the host and by train mode.
 */
import { applyAction, expire, newGame } from '../engine/engine.ts';
import type { Action, ActionStep, GameEvent, GameState, NewGameOptions, Rng } from '../engine/engine.ts';
import type { Clock, Schedule } from './session.ts';

export interface Commit {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export interface GameDriver {
  readonly game: GameState | null;
  /** Start a new game now. Commits its events. */
  start(players: readonly string[], rng: Rng, options: Omit<NewGameOptions, 'now'>): void;
  /** Resume a saved game without events (re-arms the timer; an overdue lock expires right away). */
  load(game: GameState | null): void;
  /** Apply an action now. Commits when it produced events (cues included). null: no game. */
  apply(action: Action): ActionStep | null;
  /** Expire an overdue lock now (e.g. after the tab was asleep). */
  tick(): void;
  stop(): void;
}

export function createGameDriver(options: { clock: Clock; schedule: Schedule; onCommit: (commit: Commit) => void }): GameDriver {
  const { clock, schedule, onCommit } = options;
  let game: GameState | null = null;
  let cancel: (() => void) | null = null;

  const disarm = () => {
    cancel?.();
    cancel = null;
  };

  const arm = () => {
    disarm();
    const deadline = game?.lock?.deadline;
    if (deadline === undefined || deadline === null) return;
    cancel = schedule(
      () => {
        cancel = null;
        tick();
      },
      Math.max(0, deadline - clock()),
    );
  };

  const commit = (state: GameState, events: readonly GameEvent[]) => {
    game = state;
    arm();
    onCommit({ state, events });
  };

  function tick(): void {
    if (game === null) return;
    const step = expire(game, clock());
    if (step.result === 'expired') commit(step.state, step.events);
    else arm(); // fired early: wait for the rest
  }

  return {
    get game() {
      return game;
    },
    start(players, rng, newGameOptions) {
      const step = newGame(players, rng, { ...newGameOptions, now: clock() });
      commit(step.state, step.events);
    },
    load(saved) {
      game = saved;
      arm();
    },
    apply(action) {
      if (game === null) return null;
      const step = applyAction(game, action, clock());
      if (step.events.length > 0) commit(step.state, step.events);
      return step;
    },
    tick,
    stop: disarm,
  };
}
