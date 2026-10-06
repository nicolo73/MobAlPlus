<script lang="ts">
  import { guideHtml } from "../lib/content";
</script>

<div class="stack">
  <article class="card prose">{@html guideHtml}</article>
</div>

<style>
  .prose :global(h1) { font-size: 1.4rem; }
  .prose :global(h2) { font-size: 1.1rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border); }
  .prose :global(ul) { padding-left: 1.25rem; margin: 0 0 0.75rem; }
  .prose :global(li) { margin-bottom: 0.3rem; }
  .prose :global(table) { margin: 0.5rem 0 0.75rem; }
  .prose :global(p) { margin: 0 0 0.75rem; }
  .prose :global(:last-child) { margin-bottom: 0; }
</style>
