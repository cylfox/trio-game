/**
 * Which sound an engine event makes, from one player's point of view (pure). The game screen
 * plays these from the same queue that animates the events, so sound and picture stay in sync.
 * Deals are played per card as each one leaves the deck, not here.
 */
import type { GameEvent } from '../engine/engine.ts';
import type { SoundName } from './recipes.ts';

export function soundForEvent(event: GameEvent, me: string): SoundName | null {
  switch (event.type) {
    case 'call':
      return event.playerId === me ? 'callMine' : 'callTheirs';
    case 'locked':
    case 'cooldown':
      return event.playerId === me ? 'nudge' : null;
    case 'retire':
      return event.playerId === me ? 'foundMine' : 'foundTheirs';
    case 'wrong':
      return 'wrong';
    case 'timeout':
      return 'timeout';
    case 'stale':
      return event.playerId === me ? 'error' : null;
    case 'hint':
      return event.playerId === me ? 'hint' : null;
    case 'newGame':
    case 'autoDeal':
    case 'manualDeal':
      return 'shuffle';
    case 'deal':
      return 'deal';
    case 'gameOver':
      return event.winners.includes(me) ? 'win' : 'lose';
    case 'move':
      return null;
  }
}

/** Countdown tick for a new whole second left: tenser in the last 2 s. */
export function tickFor(secondsLeft: number): SoundName {
  return secondsLeft <= 2 ? 'tickUrgent' : 'tick';
}
