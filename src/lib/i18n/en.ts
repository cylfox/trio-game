/**
 * English: the source language. Every user-visible string lives here and in es.ts.
 * {name} placeholders are filled by t(key, params); numbers are formatted for the language.
 * Objects with one/other are plurals chosen by the `count` param.
 */
import type { CardLabeler, Message, Plural } from './types.ts';

export const en = {
  'app.name': 'Trio',
  'app.debug': 'Debug build: the real game screen is coming.',

  'lang.label': 'Language',
  'name.label': 'Your name',
  'name.placeholder': 'Your name',
  'player.unnamed': 'Player {tag}',

  'menu.train': 'Train',
  'menu.trainNoLimit': 'No time limit after SET!',
  'menu.online': 'Play with a friend',
  'menu.create': 'Create room',
  'menu.join': 'Join with code',
  'menu.code': 'Room code',
  'menu.badCode': 'A code is 4 letters or digits, like K7QX.',

  'room.title': 'Room {code}',
  'room.invite': 'Invite link',
  'room.copy': 'Copy',
  'room.copied': 'Copied!',
  'role.host': 'You host this room',
  'role.guest': 'You joined this room',
  'role.train': 'Training',

  'status.connecting': 'Looking for the host…',
  'status.online': 'Connected',
  'status.hostAway': 'The host dropped out. Waiting for them to come back…',
  'status.closed': 'The host closed the room.',

  'deny.full': 'Room full',
  'deny.fullDetail': { one: 'This room already has {count} player.', other: 'This room already has {count} players.' },
  'deny.version': 'The host is on a different version. Reload both phones.',
  'deny.duplicate': 'This room is already open in another tab of this browser.',

  'seats.title': 'Players',
  'seat.you': 'you',
  'seat.host': 'host',
  'seat.away': 'away',
  'seat.rematch': 'wants a rematch',

  'lobby.waiting': 'Waiting for a friend to join…',
  'lobby.start': 'Start game',
  'lobby.waitHost': 'Waiting for the host to start…',

  'game.set': 'SET!',
  'game.deck': { one: '{count} card left', other: '{count} cards left' },
  'game.yourCall': 'Your call: pick 3 cards',
  'game.theirCall': '{name} called SET!',
  'game.timeLeft': '{time} left',
  'game.noLimit': 'No time limit',
  'game.hint': 'Hint',
  'game.dealMore': 'Deal 3 more',
  'game.newGame': 'New game',
  'game.leave': 'Leave',
  'game.over': 'Game over',
  'game.winner': '{name} wins!',
  'game.tie': 'It’s a tie!',
  'game.rematch': 'Rematch',
  'game.waitRematch': 'Waiting for the others…',
  'game.watching': 'You joined mid-game: you play from the next one.',

  'score.points': { one: '{count} point', other: '{count} points' },
  'stats.sets': { one: '{count} set', other: '{count} sets' },
  'stats.mistakes': { one: '{count} mistake', other: '{count} mistakes' },
  'stats.timeouts': { one: '{count} timeout', other: '{count} timeouts' },
  'stats.hints': { one: '{count} hint', other: '{count} hints' },
  'stats.spot': 'Spot time',
  'stats.pick': 'Pick time',
  'stats.last': 'Last call: {spotLabel} {spot} · {pickLabel} {pick}',

  'feature.shape': 'shape',
  'feature.color': 'color',
  'feature.number': 'number',
  'feature.shading': 'shading',
  'shape.diamond': 'diamond',
  'shape.squiggle': 'squiggle',
  'shape.oval': 'oval',
  'color.red': 'red',
  'color.green': 'green',
  'color.purple': 'purple',
  'shading.solid': 'solid',
  'shading.striped': 'striped',
  'shading.open': 'open',

  'log.title': 'Event log',
  'log.join': '{name} joined',
  'log.rejoin': '{name} is back',
  'log.leave': '{name} left',
  'log.denied': '{name} could not join: {reason}',
  'log.hostAway': 'Host disconnected',
  'log.hostBack': 'Host is back',
  'log.closed': 'Room closed',
  'log.error': 'Network: {code}',
  'log.rejected': 'Refused: {reason}',
  'log.snapshot': 'Synced with the host',

  'ev.newGame': 'New game',
  'ev.call': '{name} called SET!',
  'ev.locked': '{name} was too late: {holder} called first',
  'ev.cooldown': '{name} has to wait',
  'ev.found': '{name} found a set: {points}',
  'ev.foundTrain': 'Set found · pick {time}',
  'ev.wrong': '{name}: not a set, −{penalty} → {points}',
  'ev.wrongTrain': 'Not a set',
  'ev.timeout': '{name} ran out of time, −{penalty} → {points}',
  'ev.timeoutTrain': 'Out of time',
  'ev.stale': '{name} picked a card that is gone',
  'ev.hint': 'Hint: {card}',
  'ev.autoDeal': 'No set on the board: 3 more',
  'ev.manualDeal': '3 more cards',

  'why.noCall': 'press SET! first',
  'why.locked': 'someone else called first',
  'why.cooldown': 'wait a moment',
  'why.gameOver': 'the game is over',
  'why.invalid': 'not allowed',
  'why.notPlaying': 'no game running',
  'why.notInVersus': 'only in training',
  'why.hostOnly': 'only the host can do that',
  'why.notLobby': 'the game already started',
  'why.needPlayers': 'needs 2 connected players',
  'why.notOver': 'the game is not over',
  'why.noSeat': 'you have no seat',
  'why.offline': 'not connected to the host',
  'why.deckEmpty': 'the deck is empty',
  'why.boardFull': 'the board is full',
  'reason.full': 'room full',
  'reason.version': 'different version',
  'reason.duplicate': 'same browser',
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof en;

/** Same keys as English, and a plural wherever English has one. */
export type Messages = { readonly [K in MessageKey]: (typeof en)[K] extends string ? string : Plural };

/** "1 red solid diamond", "2 green striped squiggles". */
export const enCardLabel: CardLabeler = ({ number, color, shading, shape }) =>
  `${number} ${en[`color.${color}`]} ${en[`shading.${shading}`]} ${en[`shape.${shape}`]}${number > 1 ? 's' : ''}`;
