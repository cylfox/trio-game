<script lang="ts">
  // A static card face (lobby logo, examples, pile minis). `width` is the card's CSS width in px.
  import type { CardId } from '../lib/engine/engine.ts';
  import { symPx, symbolsHtml } from '../game/card-html.ts';

  interface Props {
    card: CardId;
    width: number;
    class?: string;
    style?: string;
    label?: string;
  }

  let { card, width, class: extra = '', style = '', label }: Props = $props();
</script>

<div
  class="cface {extra}"
  style="--symw:{symPx(width)}px;{style}"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <!-- trusted markup, generated from the symbol grids -->
  {@html symbolsHtml(card)}
</div>
