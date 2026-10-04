<script lang="ts">
  import { api } from "../lib/api";
  import { fmtAgo, fmtDate, fmtValue, isStale } from "../lib/format";
  import type { CurrentValue } from "../lib/types";

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

  /** Une carte par emplacement : température et humidité côte à côte */
  const byPlace = $derived.by(() => {
    const groups = new Map<number, { id: number; name: string; items: CurrentValue[] }>();
    for (const v of values ?? []) {
      if (!groups.has(v.place_id)) groups.set(v.place_id, { id: v.place_id, name: v.place_name, items: [] });
      groups.get(v.place_id)!.items.push(v);
    }
    return [...groups.values()];
  });
</script>

<div class="row" style="margin-bottom:1rem">
  <h1 style="margin:0">Maintenant</h1>
  <span class="spacer"></span>
  <button onclick={load}>Actualiser</button>
</div>

{#if error}
  <div class="notice err">{error}</div>
{:else if values === null}
  <p class="muted">Chargement…</p>
{:else if values.length === 0}
  <div class="card">
    <p>Aucun capteur n'est encore affecté à un emplacement.</p>
    <a href="#/admin/capteurs">Configurer les capteurs</a>
  </div>
{:else}
  <div class="grid">
    {#each byPlace as place (place.id)}
      {@const ts = place.items[0].ts}
      {@const stale = isStale(ts, now)}
      <a class="card place" class:stale href="#/lieu/{place.id}" aria-label="{place.name} : historique et courbes">
        <h2>{place.name} <span class="chev" aria-hidden="true">›</span></h2>
        <div class="values">
          {#each place.items as v (v.series_id)}
            <div class="value {v.property}">
              <span class="num big">{fmtValue(v.value, v.unit)}</span>
              <small>{v.property === "temperature" ? "température" : v.property === "humidity" ? "humidité" : v.property}</small>
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
