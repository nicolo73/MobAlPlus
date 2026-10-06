<script lang="ts">
  import { guideHtml } from "../lib/content";

  // Toucher une illustration l'affiche en grand
  let zoom = $state<{ src: string; alt: string } | null>(null);
  function onclick(e: MouseEvent) {
    const img = (e.target as HTMLElement).closest("img");
    if (img) zoom = { src: img.src, alt: img.alt };
  }
  function onkeydown(e: KeyboardEvent) { if (e.key === "Escape") zoom = null; }
</script>

<svelte:window {onkeydown} />

<div class="stack">
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <article class="card prose" {onclick}>{@html guideHtml}</article>
</div>

{#if zoom}
  <button class="zoom" onclick={() => (zoom = null)} aria-label="Fermer l'image">
    <img src={zoom.src} alt={zoom.alt} />
    <span>{zoom.alt}</span>
  </button>
{/if}

<style>
  .prose :global(h1) { font-size: 1.4rem; }
  .prose :global(h2) { font-size: 1.1rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border); clear: both; }
  .prose :global(ul) { padding-left: 1.25rem; margin: 0 0 0.75rem; }
  .prose :global(li) { margin-bottom: 0.3rem; }
  .prose :global(table) { margin: 0.5rem 0 0.75rem; }
  .prose :global(p) { margin: 0 0 0.75rem; }
  .prose :global(blockquote) { margin: 0 0 1rem; padding: 0.4rem 0.8rem; border-left: 3px solid var(--border); color: var(--muted); }
  .prose :global(:last-child) { margin-bottom: 0; }
  /* Illustrations en miniature, à droite du texte ; agrandies au toucher */
  .prose :global(img) { width: 34%; max-width: 220px; height: auto; border-radius: 10px; border: 1px solid var(--border);
                        box-shadow: var(--shadow); cursor: zoom-in; background: var(--surface-2); }
  .prose :global(img[align="right"]) { float: right; margin: 0.2rem 0 0.75rem 1rem; }
  .prose :global(.gallery) { display: flex; flex-wrap: wrap; gap: 0.75rem; clear: both; }
  .prose :global(.gallery img) { width: calc(50% - 0.4rem); }
  @media (min-width: 700px) { .prose :global(.gallery img) { width: 220px; } }
  .zoom { position: fixed; inset: 0; z-index: 200; background: rgb(0 0 0 / 0.8); border: none; border-radius: 0;
          display: grid; place-items: center; align-content: center; gap: 0.5rem; padding: 1rem; cursor: zoom-out; }
  .zoom img { max-width: 100%; max-height: calc(100dvh - 4rem); border-radius: 10px; }
  .zoom span { color: #fff; font-size: 0.9rem; }
</style>
