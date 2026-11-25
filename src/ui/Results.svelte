<script lang="ts">
  // Results. Versus: ranking with scores counting up, trios and misses, rematch. Train: spot-time
  // stats, counts, personal bests and the per-call chart.
  import { onMount } from 'svelte';
  import type { GameController } from '../game/controller.svelte.ts';
  import { PCOLORS } from '../game/controller.svelte.ts';
  import { fmtClock, fmtSpotU } from '../game/format.ts';
  import { S, T, anim, rand, reducedMotion } from '../game/motion.ts';
  import { play } from '../lib/audio/index.ts';
  import { locale, t } from '../lib/i18n/locale.svelte.ts';
  import { enter } from './attach.ts';
  import SpotChart from './SpotChart.svelte';
  import TickNumber from './TickNumber.svelte';
  import Units from './Units.svelte';

  let { ctl, onlobby }: { ctl: GameController; onlobby: () => void } = $props();

  let confettiEl: HTMLElement;
  let badgeEl: HTMLElement | undefined = $state();
  let asked = $state(false);

  const view = $derived(ctl.view);
  const players = $derived(view?.players ?? []);
  const top = $derived(Math.max(...players.map((p) => p.score)));
  const leaders = $derived(players.filter((p) => p.score === top));
  const draw = $derived(leaders.length > 1);
  const won = $derived(!draw && leaders[0]?.id === ctl.me);
  const ranked = $derived(players.slice().sort((a, b) => b.score - a.score));
  const elapsed = $derived(view === null ? 0 : Math.max(0, (ctl.endedAt || ctl.session.hostNow()) - view.startedAt));

  // Rematch: the host (the room's creator) starts it; a guest asks through the rematch intent.
  const room = $derived(ctl.snap.room);
  const isHost = $derived(ctl.isHost);
  const mySeat = $derived(room?.seats.find((s) => s.id === ctl.me));
  const otherSeat = $derived(room?.seats.find((s) => s.id !== ctl.me));
  const rematchStatus = $derived.by(() => {
    if (ctl.isTrain || !room) return '';
    if (otherSeat && !otherSeat.connected) return t('res.peerGone', { name: ctl.nameOf(otherSeat.id) });
    if (mySeat?.rematch) return t('res.rematchWait', { name: otherSeat ? ctl.nameOf(otherSeat.id) : '' });
    if (otherSeat?.rematch) return t('res.rematchAsked', { name: ctl.nameOf(otherSeat.id) });
    return '';
  });

  // Train
  const stats = $derived(ctl.trainStats);
  const verdict = $derived(ctl.isTrain ? ctl.verdict() : null);
  const trainElapsed = $derived(ctl.t0 === 0 ? 0 : (ctl.tEnd || performance.now()) - ctl.t0);
  const foot = $derived.by(() => {
    if (!ctl.isTrain || verdict === null) return t('res.footVs', { time: fmtClock(elapsed), code: ctl.snap.code ?? '' });
    const pb = verdict.pb;
    const lines = [
      pb.single === null
        ? t('pb.none')
        : pb.avg === null
          ? t('pb.single', { single: fmtSpotU(locale.lang, pb.single) })
          : t('pb.both', { avg: fmtSpotU(locale.lang, pb.avg), single: fmtSpotU(locale.lang, pb.single) }),
    ];
    if (!ctl.full) lines.push(t('pb.notFull'));
    if (stats.hinted > 0) lines.push(t('pb.hintNote'));
    return lines.join('\n');
  });

  function again(): void {
    play('ui');
    if (ctl.isTrain || isHost) ctl.session.act({ type: 'start' });
    else {
      asked = true;
      ctl.session.act({ type: 'rematch' });
    }
  }

  onMount(() => {
    const celebrate = ctl.isTrain || won || draw;
    play(celebrate ? 'win' : 'lose');
    if (verdict && (verdict.newAvg || verdict.newSingle)) {
      setTimeout(() => play('newBest'), 700);
      void anim(
        badgeEl,
        [
          { transform: 'scale(2.2) rotate(-12deg)', opacity: 0 },
          { transform: 'scale(.94) rotate(-4deg)', opacity: 1, offset: 0.5 },
          { transform: 'rotate(-4deg)', opacity: 1 },
        ],
        { duration: T(520), delay: S(350), easing: 'ease-out', fill: 'backwards' },
      );
    }
    if (!(ctl.isTrain || won) || reducedMotion()) return;
    const cols = ['var(--you)', 'var(--partner)', 'var(--cream)', 'var(--p3)'];
    const h = confettiEl.clientHeight || 700;
    for (let i = 0; i < 34; i++) {
      const c = document.createElement('i');
      c.style.left = `${rand(0, 100)}%`;
      c.style.background = cols[Math.floor(Math.random() * cols.length)];
      confettiEl.appendChild(c);
      void anim(
        c,
        [
          { transform: 'translateY(0) rotate(0)', opacity: 1 },
          { transform: `translate(${rand(-40, 40)}px,${h + 30}px) rotate(${rand(-540, 540)}deg)`, opacity: 0.9 },
        ],
        { duration: rand(1600, 2800), delay: rand(0, 700), easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'backwards' },
      ).then(() => c.remove());
    }
  });
</script>

<section class="screen scr-results" aria-label={t('aria.results')} {@attach enter('screen')}>
  <div class="confetti" aria-hidden="true" bind:this={confettiEl}></div>
  <div class="results">
    {#if ctl.isTrain}
      <p class="res-kicker">{t('res.trainDone')}</p>
      <h2 class="res-title" style="--rc:var(--you)" role="status">{t('res.niceRun')}</h2>
      {#if verdict && (verdict.newAvg || verdict.newSingle)}<div class="res-best" bind:this={badgeEl}>{t('stamp.newBest')}</div>{/if}
      <div class="res-train">
        <p class="res-kicker">{t('res.spotHead')}</p>
        <div class="res-stats">
          <div class="res-stat" class:pb={verdict?.newAvg}><b>{fmtSpotU(locale.lang, stats.avg)}</b><span>{t('res.avg')}</span></div>
          <div class="res-stat" class:pb={verdict?.newSingle}><b>{fmtSpotU(locale.lang, stats.best)}</b><span>{t('res.best')}</span></div>
          <div class="res-stat"><b>{fmtSpotU(locale.lang, stats.median)}</b><span>{t('res.median')}</span></div>
        </div>
        <div class="res-stats res-mini">
          <div class="res-stat">
            <TickNumber value={stats.sets} /><span>{t('res.setsLabel')}</span>{#if stats.hinted > 0}<small>{t('res.hinted', { count: stats.hinted })}</small>{/if}
          </div>
          <div class="res-stat"><TickNumber value={stats.wrong} /><span>{t('res.wrong')}</span></div>
          <div class="res-stat"><TickNumber value={stats.timeouts} /><span>{t('res.timeouts')}</span></div>
          <div class="res-stat"><TickNumber value={ctl.myStats?.hints ?? 0} /><span>{t('res.hints')}</span></div>
          <div class="res-stat"><b>{fmtSpotU(locale.lang, stats.avgPick)}</b><span>{t('res.avgPick')}</span></div>
          <div class="res-stat"><b>{fmtClock(trainElapsed)}</b><span>{t('res.time')}</span></div>
        </div>
        <SpotChart attempts={ctl.attempts} />
      </div>
    {:else}
      <p class="res-kicker">{t('res.gameOver')}</p>
      <h2
        class="res-title"
        role="status"
        style="--rc:{draw ? 'var(--ink)' : ctl.colorOf(leaders[0]?.id ?? '').c}"
      >
        {draw ? t('res.draw') : won ? t('res.youWin') : t('res.wins', { name: ctl.nameOf(leaders[0]?.id ?? '') })}
      </h2>
      <div class="slab res-list">
        {#each ranked as p, rank (p.id)}
          {@const c = ctl.colorOf(p.id) ?? PCOLORS[0]}
          <div class="res-row" class:winner={!draw && p.id === leaders[0]?.id} style="--pc:{c.c};--pc-dim:{c.dim};--pc-glow:{c.glow}">
            <span class="res-rank">{rank + 1}</span>
            <span class="res-who">
              <span class="res-name">{p.id === ctl.me && ctl.namedMe() ? t('res.youSuffix', { name: ctl.nameOf(p.id) }) : ctl.nameOf(p.id)}</span>
              <span class="res-sub">{t('res.sets', { count: p.foundAt.length })} · {t('res.misses', { count: p.mistakes + p.timeouts })}</span>
            </span>
            <TickNumber value={p.score} class="res-score" delay={rank * 120} />
          </div>
        {/each}
      </div>
    {/if}
    <p class="res-kicker res-foot"><Units text={foot} /></p>
    <div class="res-actions">
      {#if rematchStatus}<p class="res-kicker res-status" role="status">{rematchStatus}</p>{/if}
      <button class="btn btn-wide btn-big" type="button" disabled={!ctl.isTrain && !isHost && (asked || !!mySeat?.rematch)} onclick={again}
        >{ctl.isTrain ? t('res.again') : t('res.rematch')}</button
      >
      <button class="btn btn-slate btn-wide" type="button" onclick={() => (play('ui'), onlobby())}>{t('res.toLobby')}</button>
    </div>
  </div>
</section>
