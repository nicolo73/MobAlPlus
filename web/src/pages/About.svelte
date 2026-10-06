<script lang="ts">
  import { onMount } from "svelte";
  import { aboutHtml, buildInfo, markNewsSeen, newsHtml } from "../lib/content";

  let { onseen }: { onseen?: () => void } = $props();
  onMount(() => {
    markNewsSeen();
    onseen?.();
  });

  const built = new Date(buildInfo.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
</script>

<div class="stack">
  <article class="card prose">{@html aboutHtml}</article>

  <a class="card guide" href="#/aide">
    <strong>Guide d'utilisation</strong>
    <span class="muted">Courbes, tendances, import / export, partage, administration… ›</span>
  </a>

  <section class="card prose">
    <h2>Nouveautés</h2>
    {@html newsHtml}
  </section>

  <small class="muted">Version du {built}{#if buildInfo.commit}{" · "}<span class="num">{buildInfo.commit}</span>{/if}</small>
</div>

<style>
  .guide { display: grid; gap: 0.2rem; text-decoration: none; color: inherit; }
  .guide:hover { border-color: var(--primary); }
  .prose :global(h1) { font-size: 1.4rem; }
  .prose :global(h2) { font-size: 1.1rem; margin-top: 1.25rem; }
  .prose :global(h2:first-child) { margin-top: 0; }
  .prose :global(ul) { padding-left: 1.25rem; margin: 0 0 0.75rem; }
  .prose :global(li) { margin-bottom: 0.3rem; }
  .prose :global(hr) { border: none; border-top: 1px solid var(--border); margin: 1rem 0; }
  .prose :global(code) { font-size: 0.9em; background: var(--surface-2); padding: 0.05rem 0.3rem; border-radius: 4px; }
  .prose :global(:last-child) { margin-bottom: 0; }
</style>
