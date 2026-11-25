<script lang="ts">
  // A static card (lobby logo, examples, rules, pile minis): the board's own card markup
  // (cardHtml), at rest. The element's font-size is the card's width, so the whole card scales as
  // one; the symbols stay snapped to whole device pixels.
  //   fit (default)  resize the card a little so its snapped symbol keeps the board's proportion
  //   fit={false}    exactly `width` px (pile minis, which board cards fly into at that size)
  import type { CardId } from '../lib/engine/engine.ts';
  import { cardHtml, fitCard, symPx } from '../game/card-html.ts';

  interface Props {
    /** null with `back`: just a card back. */
    card: CardId | null;
    /** The card's CSS width in px (before fitting). */
    width: number;
    fit?: boolean;
    back?: boolean;
    class?: string;
    style?: string;
    label?: string;
  }

  let { card, width, fit = true, back = false, class: extra = '', style = '', label }: Props = $props();

  const size = $derived(fit ? fitCard(width) : { w: width, sym: symPx(width) });
</script>

<div
  class="card still {extra}"
  style="font-size:{size.w}px;--symw:{size.sym}px;{style}"
  data-card={card ?? undefined}
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <!-- trusted markup, generated from the symbol grids -->
  {@html cardHtml(card, !back)}
</div>
