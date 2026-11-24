<script lang="ts">
  // A number that counts up from 0 with a tick per step, then pops (results screen).
  import { onMount } from 'svelte';
  import { EASE, anim, reducedMotion } from '../game/motion.ts';
  import { fmtScore } from '../game/format.ts';
  import { play } from '../lib/audio/index.ts';

  let { value, delay = 0, class: cls = '' }: { value: number; delay?: number; class?: string } = $props();

  let shown = $state(0);
  let el: HTMLElement;

  onMount(() => {
    if (reducedMotion() || value <= 0) {
      shown = value;
      return;
    }
    let n = 0;
    let iv = 0;
    const start = setTimeout(() => {
      iv = window.setInterval(
        () => {
          n++;
          shown = n;
          play('count', { pitch: 1 + Math.min(n, 30) * 0.025 });
          if (n >= value) {
            clearInterval(iv);
            void anim(el, [{ transform: 'scale(1.5) rotate(-6deg)' }, { transform: 'scale(1)' }], { duration: 360, easing: EASE.spring });
          }
        },
        Math.max(35, Math.min(110, 900 / value)),
      );
    }, delay);
    return () => {
      clearTimeout(start);
      clearInterval(iv);
    };
  });
</script>

<b class={cls} bind:this={el}>{fmtScore(shown)}</b>
