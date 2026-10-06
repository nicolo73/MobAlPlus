<script lang="ts">
  import { guideHtml } from "../lib/content";

  // Copies d'écran : agrandies au toucher ; les liens « écran » du texte les ouvrent directement
  let zoom = $state<{ src: string; alt: string } | null>(null);
  let article: HTMLElement;
  function onclick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href") ?? "";
    if (href.startsWith("#") && !href.startsWith("#/")) {
      // Ancre interne (le routage de l'application utilise « #/… ») : copie d'écran ou section
      e.preventDefault();
      const target = article.querySelector<HTMLElement>(`[id="${CSS.escape(href.slice(1))}"]`);
      const img = target?.querySelector("img");
      if (img) zoom = { src: img.src, alt: img.alt };
      else target?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const img = (e.target as HTMLElement).closest(".shots img") as HTMLImageElement | null;
    if (img) {
      e.preventDefault();
      zoom = { src: img.src, alt: img.alt };
    }
  }
  function onkeydown(e: KeyboardEvent) { if (e.key === "Escape") zoom = null; }
</script>

<svelte:window {onkeydown} />

<div class="stack">
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <article class="card prose" bind:this={article} {onclick}>{@html guideHtml}</article>
</div>

{#if zoom}
  <button class="zoom" onclick={() => (zoom = null)} aria-label="Fermer l'image">
    <img src={zoom.src} alt={zoom.alt} />
    <span>{zoom.alt}</span>
  </button>
{/if}

<style>
  .prose :global(h1) { font-size: 1.4rem; }
  .prose :global(h2) { font-size: 1.1rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border); }
  .prose :global(ul) { padding-left: 1.25rem; margin: 0 0 0.75rem; }
  .prose :global(li) { margin-bottom: 0.3rem; }
  .prose :global(table) { margin: 0.5rem 0 0.75rem; width: auto; }
  .prose :global(p) { margin: 0 0 0.75rem; }
  .prose :global(:last-child) { margin-bottom: 0; }
  /* Petits symboles dans le texte */
  .prose :global(img[height="16"]) { height: 1.1em; width: auto; vertical-align: -0.2em; }
  /* Copies d'écran : grille de miniatures, agrandies au toucher */
  .prose :global(.shots) { display: grid; grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr)); gap: 0.6rem; }
  .prose :global(.shots img) { width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--border); cursor: zoom-in;
                               box-shadow: var(--shadow); }
  .prose :global(.shots a:last-child) { grid-column: span 2; }
  .zoom { position: fixed; inset: 0; z-index: 200; background: rgb(0 0 0 / 0.8); border: none; border-radius: 0;
          display: grid; place-items: center; align-content: center; gap: 0.5rem; padding: 1rem; cursor: zoom-out; }
  .zoom img { max-width: 100%; max-height: calc(100dvh - 4rem); border-radius: 10px; }
  .zoom span { color: #fff; font-size: 0.9rem; }
</style>
