<script lang="ts">
  // Position de la maison pour la météo publique : recherche d'une commune ou position du téléphone.
  import { api } from "../lib/api";
  import { searchPlace, type Location } from "../lib/weather";
  import { homeWeather } from "../lib/weather-state.svelte";

  let { homeId }: { homeId: number } = $props();

  let query = $state("");
  let results = $state<(Location & { detail: string })[]>([]);
  let busy = $state(false);
  let error = $state("");
  let info = $state("");

  async function search(e: SubmitEvent) {
    e.preventDefault();
    error = info = "";
    busy = true;
    try {
      results = await searchPlace(query.trim());
      if (!results.length) info = "Aucune commune trouvée.";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
  async function save(loc: Location | null) {
    error = info = "";
    try {
      await api.setHomeLocation(homeId, loc);
      homeWeather.loc = loc;
      results = [];
      query = "";
      info = loc ? `Météo : ${loc.label ?? "position enregistrée"}.` : "Météo désactivée pour cette maison.";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  function here() {
    error = info = "";
    navigator.geolocation?.getCurrentPosition(
      (p) => save({ lat: Math.round(p.coords.latitude * 1e4) / 1e4, lon: Math.round(p.coords.longitude * 1e4) / 1e4, label: "Position du téléphone" }),
      () => (error = "Position refusée ou indisponible : chercher plutôt la commune."),
      { enableHighAccuracy: false, timeout: 10000 });
  }
</script>

<div class="stack">
  <p class="muted" style="margin:0">Pour comparer vos capteurs à la <strong>météo publique</strong> (température et humidité
    extérieures, Open-Meteo) : indiquer la commune de la maison. La position, arrondie, n'est visible que des
    membres de la maison.</p>
  {#if homeWeather.loc}
    <div class="row">
      <span>📍 <strong>{homeWeather.loc.label ?? "Position"}</strong>
        <small class="muted num">({homeWeather.loc.lat.toFixed(2)}, {homeWeather.loc.lon.toFixed(2)})</small></span>
      <button class="link danger" onclick={() => save(null)}>retirer</button>
    </div>
  {/if}
  <form class="row add" onsubmit={search}>
    <label>Commune <input bind:value={query} placeholder="ex. Toulouse" /></label>
    <button type="submit" disabled={!query.trim() || busy}>Chercher</button>
    <button type="button" onclick={here}>Ma position</button>
  </form>
  {#if results.length}
    <ul class="results">
      {#each results as r (r.lat + "," + r.lon)}
        <li><button class="link" onclick={() => save({ lat: r.lat, lon: r.lon, label: r.label })}>{r.label}</button>
          <small class="muted">{r.detail}</small></li>
      {/each}
    </ul>
  {/if}
  {#if error}<div class="notice err">{error}</div>{/if}
  {#if info}<div class="notice">{info}</div>{/if}
</div>

<style>
  .add { align-items: end; }
  .add label { flex: 1 1 12rem; }
  .add input { width: 100%; }
  .results { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; }
  .danger { color: var(--err); }
</style>
