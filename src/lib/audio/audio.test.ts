// Sound without speakers: the event → sound mapping, the persisted switch, and silence when off.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../net/storage.ts';
import { soundForEvent, tickFor } from './map.ts';
import { JITTER, RECIPES, SOUND_NAMES, soundLength } from './recipes.ts';
import { SOUND_KEY, createSound } from './synth.ts';
import type { AudioContextLike } from './synth.ts';

/** Just enough of an AudioContext to count the voices the synth starts. */
function fakeContext() {
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  const counts = { oscillators: 0, noise: 0, started: 0 };
  const ctx = {
    currentTime: 0,
    state: 'running',
    sampleRate: 8000,
    destination: node(),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createDynamicsCompressor: () => ({ ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    createOscillator: () => {
      counts.oscillators++;
      return { ...node(), type: 'square', frequency: param(), start: () => counts.started++, stop() {}, onended: null };
    },
    createBufferSource: () => {
      counts.noise++;
      return { ...node(), buffer: null, playbackRate: param(), start: () => counts.started++, stop() {}, onended: null };
    },
    resume: async () => {},
    suspend: async () => {},
  };
  return { ctx: ctx as unknown as AudioContextLike, counts };
}

describe('sound', () => {
  test('every recipe is short, quiet and well formed', () => {
    for (const name of SOUND_NAMES) {
      const tones = RECIPES[name];
      assert.ok(tones.length > 0, name);
      assert.ok(soundLength(name) <= 0.9, `${name} is short`);
      for (const t of tones) {
        assert.ok(t.vol > 0 && t.vol <= 0.14, `${name}: peak ${t.vol}`);
        assert.ok(t.dur > 0 && t.at >= 0 && t.f > 0, name);
      }
      // Overlapping voices of one sound stay under the limiter's knee.
      let peak = 0;
      for (let t = 0; t < soundLength(name); t += 0.002) {
        peak = Math.max(peak, tones.filter((x) => x.at <= t && t < x.at + x.dur).reduce((s, x) => s + x.vol, 0));
      }
      assert.ok(peak <= 0.3, `${name}: stacked peak ${peak.toFixed(2)}`);
    }
    for (const spread of Object.values(JITTER)) assert.ok(spread !== undefined && spread >= 0 && spread <= 0.1);
  });

  test('events map to sounds from my point of view', () => {
    const me = 'me';
    assert.equal(soundForEvent({ type: 'call', playerId: me, calledAt: 0, deadline: 5000 }, me), 'callMine');
    assert.equal(soundForEvent({ type: 'call', playerId: 'them', calledAt: 0, deadline: 5000 }, me), 'callTheirs');
    const retire = { type: 'retire', cards: [0, 1, 2], slots: [0, 1, 2], score: 3, calledAt: 0, at: 1 } as const;
    assert.equal(soundForEvent({ ...retire, playerId: me }, me), 'foundMine');
    assert.equal(soundForEvent({ ...retire, playerId: 'them' }, me), 'foundTheirs');
    const wrong = { type: 'wrong', playerId: 'them', cards: [0, 1, 3], slots: [0, 1, 3], penalty: 1, score: -1, cooldownUntil: 0, calledAt: 0, at: 1 } as const;
    assert.equal(soundForEvent(wrong, me), 'wrong');
    assert.equal(soundForEvent({ type: 'timeout', playerId: me, calledAt: 0, at: 5000, penalty: 1, score: -1, cooldownUntil: 0 }, me), 'timeout');
    assert.equal(soundForEvent({ type: 'locked', playerId: me, holder: 'them', deadline: 1 }, me), 'nudge');
    assert.equal(soundForEvent({ type: 'locked', playerId: 'them', holder: me, deadline: 1 }, me), null);
    assert.equal(soundForEvent({ type: 'hint', playerId: me, card: 4 }, me), 'hint');
    assert.equal(soundForEvent({ type: 'autoDeal', count: 3 }, me), 'shuffle');
    assert.equal(soundForEvent({ type: 'deal', card: 1, slot: 0, deckCount: 80 }, me), 'deal');
    assert.equal(soundForEvent({ type: 'move', card: 1, from: 13, to: 2 }, me), null);
    assert.equal(soundForEvent({ type: 'gameOver', scores: { me: 9, them: 9 }, winners: [me, 'them'] }, me), 'win', 'a draw counts as a win');
    assert.equal(soundForEvent({ type: 'gameOver', scores: { me: 3, them: 9 }, winners: ['them'] }, me), 'lose');
    assert.equal(tickFor(4), 'tick');
    assert.equal(tickFor(2), 'tickUrgent');
  });

  test('on by default; the switch persists; nothing plays while off or before a gesture', () => {
    const store = memoryStore();
    const { ctx, counts } = fakeContext();
    const s = createSound({ store, createContext: () => ctx, random: () => 0.5 });
    assert.equal(s.enabled, true, 'default on');

    s.play('ui');
    assert.equal(counts.started, 0, 'no context before the first gesture');
    s.unlock();
    s.play('foundMine');
    assert.equal(counts.started, RECIPES.foundMine.length);

    s.setEnabled(false);
    assert.equal(store.get(SOUND_KEY), 'off');
    const before = counts.started;
    s.play('win');
    s.play('deal');
    assert.equal(counts.started, before, 'silent while off');

    const again = createSound({ store, createContext: () => ctx });
    assert.equal(again.enabled, false, 'the choice is remembered');
    again.setEnabled(true);
    assert.equal(store.get(SOUND_KEY), 'on');
    again.play('shuffle');
    assert.equal(again.voices, RECIPES.shuffle.length);
  });

  test('no Web Audio, or a throwing one: play is a silent no-op', () => {
    const none = createSound({ store: memoryStore(), createContext: () => null });
    none.unlock();
    none.play('win');
    assert.equal(none.voices, 0);
    const broken = createSound({
      store: memoryStore(),
      createContext: () => {
        throw new Error('blocked');
      },
    });
    assert.doesNotThrow(() => {
      broken.unlock();
      broken.play('win');
    });
  });
});
