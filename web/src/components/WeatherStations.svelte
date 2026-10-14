<script lang="ts">
  // Stations météo de la maison : capteurs virtuels Open-Meteo, collectés par le serveur toutes les
  // 30 minutes et rangés comme des emplacements (Admin › Emplacements).
  //  - commune : station publique, commune à toutes les maisons qui suivent cette commune (celle
  //    qui existe déjà à moins de 3 km est reprise : pas de doublon, une seule collecte) ;
  //  - « Ma position » : station privée (la position exacte de la maison n'est pas partagée).
  import { api } from "../lib/api";
  import { searchPlace, type Location } from "../lib/weather";
  import { canEdit, ctx } from "../lib/home.svelte";
  import { loadWeatherStations, primaryStation } from "../lib/weather-state.svelte";
  import type { Device, Place, PublicStation } from "../lib/types";

  let stations = $state<Place[]>([]);
  let devices = $state<Device[]>([]);
  let query = $state("");
  let results = $state<(Location & { detail: string })[]>([]);
  /** Stations publiques déjà suivies près des communes trouvées */
  let nearby = $state<PublicStation[]>([]);
  let busy = $state(false);
  let error = $state("");
  let info = $state("");

  async function refresh() {
    try {
      const [pl, devs] = await Promise.all([api.places(), api.devices()]);
      stations = pl.filter((p) => p.kind === "weather");
      devices = devs;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  refresh();
  /** Capteur virtuel d'une station privée de la maison (pour arrêter sa collecte) */
  const deviceOf = (p: Place) => devices.find((d) => d.active && d.channels.some((c) => c.place_id === p.id));

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
      nearby = [];
      if (!results.length) { info = "Aucune commune trouvée."; return; }
      const r = results[0];
      nearby = (await api.publicStations(r.lat, r.lon, 15).catch(() => [])).filter((s) => !stations.some((x) => x.id === s.place_id));
    });
  };
  async function done(label: string) {
    results = [];
    nearby = [];
    query = "";
    try {
      await api.collectWeather();
      info = `Station « ${label} » ajoutée. Elle apparaît sur la page Maintenant et dans les courbes.`;
    } catch {
      info = `Station « ${label} » ajoutée : ses mesures arriveront à la prochaine collecte (sous 30 minutes).`;
    }
    await Promise.all([refresh(), loadWeatherStations(ctx.homeId)]);
  }
  const add = (loc: Location, isPublic: boolean) => run(async () => {
    const label = loc.label ?? "Position";
    info = `Ajout de « Météo · ${label} »…`;
    await api.addWeatherStation(label, loc.lat, loc.lon, isPublic);
    await done(`Météo · ${label}`);
  });
  const addExisting = (s: PublicStation) => run(async () => {
    await api.linkPlace(s.place_id);
    await done(s.name);
  });
  const unlink = (p: Place) => run(async () => {
    await api.unlinkPlace(p.id);
    await Promise.all([refresh(), loadWeatherStations(ctx.homeId)]);
    info = `${p.name} est retirée de la maison (vos alertes sur cette station aussi).`;
  });
  const retire = (p: Place, d: Device) => run(async () => {
    await api.retireDevice(d.id);
    await Promise.all([refresh(), loadWeatherStations(ctx.homeId)]);
    info = `${p.name} n'est plus collectée. Son emplacement et son historique restent (supprimables dans Admin › Emplacements).`;
  });
  const makePublic = (p: Place) => run(async () => {
    await api.makeStationPublic(p.id);
    await refresh();
    info = `${p.name} est désormais publique : les autres maisons de la commune pourront la suivre au lieu d'en créer une autre.`;
  });
  function here() {
    error = info = "";
    navigator.geolocation?.getCurrentPosition(
      (p) => add({ lat: Math.round(p.coords.latitude * 1e4) / 1e4, lon: Math.round(p.coords.longitude * 1e4) / 1e4, label: "Ma position" }, false),
      () => (error = "Position refusée ou indisponible : chercher plutôt la commune."),
      { enableHighAccuracy: false, timeout: 10000 });
  }
</script>

<div class="stack">
  <p class="muted" style="margin:0">Pour comparer vos capteurs à la <strong>météo publique</strong> (température et humidité
    extérieures, Open-Meteo) : ajouter la station de la commune de la maison, ou de plusieurs communes. Une station de
    commune est <strong>publique</strong> : commune à toutes les maisons qui suivent cette commune (une seule collecte,
    un seul historique) ; chaque maison y règle ses propres alertes. « Ma position » crée une station
    <strong>privée</strong> (la position exacte de la maison n'est pas partagée).</p>
  {#if stations.length}
    <ul class="list">
      {#each stations as p (p.id)}
        {@const dev = p.shared ? undefined : deviceOf(p)}
        <li>
          <span>☁ <strong>{p.name}</strong>
            {#if p.shared?.public}<span class="badge ok">publique</span>{:else if p.shared}<span class="badge">partagée · {p.shared.from}</span>{:else}<span class="badge">privée</span>{/if}
            {#if p.id === primaryStation()?.placeId} <small class="muted">· courbe « Météo » des graphiques</small>{/if}</span>
          <span class="spacer"></span>
          {#if canEdit()}
            {#if p.shared}
              <button class="link danger" disabled={busy}
                      onclick={() => confirm(`Retirer ${p.name} de cette maison ? Vos alertes sur cette station seront supprimées.`) && unlink(p)}>retirer</button>
            {:else if dev}
              <button class="link" disabled={busy} title="La rendre commune aux autres maisons de la commune (sa position devient visible d'elles)"
                      onclick={() => confirm(`Rendre ${p.name} publique ? Sa position et ses mesures seront visibles des maisons qui la suivront.`) && makePublic(p)}>rendre publique</button>
              <button class="link danger" disabled={busy}
                      onclick={() => confirm(`Arrêter la collecte de ${p.name} ? Son historique est conservé.`) && retire(p, dev)}>retirer</button>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if canEdit()}
    <form class="row add" onsubmit={search}>
      <label>Commune <input bind:value={query} placeholder="ex. Toulouse" /></label>
      <button type="submit" disabled={!query.trim() || busy}>Chercher</button>
      <button type="button" disabled={busy} onclick={here} title="Station privée, à la position de cet appareil">Ma position</button>
    </form>
  {/if}
  {#if nearby.length}
    <div class="stack tight">
      <strong>Déjà suivies à proximité</strong>
      <ul class="results">
        {#each nearby as s (s.place_id)}
          <li><button class="link" disabled={busy} onclick={() => addExisting(s)}>Ajouter {s.name}</button>
            <small class="muted">à {s.km.toLocaleString("fr-FR")} km · suivie par {s.homes} maison{s.homes > 1 ? "s" : ""}</small></li>
        {/each}
      </ul>
    </div>
  {/if}
  {#if results.length}
    <ul class="results">
      {#each results as r (r.lat + "," + r.lon)}
        <li><button class="link" disabled={busy} onclick={() => add(r, true)}>Ajouter {r.label}</button>
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
  .list li { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .tight { gap: 0.3rem; }
  .danger { color: var(--err); }
</style>
