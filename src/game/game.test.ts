// Pure UI logic: layout, event steps and reconciliation, train stats and the chart, formatting.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, callSet, claim, findSets, isSet, newGame, publicView } from '../lib/engine/engine.ts';
import type { CardId, GameEvent, GameState, PublicView } from '../lib/engine/engine.ts';
import { EXAMPLES, LOGO_CARDS, isValid, judge, randomExample } from './examples.ts';
import { fmtClock, fmtScore, fmtSpot, fmtSpotU, splitUnits } from './format.ts';
import { CARD_RATIO, computeLayout } from './layout.ts';
import { SpotClock } from './spot-clock.ts';
import { diffBoard, movesCards, pileOf, planChange, sameBoard, toSteps } from './steps.ts';
import { beatsBest, chartModel, judgeRun, niceMax, parsePB, trainStats } from './train-stats.ts';
import type { TrainAttempt } from './train-stats.ts';

// ── Layout ───────────────────────────────────────────────────────────────────────────────────

describe('layout', () => {
  const phone = { x: 16, y: 100, w: 358, h: 620 };

  test('12 cards on a phone: 3 columns, 4 rows, inside the board, never wider than 150', () => {
    const L = computeLayout(phone, 12);
    assert.ok(L);
    assert.equal(L.c, 3);
    assert.equal(L.rows, 4);
    assert.ok(L.w <= 150 && L.w > 80, `card width ${L.w}`);
    assert.equal(L.h, L.w * CARD_RATIO);
    for (const s of L.slots) {
      assert.ok(s.x - L.w / 2 >= phone.x && s.x + L.w / 2 <= phone.x + phone.w, 'inside horizontally');
      assert.ok(s.y - L.h / 2 >= phone.y && s.y + L.h / 2 <= phone.y + phone.h, 'inside vertically');
    }
  });

  test('extra cards keep the 12-card columns and add rows at the bottom', () => {
    const L12 = computeLayout(phone, 12);
    const L21 = computeLayout(phone, 21);
    assert.ok(L12 && L21);
    assert.equal(L21.c, L12.c);
    assert.equal(L21.rows, 7);
    assert.ok(L21.w < L12.w, 'cards shrink to fit');
    // Same column for the same slot, rows in order.
    for (let i = 0; i < 12; i++) assert.equal(Math.floor(i / L21.c), Math.floor(i / L12.c), `slot ${i} keeps its row`);
    assert.ok(L21.slots[20].y > L21.slots[11].y, 'new rows below');
    const bottom = L21.slots[20].y + L21.h / 2;
    assert.ok(bottom <= phone.y + phone.h, '21 cards still fit');
  });

  test('a short board picks more columns; a wide one up to 8; unmeasured → null', () => {
    const short = computeLayout({ x: 0, y: 0, w: 328, h: 420 }, 12);
    assert.equal(short?.c, 4);
    const wide = computeLayout({ x: 0, y: 0, w: 1200, h: 500 }, 12);
    assert.ok(wide && wide.c > 4 && wide.c <= 8);
    assert.equal(computeLayout({ x: 0, y: 0, w: 30, h: 600 }, 12), null);
  });

  test('slot centres keep the column grid for every count', () => {
    for (let n = 1; n <= 21; n++) {
      const L = computeLayout(phone, n);
      assert.ok(L);
      assert.equal(L.slots.length, n);
      const xs = new Set(L.slots.map((s) => s.x.toFixed(3)));
      assert.ok(xs.size <= L.c);
    }
  });
});

// ── Steps and reconciliation ─────────────────────────────────────────────────────────────────

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A versus game between 'a' and 'b'. */
function game(seed = 1): { state: GameState; events: readonly GameEvent[] } {
  return newGame(['a', 'b'], seeded(seed), { mode: 'versus', now: 0 });
}

function play(state: GameState, player: string, cards: readonly CardId[], now: number) {
  const called = callSet(state, player, now);
  const claimed = claim(called.state, player, cards, now + 500);
  return { state: claimed.state, events: [...called.events, ...claimed.events] };
}

function aNonSet(board: readonly CardId[]): CardId[] {
  for (let i = 0; i < board.length; i++)
    for (let j = i + 1; j < board.length; j++)
      for (let k = j + 1; k < board.length; k++) if (!isSet(board[i], board[j], board[k])) return [board[i], board[j], board[k]];
  throw new Error('no non-set');
}

describe('event steps', () => {
  test('newGame groups its deals into one initial step', () => {
    const { events } = game();
    const steps = toSteps(events);
    assert.equal(steps[0].kind, 'newGame');
    assert.equal(steps[1].kind, 'deals');
    assert.equal(steps[1].kind === 'deals' && steps[1].reason, 'initial');
    assert.equal(steps[1].kind === 'deals' && steps[1].deals.length, 12);
    const dealt = steps.flatMap((s) => (s.kind === 'deals' ? s.deals : []));
    assert.equal(dealt.length, events.filter((e) => e.type === 'deal').length, 'every deal is in a step');
    assert.ok(steps.slice(2).every((s) => s.kind === 'deals' && s.reason === 'auto'));
  });

  test('a found set: retire with its refill deals (same slots) in one step; the call is a cue', () => {
    const g = game(2);
    const set = findSets(g.state.board)[0];
    const played = play(g.state, 'a', set, 1000);
    const steps = toSteps(played.events);
    assert.equal(steps[0].kind, 'cue');
    assert.equal(steps[1].kind, 'found');
    if (steps[1].kind !== 'found') return;
    assert.deepEqual([...steps[1].retire.cards].sort(), [...set].sort());
    assert.equal(steps[1].refill.length, 3);
    assert.deepEqual(steps[1].refill.map((d) => d.slot).sort(), [...steps[1].retire.slots].sort());
    assert.equal(steps[1].moves.length, 0);
  });

  test('compaction moves belong to the found step; wrong and timeout are their own steps', () => {
    // Deck of exactly 15: 12 dealt, 3 left. Find a set, refill, then find another: compaction.
    let { state } = newGame(['a'], seeded(5), { mode: 'train', now: 0, deck: Array.from({ length: 81 }, (_, i) => i).slice(0, 15) });
    let sawMoves = false;
    for (let round = 0; round < 6 && !state.over; round++) {
      const set = findSets(state.board)[0];
      const played = play(state, 'a', set, 1000 * (round + 1));
      state = played.state;
      for (const step of toSteps(played.events)) if (step.kind === 'found' && step.moves.length > 0) sawMoves = true;
    }
    assert.ok(sawMoves, 'some found step carried moves');

    const w = game(3);
    const wrong = play(w.state, 'b', aNonSet(w.state.board), 1000);
    assert.deepEqual(toSteps(wrong.events).map((s) => s.kind), ['cue', 'wrong']);
    const called = callSet(w.state, 'a', 1000);
    const late = claim(called.state, 'a', findSets(w.state.board)[0], 7000);
    assert.equal(toSteps(late.events)[0].kind, 'timeout');
    assert.equal(movesCards({ kind: 'wrong', event: wrong.events[1] as Extract<GameEvent, { type: 'wrong' }> }), false);
  });

  test('folding the steps lands on the engine view (the table never drifts)', () => {
    let { state, events } = game(7);
    let shown: PublicView = applyEvent(publicView(state), events[0]);
    shown = events.slice(1).reduce(applyEvent, shown);
    for (let round = 0; round < 10 && !state.over; round++) {
      const next = play(state, round % 2 ? 'a' : 'b', findSets(state.board)[0], 1000 * (round + 1));
      state = next.state;
      events = next.events;
      shown = events.reduce(applyEvent, shown);
      assert.ok(sameBoard(shown.board, publicView(state).board));
    }
  });
});

describe('plan and reconcile', () => {
  const update = (events: readonly GameEvent[], contiguous = true) => ({ kind: 'update' as const, contiguous, events });
  const newGameEvents = game().events;

  test('contiguous updates animate; snapshots, gaps and backlogs reconcile; room-only changes do nothing', () => {
    assert.equal(planChange(update(newGameEvents), null, 1), 'animate', 'a new game animates from nothing');
    assert.equal(planChange(update([{ type: 'hint', playerId: 'a', card: 1 }]), 4, 5), 'animate');
    assert.equal(planChange({ kind: 'snapshot', contiguous: false, events: [] }, null, 9), 'reconcile', 'join/rejoin snapshot');
    assert.equal(planChange(update([], false), 4, 9), 'reconcile', 'missed seq');
    assert.equal(planChange(update([{ type: 'hint', playerId: 'a', card: 1 }]), null, 5), 'reconcile', 'nothing shown yet');
    assert.equal(planChange(update([{ type: 'hint', playerId: 'a', card: 1 }]), 4, 5, { hidden: true }), 'reconcile');
    assert.equal(planChange(update([{ type: 'hint', playerId: 'a', card: 1 }]), 4, 5, { backlog: 3 }), 'reconcile');
    assert.equal(planChange(update([]), 5, 5), 'none', 'a seat change');
    assert.equal(planChange(update([]), 4, 5), 'reconcile', 'no events but the game moved');
    assert.equal(planChange(update([]), null, null), 'none', 'lobby');
  });

  test('diffBoard keeps, moves, removes and adds without touching kept cards', () => {
    const diff = diffBoard([1, 2, 3, 4], [4, 2, null, 9]);
    assert.deepEqual([...diff.remove].sort(), [1, 3]);
    assert.deepEqual(diff.keep, [
      { card: 4, slot: 0 },
      { card: 2, slot: 1 },
    ]);
    assert.deepEqual(diff.add, [{ card: 9, slot: 3 }]);
    assert.ok(sameBoard([1, 2, null], [1, 2]));
    assert.ok(!sameBoard([1, 2], [2, 1]));
  });

  test('pileOf: the last set and the set count', () => {
    const view = { players: [{ id: 'a', pile: [1, 2, 3, 4, 5, 6] }] } as unknown as PublicView;
    assert.deepEqual(pileOf(view, 'a'), { last: [4, 5, 6], sets: 2 });
    assert.deepEqual(pileOf(view, 'z'), { last: [], sets: 0 });
  });
});

// ── Train stats, bests and chart ─────────────────────────────────────────────────────────────

const A = (spot: number, pick: number, res: TrainAttempt['res'] = 'set', hinted = false): TrainAttempt => ({ spot, pick, res, hinted });

describe('train stats', () => {
  test('hinted sets, wrong picks and timeouts stay out of spot stats', () => {
    const at = [A(4000, 1000), A(2000, 3000), A(900, 800, 'set', true), A(500, 400, 'wrong'), A(700, 5000, 'time'), A(3000, 2000)];
    const s = trainStats(at);
    assert.equal(s.best, 2000);
    assert.equal(s.avg, 3000);
    assert.equal(s.median, 3000);
    assert.equal(s.avgPick, 2000);
    assert.equal(s.hinted, 1);
    assert.equal(s.sets, 4);
    assert.equal(s.wrong, 1);
    assert.equal(s.timeouts, 1);
    assert.deepEqual(trainStats([]), { avg: null, best: null, median: null, avgPick: null, hinted: 0, sets: 0, wrong: 0, timeouts: 0 });
    assert.equal(trainStats([A(1000, 1), A(3000, 1)]).median, 2000, 'even count: mean of the middle two');
  });

  test('personal bests: single any game, average only for a full game; corrupt storage is ignored', () => {
    const before = { avg: 3000, single: 1500 };
    const run = judgeRun(before, before, { avg: 2500, best: 1200 }, false);
    assert.deepEqual(run, { newSingle: true, newAvg: false, pb: { avg: 3000, single: 1200 } });
    const full = judgeRun(before, before, { avg: 2500, best: 1600 }, true);
    assert.deepEqual(full, { newSingle: false, newAvg: true, pb: { avg: 2500, single: 1500 } });
    assert.deepEqual(judgeRun({ avg: null, single: null }, { avg: null, single: null }, { avg: null, best: null }, true).pb, { avg: null, single: null });
    assert.deepEqual(parsePB('{"avg":4210,"single":1480}'), { avg: 4210, single: 1480 });
    assert.deepEqual(parsePB('nope'), { avg: null, single: null });
    assert.deepEqual(parsePB('{"avg":-1,"single":"x"}'), { avg: null, single: null });
    assert.deepEqual(parsePB(null), { avg: null, single: null });
  });

  test('NEW BEST during a game: beat this game’s best, or the stored best before the first set', () => {
    assert.equal(beatsBest(1000, null, null), false, 'nothing to beat yet');
    assert.equal(beatsBest(1000, null, 1200), true);
    assert.equal(beatsBest(1300, null, 1200), false);
    assert.equal(beatsBest(900, 1000, 500), true, 'the game best is the reference once there is one');
  });

  test('chart: nice axis, bars to scale, the best tagged, kinds and legend', () => {
    assert.equal(niceMax(0.4), 1);
    assert.equal(niceMax(7.16), 8);
    assert.equal(niceMax(11.4), 12);
    assert.equal(niceMax(700), 720);
    assert.equal(chartModel([]), null);
    const m = chartModel([A(6000, 1), A(2000, 1), A(1000, 1, 'set', true), A(1500, 1, 'wrong'), A(8000, 5000, 'time')]);
    assert.ok(m);
    assert.equal(m.axis, 8);
    assert.deepEqual(m.bars.map((b) => b.kind), ['set', 'best', 'hint', 'miss', 'late']);
    assert.equal(m.bars[0].height, 75);
    assert.equal(m.bars[4].height, 100);
    assert.deepEqual(m.legend, ['set', 'best', 'hint', 'miss', 'late']);
    assert.deepEqual(chartModel([A(500, 1, 'wrong')])?.legend, ['set', 'miss']);
  });
});

describe('spot clock', () => {
  test('runs from ready, freezes on SET!, waits while cards move, pauses for the menu', () => {
    const c = new SpotClock();
    assert.equal(c.state, 'init');
    c.start(1000);
    assert.equal(c.value(2840), 1840);
    c.pause(2000);
    assert.equal(c.display(9000), 1000, 'paused keeps its value');
    assert.ok(c.resume(5000));
    assert.equal(c.freeze(5500), 1500);
    assert.equal(c.state, 'frozen');
    c.wait(6000);
    assert.equal(c.state, 'wait');
    assert.equal(c.display(7000), 1500, 'the frozen spot stays on show while cards fly');
    c.start(8000);
    assert.equal(c.display(8100), 100);
    c.readyPaused();
    assert.equal(c.state, 'paused');
    c.over(9000);
    c.start(9500);
    assert.equal(c.state, 'over', 'nothing restarts a finished game');
  });
});

// ── Formatting and examples ──────────────────────────────────────────────────────────────────

describe('format', () => {
  test('spot times truncate; units and clocks', () => {
    assert.equal(fmtSpot('en', 1849), '1.84');
    assert.equal(fmtSpot('es', 1849), '1,84');
    assert.equal(fmtSpot('en', 12_345), '12.3');
    assert.equal(fmtSpot('en', 75_000), '1:15');
    assert.equal(fmtSpot('en', null), '–');
    assert.equal(fmtSpotU('es', 1840), '1,84 s');
    assert.equal(fmtSpotU('en', 75_000), '1:15');
    assert.equal(fmtSpotU('en', null), '–');
    assert.equal(fmtClock(251_000), '04:11');
    assert.equal(fmtScore(-2), '−2');
  });

  test('splitUnits isolates the seconds unit, not words that start with s', () => {
    const units = (text: string) =>
      splitUnits(text)
        .map((s) => (s.unit ? '[s]' : s.text))
        .join('');
    assert.equal(units('Training · 3 s countdown'), 'Training · 3 [s] countdown');
    assert.equal(units('Personal best · avg 4.16 s · single 1,31 s'), 'Personal best · avg 4.16 [s] · single 1,31 [s]');
    assert.equal(units('PICK 3 5s'), 'PICK 3 5[s]');
    assert.equal(units('3 sets · 2 misses'), '3 sets · 2 misses');
    assert.equal(units('no units'), 'no units');
    assert.equal(splitUnits('10 s').length, 2);
  });
});

describe('learn examples', () => {
  test('the fixed examples read as in the mockup', () => {
    assert.ok(isValid(EXAMPLES[0].ids), 'same colour and shading');
    assert.ok(isValid(EXAMPLES[1].ids), 'everything different');
    assert.ok(!isValid(EXAMPLES[2].ids), 'two green, one purple');
    const verdicts = judge(EXAMPLES[2].ids);
    assert.deepEqual(
      verdicts.map((v) => [v.feature, v.ok, v.odd]),
      [
        ['shape', true, -1],
        ['color', false, 2],
        ['number', true, -1],
        ['shading', true, -1],
      ],
    );
    assert.deepEqual(judge(EXAMPLES[0].ids).map((v) => v.same), [false, true, false, true]);
    assert.ok(isValid(LOGO_CARDS));
  });

  test('random examples: distinct cards, valid or broken in exactly one feature', () => {
    const rng = seeded(42);
    let valid = 0;
    for (let i = 0; i < 300; i++) {
      const ex = randomExample(rng);
      assert.equal(new Set(ex).size, 3);
      const broken = judge(ex).filter((v) => !v.ok).length;
      assert.ok(broken === 0 || broken === 1, `broken ${broken}`);
      if (broken === 0) valid++;
    }
    assert.ok(valid > 120 && valid < 240, `about 60% valid, got ${valid}/300`);
  });
});
