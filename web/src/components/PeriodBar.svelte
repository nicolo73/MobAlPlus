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

  const setWidth = (ms: number) => onchange([window[1] - ms, window[1]]);
  const shift = (dir: -1 | 1) => {
    const now = Date.now();
    const end = Math.min(window[1] + dir * width, now);
    onchange([end - width, end]);
  };
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
    <button onclick={() => shift(-1)} aria-label="Période précédente" title="Période précédente">‹</button>
    <span class="range num" aria-live="polite">{fmtRange(window)}{#if loading}<span class="dot" aria-hidden="true"></span>{/if}</span>
    <button onclick={() => shift(1)} disabled={atNow} aria-label="Période suivante" title="Période suivante">›</button>
    <button onclick={toNow} disabled={atNow}>Maintenant</button>
  </div>
</div>

<style>
  .period { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center; }
  .presets { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; flex: 0 1 auto; }
  .presets button { border: none; border-radius: 0; min-height: 2.25rem; padding: 0.35rem 0.7rem; flex: 1; justify-content: center; white-space: nowrap; }
  .presets button + button { border-left: 1px solid var(--border); }
  .presets button.active { background: var(--primary); color: var(--primary-text); font-weight: 600; }
  .nav { display: flex; align-items: center; gap: 0.35rem; flex: 1 1 20rem; min-width: 0; }
  .nav > button:not(:last-child) { min-width: 2.5rem; justify-content: center; font-size: 1.2rem; padding: 0.2rem 0.6rem; }
  .range { font-size: 0.9rem; flex: 1; min-width: 0; text-align: center; }
  @media (max-width: 600px) { .presets { flex: 1 1 100%; } }
  .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--primary);
         margin-left: 0.4rem; vertical-align: middle; animation: pulse 1s infinite alternate; }
  @keyframes pulse { to { opacity: 0.2; } }
</style>
