/**
 * Spanish (Spain), informal "tú". Must have exactly the keys of en.ts (checked by the type).
 */
import type { Color, Shading, Shape } from '../engine/engine.ts';
import type { Messages } from './en.ts';
import type { CardLabeler } from './types.ts';

export const es: Messages = {
  'app.name': 'Trio',
  'app.debug': 'Versión de pruebas: la pantalla de juego de verdad está en camino.',

  'lang.label': 'Idioma',
  'name.label': 'Tu nombre',
  'name.placeholder': 'Tu nombre',
  'player.unnamed': 'Jugador {tag}',

  'menu.train': 'Entrenar',
  'menu.trainNoLimit': 'Sin límite de tiempo tras ¡SET!',
  'menu.online': 'Jugar con un amigo',
  'menu.create': 'Crear sala',
  'menu.join': 'Unirse con código',
  'menu.code': 'Código de sala',
  'menu.badCode': 'El código tiene 4 letras o cifras, como K7QX.',

  'room.title': 'Sala {code}',
  'room.invite': 'Enlace de invitación',
  'room.copy': 'Copiar',
  'room.copied': '¡Copiado!',
  'role.host': 'Has creado esta sala',
  'role.guest': 'Te has unido a esta sala',
  'role.train': 'Entrenando',

  'status.connecting': 'Buscando al anfitrión…',
  'status.online': 'Conectado',
  'status.hostAway': 'El anfitrión se ha desconectado. Esperando a que vuelva…',
  'status.closed': 'El anfitrión ha cerrado la sala.',

  'deny.full': 'Sala llena',
  'deny.fullDetail': { one: 'Esta sala ya tiene {count} jugador.', other: 'Esta sala ya tiene {count} jugadores.' },
  'deny.version': 'El anfitrión usa otra versión. Recarga los dos móviles.',
  'deny.duplicate': 'Esta sala ya está abierta en otra pestaña de este navegador.',

  'seats.title': 'Jugadores',
  'seat.you': 'tú',
  'seat.host': 'anfitrión',
  'seat.away': 'desconectado',
  'seat.rematch': 'quiere la revancha',

  'lobby.waiting': 'Esperando a que se una alguien…',
  'lobby.start': 'Empezar partida',
  'lobby.waitHost': 'Esperando a que el anfitrión empiece…',

  'game.set': '¡SET!',
  'game.deck': { one: 'Queda {count} carta', other: 'Quedan {count} cartas' },
  'game.yourCall': 'Te toca: elige 3 cartas',
  'game.theirCall': '{name} ha cantado ¡SET!',
  'game.timeLeft': 'Quedan {time}',
  'game.noLimit': 'Sin límite de tiempo',
  'game.hint': 'Pista',
  'game.dealMore': 'Repartir 3 más',
  'game.newGame': 'Nueva partida',
  'game.leave': 'Salir',
  'game.over': 'Fin de la partida',
  'game.winner': '¡Gana {name}!',
  'game.tie': '¡Empate!',
  'game.rematch': 'Revancha',
  'game.waitRematch': 'Esperando a los demás…',
  'game.watching': 'Has entrado a mitad de partida: juegas en la siguiente.',

  'score.points': { one: '{count} punto', other: '{count} puntos' },
  'stats.sets': { one: '{count} set', other: '{count} sets' },
  'stats.mistakes': { one: '{count} fallo', other: '{count} fallos' },
  'stats.timeouts': { one: '{count} vez sin tiempo', other: '{count} veces sin tiempo' },
  'stats.hints': { one: '{count} pista', other: '{count} pistas' },
  'stats.spot': 'Tiempo de detección',
  'stats.pick': 'Tiempo de elección',
  'stats.last': 'Última: {spotLabel} {spot} · {pickLabel} {pick}',

  'feature.shape': 'forma',
  'feature.color': 'color',
  'feature.number': 'número',
  'feature.shading': 'relleno',
  'shape.diamond': 'rombo',
  'shape.squiggle': 'onda',
  'shape.oval': 'óvalo',
  'color.red': 'rojo',
  'color.green': 'verde',
  'color.purple': 'morado',
  'shading.solid': 'liso',
  'shading.striped': 'rayado',
  'shading.open': 'vacío',

  'log.title': 'Registro',
  'log.join': '{name} se ha unido',
  'log.rejoin': '{name} ha vuelto',
  'log.leave': '{name} se ha ido',
  'log.denied': '{name} no ha podido entrar: {reason}',
  'log.hostAway': 'El anfitrión se ha desconectado',
  'log.hostBack': 'El anfitrión ha vuelto',
  'log.closed': 'Sala cerrada',
  'log.error': 'Red: {code}',
  'log.rejected': 'Rechazado: {reason}',
  'log.snapshot': 'Sincronizado con el anfitrión',

  'ev.newGame': 'Nueva partida',
  'ev.call': '{name} ha cantado ¡SET!',
  'ev.locked': '{name} ha llegado tarde: {holder} cantó antes',
  'ev.cooldown': '{name} tiene que esperar',
  'ev.found': '{name} ha encontrado un set: {points}',
  'ev.foundTrain': 'Set encontrado · elección {time}',
  'ev.wrong': '{name}: no es un set, −{penalty} → {points}',
  'ev.wrongTrain': 'No es un set',
  'ev.timeout': 'A {name} se le ha acabado el tiempo, −{penalty} → {points}',
  'ev.timeoutTrain': 'Se acabó el tiempo',
  'ev.stale': '{name} ha elegido una carta que ya no está',
  'ev.hint': 'Pista: {card}',
  'ev.autoDeal': 'No hay ningún set en la mesa: 3 más',
  'ev.manualDeal': '3 cartas más',

  'why.noCall': 'pulsa ¡SET! primero',
  'why.locked': 'otro ha cantado antes',
  'why.cooldown': 'espera un momento',
  'why.gameOver': 'la partida ha terminado',
  'why.invalid': 'no está permitido',
  'why.notPlaying': 'no hay ninguna partida en curso',
  'why.notInVersus': 'solo al entrenar',
  'why.hostOnly': 'solo puede hacerlo el anfitrión',
  'why.notLobby': 'la partida ya ha empezado',
  'why.needPlayers': 'hacen falta 2 jugadores conectados',
  'why.notOver': 'la partida no ha terminado',
  'why.noSeat': 'no tienes sitio en la sala',
  'why.offline': 'no estás conectado al anfitrión',
  'why.deckEmpty': 'no quedan cartas',
  'why.boardFull': 'la mesa está llena',
  'reason.full': 'sala llena',
  'reason.version': 'otra versión',
  'reason.duplicate': 'mismo navegador',
};

type Gender = 'm' | 'f';

const SHAPE: Record<Shape, { readonly gender: Gender; readonly one: string; readonly other: string }> = {
  diamond: { gender: 'm', one: 'rombo', other: 'rombos' },
  squiggle: { gender: 'f', one: 'onda', other: 'ondas' },
  oval: { gender: 'm', one: 'óvalo', other: 'óvalos' },
};
const COLOR: Record<Color, Record<Gender, string>> = {
  red: { m: 'rojo', f: 'roja' },
  green: { m: 'verde', f: 'verde' },
  purple: { m: 'morado', f: 'morada' },
};
const SHADING: Record<Shading, Record<Gender, string>> = {
  solid: { m: 'liso', f: 'lisa' },
  striped: { m: 'rayado', f: 'rayada' },
  open: { m: 'vacío', f: 'vacía' },
};

/** "1 rombo rojo liso", "2 ondas verdes rayadas", "3 óvalos morados vacíos". */
export const esCardLabel: CardLabeler = ({ number, color, shading, shape }) => {
  const noun = SHAPE[shape];
  const plural = number > 1 ? 's' : '';
  return `${number} ${number > 1 ? noun.other : noun.one} ${COLOR[color][noun.gender]}${plural} ${SHADING[shading][noun.gender]}${plural}`;
};
