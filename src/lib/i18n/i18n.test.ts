import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCard } from '../engine/engine.ts';
import { cardLabel, detectLang, formatSeconds, interpolate, messages, translate } from './index.ts';

describe('i18n', () => {
  test('es has exactly the keys of en, with plurals in the same places', () => {
    const en = messages('en');
    const es = messages('es');
    assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      assert.equal(typeof es[key], typeof en[key], `${key}: string vs plural`);
      const placeholders = (m: unknown) => [...JSON.stringify(m).matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      assert.deepEqual([...new Set(placeholders(es[key]))], [...new Set(placeholders(en[key]))], `${key}: same placeholders`);
      assert.ok(JSON.stringify(es[key]).length > 2, `${key}: not empty`);
    }
  });

  test('interpolation fills names and formats numbers per language', () => {
    assert.equal(translate('en', 'game.theirCall', { name: 'Ana' }), 'Ana called TRIO!');
    assert.equal(translate('es', 'game.theirCall', { name: 'Ana' }), 'Ana ha cantado ¡TRÍO!');
    assert.equal(translate('en', 'room.title', { code: 'K7QX' }), 'Room K7QX');
    assert.equal(interpolate('en', '{n} pts', { n: 12345.5 }), '12,345.5 pts');
    assert.equal(interpolate('es', '{n} ptos', { n: 12345.5 }), '12.345,5 ptos');
    assert.equal(interpolate('en', 'Hi {name}, {missing}', { name: 'Bo' }), 'Hi Bo, {missing}', 'a missing param stays visible');
  });

  test('plurals follow the count', () => {
    assert.equal(translate('en', 'game.deck', { count: 1 }), '1 card left');
    assert.equal(translate('en', 'game.deck', { count: 0 }), '0 cards left');
    assert.equal(translate('en', 'game.deck', { count: 69 }), '69 cards left');
    assert.equal(translate('es', 'game.deck', { count: 1 }), 'Queda 1 carta');
    assert.equal(translate('es', 'game.deck', { count: 3 }), 'Quedan 3 cartas');
    assert.equal(translate('es', 'score.points', { count: -2 }), '-2 puntos');
    assert.equal(translate('en', 'score.points', { count: 1 }), '1 point');
    assert.equal(translate('en', 'stats.sets'), '{count} trios', 'no count: the other form');
    assert.equal(translate('es', 'res.sets', { count: 1 }), '1 trío');
    assert.equal(translate('es', 'res.sets', { count: 4 }), '4 tríos');
    assert.equal(translate('en', 'res.hinted', { count: 1 }), '1 with a hint');
    assert.equal(translate('es', 'res.hinted', { count: 2 }), '2 con pistas');
  });

  test('times use the language’s decimal separator', () => {
    assert.equal(formatSeconds('en', 1840), '1.84 s');
    assert.equal(formatSeconds('es', 1840), '1,84 s');
    assert.equal(formatSeconds('en', 5000, 1), '5.0 s');
    assert.equal(translate('es', 'game.timeLeft', { time: formatSeconds('es', 3250) }), 'Quedan 3,25 s');
  });

  test('detection: es* → Spanish, anything else → English', () => {
    assert.equal(detectLang(['es-ES', 'en']), 'es');
    assert.equal(detectLang(['es-419']), 'es');
    assert.equal(detectLang(['ES']), 'es');
    assert.equal(detectLang(['en-GB', 'es']), 'en');
    assert.equal(detectLang(['fr-FR', 'es']), 'es', 'first supported language wins');
    assert.equal(detectLang(['de', 'fr']), 'en');
    assert.equal(detectLang([]), 'en');
  });

  test('card names agree in gender and number', () => {
    const card = (shape: number, color: number, n: number, shading: number) => encodeCard({ shape, color, number: n - 1, shading });
    assert.equal(cardLabel('en', card(1, 1, 2, 1)), '2 green striped squiggles');
    assert.equal(cardLabel('en', card(0, 0, 1, 0)), '1 red solid diamond');
    assert.equal(cardLabel('es', card(0, 0, 1, 0)), '1 rombo rojo liso');
    assert.equal(cardLabel('es', card(1, 1, 2, 1)), '2 ondas verdes rayadas');
    assert.equal(cardLabel('es', card(1, 2, 1, 2)), '1 onda morada vacía');
    assert.equal(cardLabel('es', card(2, 2, 3, 2)), '3 óvalos morados vacíos');
  });
});
