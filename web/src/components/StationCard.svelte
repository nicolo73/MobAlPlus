<script lang="ts">
  // Fiche d'une station météo (page de son emplacement) : situation sur une carte, état de la collecte,
  // de la prévision et des normales (base), conditions complètes en direct (Open-Meteo, non
  // enregistrées) et actualisation à la demande (collecte de cette station sans attendre la demi-heure).

  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { fmtAgo, fmtDate } from "../lib/format";
  import type { WeatherDetails, WeatherRefresh, WeatherStationInfo } from "../lib/types";
  import StationMap from "./StationMap.svelte";

  interface Props {
    placeId: number;
    name: string;
    /** Collecte faite : la page recharge mesures, prévision et normales */
    onrefreshed?: (r: WeatherRefresh) => void;
  }
  let { placeId, name, onrefreshed }: Props = $props();

  let info = $state<WeatherStationInfo | null>(null);
  let infoError = $state("");
  let details = $state<WeatherDetails | null>(null);
  let busy = $state(false);
  let report = $state("");
  let reportError = $state(false);
  let open = $state(false);

  async function loadInfo() {
    try { info = await api.weatherStationInfo(placeId); infoError = ""; }
    catch (e) { infoError = e instanceof Error ? e.message : String(e); }
  }

  onMount(async () => {
    await loadInfo();
    // Anomalie (erreur de collecte ou des normales) : fiche ouverte d'emblée
    if (info && (info.sync?.status === "ERROR" || info.normals?.error)) open = true;
    // Détails en direct, sans collecte
    try { details = (await api.refreshWeatherStation(placeId, false)).details; } catch { /* fonction pas à jour : sans détails */ }
  });

  async function refresh() {
    busy = true;
    report = "";
    try {
      const r = await api.refreshWeatherStation(placeId, true);
      if (r.details && !r.details.error) details = r.details;
      const errs = [...r.results.filter((x) => x.error).map((x) => x.error!), ...(r.normals?.error ? [r.normals.error] : [])];
      const res = r.results[0];
      reportError = errs.length > 0;
      report = errs.length ? `Erreur : ${errs.join(" ; ")}`
        : [res ? `${res.inserted} nouvelle${res.inserted > 1 ? "s" : ""} mesure${res.inserted > 1 ? "s" : ""}` : "",
           res?.forecast ? `${res.forecast} valeurs de prévision` : "",
           r.normals?.done ? (r.normals.normals ? `normales calculées (${r.normals.normals} valeurs)` : `normales : ${r.normals.done} fait`) : ""]
          .filter(Boolean).join(", ") || "Rien de nouveau";
      onrefreshed?.(r);
    } catch (e) {
      reportError = true;
      report = `Erreur : ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
      await loadInfo();
    }
  }

  // État résumé des normales
  const normals = $derived.by(() => {
    const n = info?.normals;
    if (!n) return { tone: "warn", text: "pas encore calculées : au prochain passage de la collecte (ou Actualiser)" };
    if (n.computed_at) return { tone: "ok", text: `calculées (${n.period ?? "1991-2020"}) ${fmtAgo(n.computed_at)}, ${n.rows} valeurs` };
    const done = n.next_year && n.next_year > 1991 ? ` ; 1991 – ${n.next_year - 1} fait` : "";
    if (n.error) return { tone: "err", text: `échec ${fmtAgo(n.error_at)}${done} : ${n.error.replace(/^normales : /, "")} — nouvel essai dans l'heure (ou Actualiser)` };
    return { tone: "warn", text: `en cours${done} (une tranche de 10 ans par passage, toutes les 30 min ; Actualiser pour avancer)` };
  });
  const syncTone = $derived(info?.sync?.status === "ERROR" ? "err" : info?.sync?.last_run ? "ok" : "warn");

  // ── Conditions en direct ──
  const WMO: Record<number, string> = {
    0: "Ciel dégagé", 1: "Plutôt dégagé", 2: "Partiellement nuageux", 3: "Couvert", 45: "Brouillard", 48: "Brouillard givrant",
    51: "Bruine légère", 53: "Bruine", 55: "Bruine forte", 56: "Bruine verglaçante", 57: "Bruine verglaçante forte",
    61: "Pluie faible", 63: "Pluie", 65: "Pluie forte", 66: "Pluie verglaçante", 67: "Pluie verglaçante forte",
    71: "Neige faible", 73: "Neige", 75: "Neige forte", 77: "Grains de neige", 80: "Averses faibles", 81: "Averses",
    82: "Averses violentes", 85: "Averses de neige", 86: "Fortes averses de neige", 95: "Orage", 96: "Orage avec grêle", 99: "Orage avec forte grêle",
  };
  const DIRS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  const num = (v: unknown, d = 1) => (typeof v === "number" ? v.toLocaleString("fr-FR", { maximumFractionDigits: d }) : "–");
  const hm = (v: unknown) => (typeof v === "string" ? v.slice(11, 16) : "–");
  const live = $derived.by(() => {
    const c = details?.current ?? {}, u = details?.units ?? {}, t = details?.today ?? {};
    const out: { label: string; value: string }[] = [];
    const add = (label: string, v: unknown, unit = "", d = 1) => { if (v != null) out.push({ label, value: `${num(v, d)}${unit ? ` ${unit}` : ""}` }); };
    if (typeof c.weather_code === "number") out.push({ label: "Temps", value: WMO[c.weather_code] ?? `code ${c.weather_code}` });
    add("Ressenti", c.apparent_temperature, u.apparent_temperature ?? "°C");
    add("Point de rosée", c.dew_point_2m, u.dew_point_2m ?? "°C");
    if (typeof c.wind_speed_10m === "number") {
      const dir = typeof c.wind_direction_10m === "number" ? ` ${DIRS[Math.round(c.wind_direction_10m / 45) % 8]}` : "";
      out.push({ label: "Vent", value: `${num(c.wind_speed_10m, 0)} ${u.wind_speed_10m ?? "km/h"}${dir}` });
    }
    add("Rafales", c.wind_gusts_10m, u.wind_gusts_10m ?? "km/h", 0);
    add("Précipitations", c.precipitation, u.precipitation ?? "mm");
    add("Nébulosité", c.cloud_cover, "%", 0);
    add("Pression", c.pressure_msl, u.pressure_msl ?? "hPa", 0);
    if (t.sunrise != null || t.sunset != null) out.push({ label: "Soleil", value: `${hm(t.sunrise)} – ${hm(t.sunset)}` });
    add("UV max. du jour", t.uv_index_max);
    if (t.precipitation_sum != null) {
      out.push({ label: "Pluie du jour", value: `${num(t.precipitation_sum)} mm${t.precipitation_probability_max != null ? ` (risque ${num(t.precipitation_probability_max, 0)} %)` : ""}` });
    }
    return out;
  });
  const coord = (v: number, pos: string, neg: string) => `${Math.abs(v).toLocaleString("fr-FR", { maximumFractionDigits: 4 })}° ${v >= 0 ? pos : neg}`;
  const distKm = $derived.by(() => {
    const g = details?.grid;
    if (!g || !info) return null;
    const r = Math.PI / 180;
    const x = (g.lon - info.lon) * r * Math.cos(((g.lat + info.lat) / 2) * r), y = (g.lat - info.lat) * r;
    return Math.hypot(x, y) * 6371;
  });
</script>

<section class="card station">
  <div class="head">
    <button class="toggle" onclick={() => (open = !open)} aria-expanded={open}>
      <h2>Station météo</h2>
      <span class="chips">
        <span class="badge {syncTone}">collecte</span>
        <span class="badge {info?.forecast?.n ? 'ok' : 'warn'}">prévision</span>
        <span class="badge {normals.tone}">normales</span>
      </span>
      <span class="chev" aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button>
    <button class="refresh" onclick={refresh} disabled={busy || !info}
            title="Relever cette station maintenant (mesures, prévision, normales) sans attendre le prochain passage">
      {busy ? "Actualisation…" : "Actualiser"}
    </button>
  </div>
  {#if report}<small class:err-text={reportError} class="report">{report}</small>{/if}
  {#if infoError}<small class="err-text">{infoError}</small>{/if}

  {#if open && info}
    <div class="body">
      <StationMap lat={info.lat} lon={info.lon} grid={details?.grid ?? null} label={name} />
      <dl>
        <dt>Position</dt>
        <dd>{coord(info.lat, "N", "S")}, {coord(info.lon, "E", "O")}</dd>
        {#if details?.grid}
          <dt>Point du modèle</dt>
          <dd>{coord(details.grid.lat, "N", "S")}, {coord(details.grid.lon, "E", "O")}
            {#if distKm !== null}<span class="muted">(à {num(distKm)} km)</span>{/if}
            {#if details.grid.elevation != null}<br /><span class="muted">altitude retenue : {num(details.grid.elevation, 0)} m</span>{/if}</dd>
        {/if}
        <dt>Historique</dt>
        <dd>{info.first_ts ? `depuis le ${fmtDate(info.first_ts).slice(0, 10)}` : "–"}
          <span class="muted">(station créée le {fmtDate(info.added_at).slice(0, 10)})</span></dd>
        <dt>Collecte</dt>
        <dd class={syncTone === "err" ? "err-text" : ""}>
          {#if info.sync?.last_run}
            dernier passage {fmtAgo(info.sync.last_run)}, dernière mesure {fmtAgo(info.sync.last_ts)}
            {#if info.sync.status === "ERROR"}<br />erreur : {info.sync.message}{/if}
          {:else}pas encore faite{/if}
          <br /><span class="muted">toutes les 30 minutes (minutes 7 et 37)</span>
        </dd>
        <dt>Prévision</dt>
        <dd>{#if info.forecast?.n}{info.forecast.n} valeurs horaires jusqu'au {fmtDate(info.forecast.until).slice(0, 16)},
            reçues {fmtAgo(info.forecast.issued_at)}{:else}aucune pour l'instant{/if}</dd>
        <dt>Normales</dt>
        <dd class={normals.tone === "err" ? "err-text" : ""}>{normals.text}
          {#if info.normals?.humidity === false}<br /><span class="muted">humidité indisponible dans les archives : température seule</span>{/if}</dd>
      </dl>
      {#if live.length}
        <div class="live">
          <h3>Conditions actuelles <small class="muted">(Open-Meteo, en direct, non enregistrées)</small></h3>
          <dl class="grid">
            {#each live as l (l.label)}<div><dt>{l.label}</dt><dd>{l.value}</dd></div>{/each}
          </dl>
        </div>
      {:else if details?.error}
        <small class="muted">Conditions en direct indisponibles : {details.error}</small>
      {/if}
      <small class="muted">Sources : Open-Meteo (prévisions des services météo nationaux, archives ERA5 pour l'historique
        et les normales) ; carte © les contributeurs d'OpenStreetMap.</small>
    </div>
  {/if}
</section>

<style>
  .station { display: flex; flex-direction: column; gap: 0.5rem; }
  .head { display: flex; align-items: center; gap: 0.5rem; }
  .toggle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; border: none; background: none;
            padding: 0; text-align: left; color: inherit; min-height: 2.2rem; }
  .toggle h2 { margin: 0; font-size: 1.1rem; }
  .chips { display: flex; gap: 0.3rem; flex-wrap: wrap; }
  .chev { color: var(--muted); }
  .refresh { flex: none; }
  .report { display: block; }
  .err-text { color: var(--err); }
  .body { display: grid; gap: 0.75rem; grid-template-columns: minmax(0, 1fr); }
  /* Grand écran : carte à gauche, état à droite ; conditions et sources dessous */
  @media (min-width: 760px) { .body { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); }
                              .live, .body > small { grid-column: 1 / -1; } }
  dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 0.75rem; font-size: 0.9rem; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  .live h3 { font-size: 0.95rem; margin: 0 0 0.4rem; }
  dl.grid { grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.5rem; }
  dl.grid div { border: 1px solid var(--border); border-radius: 8px; padding: 0.35rem 0.5rem; }
  dl.grid dt { font-size: 0.78rem; }
  dl.grid dd { font-weight: 600; }
</style>
