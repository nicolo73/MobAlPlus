<script lang="ts">
  import { api } from "../lib/api";
  import { canEdit } from "../lib/home.svelte";
  import { fmtAgo, fmtDate, fmtValue, isStale } from "../lib/format";
  import type { CurrentValue } from "../lib/types";
  import DisplayBar from "../components/DisplayBar.svelte";
  import { display, visibleProps } from "../lib/display.svelte";

  let values = $state<CurrentValue[] | null>(null);
  let error = $state("");
  let now = $state(Date.now());

  async function load() {
    try {
      values = await api.currentValues();
      now = Date.now();
      error = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  load();

  // Actualisation toutes les 2 minutes tant que la page est visible
  $effect(() => {
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 120_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  });

  const ORDER = ["temperature", "humidity"];
  const rank = (p: string) => (ORDER.indexOf(p) + 9) % 9;
  /** Grandeurs présentes, et celles affichées (choix commun avec les courbes) */
  const properties = $derived.by(() => {
    const m = new Map<string, string>();
    for (const v of values ?? []) m.set(v.property, v.property === "temperature" ? "Temp." : v.property === "humidity" ? "Hum." : v.property);
    return [...m].map(([code, name]) => ({ code, name })).sort((a, b) => rank(a.code) - rank(b.code));
  });
  const visible = $derived(visibleProps(properties.map((p) => p.code)));

  /** Une carte par emplacement : température et humidité côte à côte */
  const byPlace = $derived.by(() => {
    const groups = new Map<number, { id: number; name: string; items: CurrentValue[] }>();
    for (const v of values ?? []) {
      if (!visible.includes(v.property)) continue;
      if (!groups.has(v.place_id)) groups.set(v.place_id, { id: v.place_id, name: v.place_name, items: [] });
      groups.get(v.place_id)!.items.push(v);
    }
    return [...groups.values()];
  });
</script>

<div class="row head">
  <h1 style="margin:0">Maintenant</h1>
  <span class="spacer"></span>
  {#if properties.length > 1}<DisplayBar {properties} curves={false} small />{/if}
  <button class="refresh" onclick={load} title="Actualiser" aria-label="Actualiser">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
  </button>
</div>

{#if error}
  <div class="notice err">{error}</div>
{:else if values === null}
  <p class="muted">Chargement…</p>
{:else if values.length === 0}
  <div class="card">
    <p>Aucun capteur n'est encore affecté à un emplacement de cette maison.</p>
    {#if canEdit()}<a href="#/admin/capteurs">Configurer les capteurs</a>{/if}
  </div>
{:else}
  <div class="grid now" class:compact={display.density === "compact"}>
    {#each byPlace as place (place.id)}
      {@const ts = place.items[0].ts}
      {@const stale = isStale(ts, now)}
      <a class="card place" class:stale href="#/lieu/{place.id}" aria-label="{place.name} : historique et courbes">
        <h2>{place.name} <span class="chev" aria-hidden="true">›</span></h2>
        <div class="values">
          {#each place.items as v (v.series_id)}
            <div class="value {v.property}">
              <span class="num big">{fmtValue(v.value, v.unit)}</span>
              <small class:hide={visible.length === 1 && display.density === "compact"}>{v.property === "temperature" ? "température" : v.property === "humidity" ? "humidité" : v.property}</small>
            </div>
          {/each}
        </div>
        <small title={fmtDate(ts)}>
          {#if stale}<span class="badge warn">ancienne</span>{/if}
          {fmtAgo(ts, now)}
        </small>
      </a>
    {/each}
  </div>
{/if}

<style>
  .head { margin-bottom: 1rem; flex-wrap: nowrap; gap: 0.5rem; }
  .head h1 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hide { display: none; }
  .refresh { min-height: 2rem; padding: 0.3rem 0.5rem; }
  .refresh svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  /* Présentation compacte : fiches plus étroites (2 colonnes sur téléphone), valeurs plus petites */
  .now.compact { grid-template-columns: repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr)); }
  .compact .place h2 { font-size: 0.9rem; margin-bottom: 0.35rem; }
  .compact .values { gap: 0.25rem 1rem; margin-bottom: 0.25rem; }
  .compact .big { font-size: 1.35rem; }
  .compact .value small { font-size: 0.75rem; }
  .place { display: block; color: inherit; text-decoration: none; transition: border-color 0.15s; }
  .place:hover { border-color: var(--primary); }
  .place h2 { font-size: 1rem; color: var(--muted); font-weight: 600; display: flex; justify-content: space-between; }
  .chev { color: var(--primary); font-size: 1.3rem; line-height: 1; }
  .values { display: flex; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
  .value { display: grid; }
  .big { font-size: 1.75rem; font-weight: 700; line-height: 1.1; }
  .temperature .big { color: var(--temp); }
  .humidity .big { color: var(--hum); }
  .stale .big { opacity: 0.6; }
</style>
