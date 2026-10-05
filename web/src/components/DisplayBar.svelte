<script lang="ts">
  import { display, setSmooth, toggleProp, visibleProps } from "../lib/display.svelte";

  /** Grandeurs présentes sur la page, dans l'ordre d'affichage */
  let { properties }: { properties: { code: string; name: string }[] } = $props();

  const codes = $derived(properties.map((p) => p.code));
  const visible = $derived(visibleProps(codes));
</script>

<div class="display">
  {#if properties.length > 1}
    <div class="seg" role="group" aria-label="Grandeurs affichées">
      {#each properties as p (p.code)}
        {@const on = visible.includes(p.code)}
        <button class:active={on} aria-pressed={on} onclick={() => toggleProp(p.code, codes)}
                title={on && visible.length === 1 ? "Au moins une grandeur reste affichée" : on ? `Masquer : ${p.name}` : `Afficher : ${p.name}`}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            {#if on}<path d="M5 12l5 5 9-10" />{:else}<path d="M7 7l10 10M17 7L7 17" />{/if}
          </svg>
          {p.name}
        </button>
      {/each}
    </div>
  {/if}
  <div class="seg" role="group" aria-label="Rendu des courbes">
    <button class:active={!display.smooth} aria-pressed={!display.smooth} onclick={() => setSmooth(false)}
            title="Rendu fidèle : la valeur reste constante jusqu'à la mesure suivante">Escalier</button>
    <button class:active={display.smooth} aria-pressed={display.smooth} onclick={() => setSmooth(true)}
            title="Rendu adouci entre les mesures (affichage seulement, les données ne changent pas)">Lissé</button>
  </div>
</div>

<style>
  .display { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center; }
  .seg { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; max-width: 100%; }
  .seg button { border: none; border-radius: 0; min-height: 2.1rem; padding: 0.3rem 0.7rem; font-size: 0.9rem;
                white-space: nowrap; color: var(--muted); gap: 0.3rem; }
  .seg button + button { border-left: 1px solid var(--border); }
  .seg button.active { background: var(--primary-soft); color: var(--text); font-weight: 600; }
  svg { fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
</style>
