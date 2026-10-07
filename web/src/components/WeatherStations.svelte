<script lang="ts">
  // Stations météo publiques de la maison : capteurs virtuels Open-Meteo, collectés par le serveur
  // toutes les 30 minutes et rangés comme des emplacements (Admin › Emplacements).
  import { api } from "../lib/api";
  import { searchPlace, type Location } from "../lib/weather";
  import { ctx } from "../lib/home.svelte";
  import { loadWeatherStations, primaryStation } from "../lib/weather-state.svelte";
  import type { Device } from "../lib/types";

  let stations = $state<Device[]>([]);
  let query = $state("");
  let results = $state<(Location & { detail: string })[]>([]);
  let busy = $state(false);
  let error = $state("");
  let info = $state("");

  async function refresh() {
    try {
      stations = (await api.devices()).filter((d) => d.vendor === "open_meteo" && d.active);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  refresh();

  async function run(fn: () => Promise<void>) {
    error = info = "";
    busy = true;
    try { await fn(); } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  const search = (e: SubmitEvent) => {
    e.preventDefault();
    return run(async () => {
      results = await searchPlace(query.trim());
      if (!results.length) info = "Aucune commune trouvée.";
    });
  };
  const add = (loc: Location) => run(async () => {
    const label = loc.label ?? "Position";
    await api.addWeatherStation(label, loc.lat, loc.lon);
    results = [];
    query = "";
    info = `Station « Météo · ${label} » ajoutée : récupération de son historique (un an)…`;
    try {
      await api.collectWeather();
      info = `Station « Météo · ${label} » ajoutée, avec un an d'historique. Elle apparaît sur la page Maintenant et dans les courbes.`;
    } catch {
      info = `Station « Météo · ${label} » ajoutée : ses mesures arriveront à la prochaine collecte (sous 30 minutes).`;
    }
    await Promise.all([refresh(), loadWeatherStations(ctx.homeId)]);
  });
  const retire = (d: Device) => run(async () => {
    await api.retireDevice(d.id);
    await Promise.all([refresh(), loadWeatherStations(ctx.homeId)]);
    info = `${d.name} n'est plus collectée. Son emplacement et son historique restent (supprimables dans Admin › Emplacements).`;
  });
  function here() {
    error = info = "";
    navigator.geolocation?.getCurrentPosition(
      (p) => add({ lat: Math.round(p.coords.latitude * 1e4) / 1e4, lon: Math.round(p.coords.longitude * 1e4) / 1e4, label: "Ma position" }),
      () => (error = "Position refusée ou indisponible : chercher plutôt la commune."),
      { enableHighAccuracy: false, timeout: 10000 });
  }
</script>

<div class="stack">
  <p class="muted" style="margin:0">Pour comparer vos capteurs à la <strong>météo publique</strong> (température et humidité
    extérieures, Open-Meteo) : ajouter une station pour la commune de la maison, ou plusieurs communes. Chaque station
    est un capteur virtuel relevé par le serveur toutes les 30 minutes : elle a sa fiche, ses courbes et ses alertes,
    et se range où l'on veut dans les emplacements (par exemple dans un groupe « Sites météo »).</p>
  {#if stations.length}
    <ul class="list">
      {#each stations as d (d.id)}
        <li>
          <span>☁ <strong>{d.name}</strong>{#if d.channels.some((c) => c.place_id === primaryStation()?.placeId)} <small class="muted">· courbe « Météo » des graphiques</small>{/if}</span>
          <span class="spacer"></span>
          <button class="link danger" disabled={busy}
                  onclick={() => confirm(`Arrêter la collecte de ${d.name} ? Son historique est conservé.`) && retire(d)}>retirer</button>
        </li>
      {/each}
    </ul>
  {/if}
  <form class="row add" onsubmit={search}>
    <label>Commune <input bind:value={query} placeholder="ex. Toulouse" /></label>
    <button type="submit" disabled={!query.trim() || busy}>Chercher</button>
    <button type="button" disabled={busy} onclick={here}>Ma position</button>
  </form>
  {#if results.length}
    <ul class="results">
      {#each results as r (r.lat + "," + r.lon)}
        <li><button class="link" disabled={busy} onclick={() => add(r)}>Ajouter {r.label}</button>
          <small class="muted">{r.detail}</small></li>
      {/each}
    </ul>
  {/if}
  {#if busy}<small class="muted">…</small>{/if}
  {#if error}<div class="notice err">{error}</div>{/if}
  {#if info}<div class="notice">{info}</div>{/if}
</div>

<style>
  .add { align-items: end; }
  .add label { flex: 1 1 12rem; }
  .add input { width: 100%; }
  .list, .results { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; }
  .list li { display: flex; align-items: center; gap: 0.5rem; }
  .danger { color: var(--err); }
</style>
