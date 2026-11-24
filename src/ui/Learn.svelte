<script lang="ts">
  // "What's a set?": the rule, the three fixed examples and a random one.
  import { EXAMPLES, randomExample } from '../game/examples.ts';
  import { ROLL_KF, T, anim } from '../game/motion.ts';
  import { play } from '../lib/audio/index.ts';
  import { t } from '../lib/i18n/locale.svelte.ts';
  import Example from './Example.svelte';

  let tryIds = $state(randomExample());
  let tryHost: HTMLElement | undefined = $state();

  /** The rule with its two emphasised phrases. */
  const rule = $derived(
    t('learn.rule')
      .split(/(\{same\}|\{diff\})/)
      .map((part) => (part === '{same}' ? { em: t('learn.ruleSame') } : part === '{diff}' ? { em: t('learn.ruleDiff') } : { text: part })),
  );

  function another(): void {
    tryIds = randomExample();
    play('flip');
    requestAnimationFrame(() => {
      tryHost?.querySelectorAll('.ex-card').forEach((c, k) =>
        anim(c, [{ transform: 'scale(1)' }, { transform: 'scale(1.18) rotate(-3deg)', offset: 0.35 }, { transform: 'scale(.95) rotate(1deg)', offset: 0.7 }, { transform: 'scale(1)' }], {
          duration: T(380),
          delay: k * 40,
          easing: 'ease-out',
          composite: 'add',
        }),
      );
      anim(tryHost?.querySelector('[data-verdict]'), ROLL_KF, { duration: T(420), easing: 'ease-out' });
    });
  }
</script>

<p class="learn-rule">
  {#each rule as part, i (i)}{#if 'em' in part}<em>{part.em}</em>{:else}{part.text}{/if}{/each}
</p>
{#each EXAMPLES as ex (ex.key)}
  <Example ids={ex.ids} title={t(ex.key)} />
{/each}
<div bind:this={tryHost}>
  <Example ids={tryIds} title={t('learn.exTry')} live />
</div>
<button class="btn btn-slate btn-wide" type="button" onclick={another}>{t('learn.another')}</button>
