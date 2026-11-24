/**
 * Train: the same engine and driver as the host, run locally for one player. No network.
 * Intents: call, claim (with `hinted`), hint, dealMore; start/rematch begin a new game.
 */
import { mulberry32, publicView } from '../engine/engine.ts';
import type { Action, GameConfigInput, GameEvent, Rng } from '../engine/engine.ts';
import { createGameDriver } from './driver.ts';
import type { Intent } from './protocol.ts';
import { systemClock, systemSchedule } from './session.ts';
import type { Change, Clock, Listener, RoomSession, Schedule, SessionState } from './session.ts';
import { listeners } from './transport.ts';

export interface TrainOptions {
  readonly playerId: string;
  /** e.g. { callMs: null } for no time limit after calling. */
  readonly config?: GameConfigInput;
  readonly clock?: Clock;
  readonly schedule?: Schedule;
  readonly rng?: Rng;
}

export function createTrain(options: TrainOptions): RoomSession {
  const { playerId } = options;
  const clock = options.clock ?? systemClock;
  const schedule = options.schedule ?? systemSchedule;
  const rng = options.rng ?? mulberry32(Math.floor(Math.random() * 2 ** 32));
  const subscribers = listeners<[SessionState, Change]>();
  let seq = 0;
  let state: SessionState;

  const driver = createGameDriver({
    clock,
    schedule,
    onCommit: ({ state: game, events }) => {
      seq += 1;
      state = { ...state, view: publicView(game), seq };
      emit(events);
    },
  });

  function emit(events: readonly GameEvent[]): void {
    subscribers.emit(state, { type: 'state', kind: 'update', events, contiguous: true });
  }

  state = { role: 'train', code: null, me: playerId, status: 'online', denied: null, room: null, view: null, seq };
  const start = () => driver.start([playerId], rng, { mode: 'train', config: options.config });
  start();

  function toAction(intent: Intent): Action | null {
    switch (intent.type) {
      case 'call':
      case 'hint':
        return { type: intent.type, playerId };
      case 'claim':
        return { type: 'claim', playerId, cards: intent.cards, hinted: intent.hinted === true };
      case 'dealMore':
        return { type: 'dealMore' };
      default:
        return null;
    }
  }

  return {
    role: 'train',
    getState: () => state,
    subscribe: (listener: Listener) => subscribers.add(listener),
    act(intent) {
      if (intent.type === 'start' || intent.type === 'rematch') return start();
      const action = toAction(intent);
      const step = action === null ? null : driver.apply(action);
      if (step !== null && step.events.length === 0 && step.result !== 'called') {
        subscribers.emit(state, { type: 'rejected', intent: intent.type, reason: step.result });
      }
    },
    hostNow: clock,
    resync: () => driver.tick(),
    async leave() {
      driver.stop();
      subscribers.clear();
    },
  };
}
