<script lang="ts">
  // Symbole « capteur » : un point qui émet (ondes), comme le wifi
  let { title = "capteur affecté", size = "1.15em" }: { title?: string; size?: string } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={title}>
  <title>{title}</title>
  <circle cx="12" cy="17" r="1.8" />
  <path d="M8.6 13.6a4.8 4.8 0 0 1 6.8 0M5.6 10.6a9 9 0 0 1 12.8 0" />
</svg>

<style>
  svg { vertical-align: -0.15em; color: var(--primary); }
  circle { fill: currentColor; }
  path { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
</style>
