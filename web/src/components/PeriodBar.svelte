<script lang="ts">
  import { PRESETS, fmtRange, type Window } from "../lib/period";

  interface Props {
    window: Window;
    onchange: (w: Window) => void;
    loading?: boolean;
  }
  let { window, onchange, loading = false }: Props = $props();

  const width = $derived(window[1] - window[0]);
  const atNow = $derived(window[1] >= Date.now() - 60_000);

  // (période précédente / suivante : boutons ‹ › de part et d'autre de la barre de glissement des courbes)
  const setWidth = (ms: number) => onchange([window[1] - ms, window[1]]);
  const toNow = () => onchange([Date.now() - width, Date.now()]);
</script>

<div class="period">
  <div class="presets" role="group" aria-label="Durée affichée">
    {#each PRESETS as p (p.ms)}
      <button class:active={Math.abs(width - p.ms) < 60_000} aria-pressed={Math.abs(width - p.ms) < 60_000}
              onclick={() => setWidth(p.ms)}>{p.label}</button>
    {/each}
  </div>
  <div class="nav">
    <span class="range num" aria-live="polite">{fmtRange(window)}{#if loading}<span class="dot" aria-hidden="true"></span>{/if}</span>
    <button onclick={toNow} disabled={atNow}>Maintenant</button>
  </div>
</div>

<style>
  .period { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center; margin-top: 0.5rem; }
  .presets { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; flex: 0 1 auto; }
  .presets button { border: none; border-radius: 0; min-height: 2.25rem; padding: 0.35rem 0.7rem; flex: 1; justify-content: center; white-space: nowrap; }
  .presets button + button { border-left: 1px solid var(--border); }
  .presets button.active { background: var(--primary); color: var(--primary-text); font-weight: 600; }
  .nav { display: flex; align-items: center; gap: 0.35rem; flex: 1 1 20rem; min-width: 0; }
  .range { font-size: 0.9rem; flex: 1; min-width: 0; text-align: center; }
  @media (max-width: 600px) { .presets { flex: 1 1 100%; } }
  .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--primary);
         margin-left: 0.4rem; vertical-align: middle; animation: pulse 1s infinite alternate; }
  @keyframes pulse { to { opacity: 0.2; } }
</style>
