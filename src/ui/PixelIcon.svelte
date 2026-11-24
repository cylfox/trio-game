<script lang="ts">
  // A pixel icon from icons.ts, in the current text colour (shape-rendering crispEdges).
  import { pixelPaths } from '../lib/symbols.ts';
  import { ICONS } from './icons.ts';
  import type { IconName } from './icons.ts';

  interface Props {
    name: IconName;
    /** Height in em; the width follows the grid. */
    size?: number;
    label?: string;
  }

  let { name, size = 0.7, label }: Props = $props();
  const image = $derived(pixelPaths(ICONS[name], { '#': 'currentColor' }));
</script>

<svg
  class="picon"
  viewBox={image.viewBox}
  shape-rendering="crispEdges"
  style:height="{size}em"
  style:width="{(size * image.width) / image.height}em"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  {#each image.paths as path (path.fill)}
    <path fill={path.fill} d={path.d} />
  {/each}
</svg>
