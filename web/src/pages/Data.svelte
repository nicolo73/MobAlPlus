<script lang="ts">
  import { api } from "../lib/api";
  import { buildPlan, readFile, type ImportPlan, type ImportTz } from "../lib/dataio";
  import { fmtDate, fmtInt, toLocalInput } from "../lib/format";
  import { canEdit, currentHome } from "../lib/home.svelte";
  import { DAY } from "../lib/period";
  import { router } from "../lib/router.svelte";
  import type { ExportOptions, ImportResult, SeriesInfo } from "../lib/types";

  const HEADER = ["date", "emplacement", "grandeur", "valeur", "unite", "qualite", "capteur", "canal"];
  const PERIODS = [
    { key: "1d", label: "Dernières 24 h", ms: DAY },
    { key: "7d", label: "7 derniers jours", ms: 7 * DAY },
    { key: "30d", label: "30 derniers jours", ms: 30 * DAY },
    { key: "all", label: "Tout l'historique", ms: 0 },
    { key: "custom", label: "Période personnalisée", ms: 0 },
  ];

  let series = $state<SeriesInfo[] | null>(null);
  let error = $state("");

  // ---- Export ----
  let selPlaces = $state(new Set<number>());
  let selProps = $state(new Set<string>());
  let period = $state("1d");
  let from = $state(toLocalInput(new Date(Date.now() - DAY)));
  let to = $state(toLocalInput(new Date()));
  let limit = $state<number | null>(null);
  let tz = $state<ExportOptions["tz"]>("Europe/Paris");
  let excel = $state(true);
  let exporting = $state(false);
  let exportProgress = $state(0);
  let exportInfo = $state("");

  const places = $derived.by(() => {
    const m = new Map<number, string>();
    for (const s of series ?? []) m.set(s.place_id, s.place_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  });
  const props = $derived([...new Map((series ?? []).map((s) => [s.property, s.property_name])).entries()]);
  const chosen = $derived((series ?? []).filter((s) => selPlaces.has(s.place_id) && selProps.has(s.property)));

  async function init() {
    try {
      series = await api.seriesList();
      const only = Number(router.query.get("lieu"));
      selPlaces = new Set(only ? [only] : series.map((s) => s.place_id));
      selProps = new Set(series.map((s) => s.property));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  init();

  const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); return n; };

  function download(parts: string[], name: string) {
    const url = URL.createObjectURL(new Blob(parts, { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function runExport(sample = false) {
    error = "";
    exportInfo = "";
    exporting = true;
    exportProgress = 0;
    try {
      const ids = chosen.map((s) => s.id);
      const opts: ExportOptions = { tz, sep: excel ? ";" : ",", decimal: excel ? "," : ".", limit: sample ? 10 : limit || null };
      let start: number, end: number;
      if (sample) { end = Date.now(); start = end - DAY; }
      else if (period === "custom") { start = new Date(from).getTime(); end = new Date(to).getTime(); }
      else if (period === "all") {
        const b = await api.seriesBounds(ids);
        if (b.first === null) throw new Error("Aucune mesure pour cette sélection.");
        start = b.first; end = Date.now() + 60_000;
      } else { end = Date.now() + 60_000; start = end - PERIODS.find((p) => p.key === period)!.ms; }

      // Découpage en tranches d'environ 50 000 lignes (une mesure toutes les ~7 min par série)
      const step = Math.max(DAY, Math.floor(50_000 / (205 * Math.max(1, ids.length))) * DAY);
      const parts = ["﻿" + HEADER.join(opts.sep) + "\n"];
      let lines = 0;
      for (let t = start; t < end; t += step) {
        const remaining = opts.limit ? opts.limit - lines : null;
        if (remaining !== null && remaining <= 0) break;
        const chunk = await api.exportCsv(ids, t, Math.min(t + step, end), { ...opts, limit: remaining });
        if (chunk) {
          parts.push(chunk + "\n");
          lines += chunk.split("\n").length;
        }
        exportProgress = Math.min(1, (t + step - start) / (end - start));
      }
      const day = new Date().toISOString().slice(0, 10);
      const home = (currentHome()?.name ?? "maison").normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase();
      download(parts, `mobalplus-${home}-${sample ? "exemple" : day}.csv`);
      exportInfo = `${fmtInt(lines)} lignes exportées.`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      exporting = false;
    }
  }

  // ---- Import ----
  let file = $state<File | null>(null);
  let importTz = $state<ImportTz>("Europe/Paris");
  let plan = $state<ImportPlan | null>(null);
  let analysing = $state(false);
  let importing = $state(false);
  let importProgress = $state(0);
  let result = $state<ImportResult | null>(null);
  let cancel = false;
  const BATCH = 5000;

  async function analyse() {
    if (!file) return;
    error = "";
    plan = null;
    result = null;
    analysing = true;
    try {
      const [sheets, places, devices] = await Promise.all([readFile(file), api.places(), api.devices()]);
      plan = buildPlan(sheets, importTz, { series: series ?? [], places, devices });
      if (!plan.groups.length) throw new Error("Aucune donnée reconnue : vérifiez l'en-tête (date;emplacement;grandeur;valeur).");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      analysing = false;
    }
  }

  async function runImport() {
    if (!plan) return;
    importing = true;
    cancel = false;
    importProgress = 0;
    const total: ImportResult = { received: 0, inserted: 0, skipped: 0, extended: 0, rejected: 0 };
    try {
      for (let i = 0; i < plan.rows.length && !cancel; i += BATCH) {
        const r = await api.importValues(plan.kind, plan.rows.slice(i, i + BATCH));
        for (const k of Object.keys(total) as (keyof ImportResult)[]) total[k] += r[k];
        result = { ...total };
        importProgress = Math.min(1, (i + BATCH) / plan.rows.length);
      }
    } catch (e) {
      error = `Import interrompu : ${e instanceof Error ? e.message : String(e)}. Les lots déjà envoyés sont enregistrés ; ` +
              "relancer l'import ne crée pas de doublons.";
    } finally {
      importing = false;
    }
  }
</script>

<div class="stack">
  <h1 style="margin:0">Données</h1>
  {#if error}<div class="notice err" role="alert">{error}</div>{/if}

  <section class="card stack">
    <h2 style="margin:0">Exporter</h2>
    {#if series === null}
      <p class="muted">Chargement…</p>
    {:else}
      <fieldset>
        <legend>Emplacements</legend>
        <div class="chips">
          {#each places as [id, name] (id)}
            <button type="button" class="chip" class:on={selPlaces.has(id)} aria-pressed={selPlaces.has(id)}
                    onclick={() => (selPlaces = toggle(selPlaces, id))}>{name}</button>
          {/each}
          <button type="button" class="link" onclick={() => (selPlaces = new Set(places.map(([id]) => id)))}>tous</button>
          <button type="button" class="link" onclick={() => (selPlaces = new Set())}>aucun</button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Grandeurs</legend>
        <div class="chips">
          {#each props as [code, name] (code)}
            <button type="button" class="chip" class:on={selProps.has(code)} aria-pressed={selProps.has(code)}
                    onclick={() => (selProps = toggle(selProps, code))}>{name}</button>
          {/each}
        </div>
      </fieldset>
      <div class="grid">
        <label>Période
          <select bind:value={period}>{#each PERIODS as p (p.key)}<option value={p.key}>{p.label}</option>{/each}</select>
        </label>
        {#if period === "custom"}
          <label>Du <input type="datetime-local" bind:value={from} /></label>
          <label>Au <input type="datetime-local" bind:value={to} /></label>
        {/if}
        <label>Nombre de lignes au plus <input type="number" min="1" placeholder="toutes" bind:value={limit} /></label>
        <label>Fuseau des dates
          <select bind:value={tz}>
            <option value="Europe/Paris">Heure de Paris (avec décalage, ex. +02:00)</option>
            <option value="UTC">UTC (Z)</option>
          </select>
        </label>
        <label>Format
          <select bind:value={excel}>
            <option value={true}>Excel en français (; et virgule décimale)</option>
            <option value={false}>International (, et point décimal)</option>
          </select>
        </label>
      </div>
      <div class="row">
        <button class="primary" disabled={exporting || !chosen.length} onclick={() => runExport()}>
          {exporting ? `Export… ${Math.round(exportProgress * 100)} %` : "Télécharger le CSV"}
        </button>
        <button disabled={exporting || !chosen.length} onclick={() => runExport(true)}>Fichier exemple (10 lignes)</button>
        <small class="muted">{chosen.length} série(s) sélectionnée(s)</small>
      </div>
      {#if exportInfo}<div class="notice" role="status">{exportInfo}</div>{/if}
      <small class="muted">Une ligne par mesure : <span class="num wrap">{HEADER.join(";")}</span>. Chaque date porte son
        fuseau. Le même format sert à l'import : le fichier exemple est le modèle à suivre.</small>
    {/if}
  </section>

  {#if canEdit()}
    <section class="card stack">
      <h2 style="margin:0">Importer</h2>
      <p class="muted" style="margin:0">Fichier <strong>CSV ou Excel</strong> au format MobAlPlus (celui de l'export), ou
        <strong>ancien tableur Mobile Alerts</strong> (un onglet par capteur, « Device ID » en A1). Les mesures déjà présentes
        sont ignorées : un import peut être relancé sans risque.</p>
      <div class="grid">
        <label>Fichier
          <input type="file" accept=".csv,.txt,.xlsx" onchange={(e) => { file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null; plan = null; result = null; }} />
        </label>
        <label>Dates sans fuseau dans le fichier
          <select bind:value={importTz} onchange={() => (plan = null)}>
            <option value="Europe/Paris">sont en heure de Paris (heure d'été / d'hiver)</option>
            <option value="UTC">sont en UTC</option>
          </select>
        </label>
      </div>
      <small class="muted">Les dates qui portent leur fuseau (ex. <span class="num">2026-10-05T14:10:00+02:00</span> ou
        <span class="num">…Z</span>) sont toujours lues telles quelles.</small>
      <div><button onclick={analyse} disabled={!file || analysing || importing}>{analysing ? "Analyse…" : "Analyser le fichier"}</button></div>

      {#if plan}
        <div class="notice">
          Format reconnu : <strong>{plan.format}</strong> · {fmtInt(plan.rows.length)} valeurs à importer
          {#if plan.ignored} · {fmtInt(plan.ignored)} ignorées{/if}
          {#if plan.ignoredSheets.length} · onglets ignorés : {plan.ignoredSheets.join(", ")}{/if}
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Données</th><th class="r">Lignes</th><th>Période</th><th>État</th></tr></thead>
            <tbody>
              {#each plan.groups as g (g.label)}
                <tr>
                  <td>{g.label}</td>
                  <td class="r num">{fmtInt(g.rows)}</td>
                  <td class="num">{g.first ? fmtDate(new Date(g.first).toISOString()) : "–"} → {g.last ? fmtDate(new Date(g.last).toISOString()) : "–"}</td>
                  <td>{#if g.ok}<span class="badge ok">prêt</span>{:else}<span class="badge warn">ignoré</span> <small>{g.problem}</small>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="row">
          {#if importing}
            <button onclick={() => (cancel = true)}>Arrêter</button>
          {:else}
            <button class="primary" disabled={!plan.rows.length} onclick={runImport}>Importer {fmtInt(plan.rows.length)} valeurs</button>
          {/if}
          {#if importing || result}
            <div class="bar" style="flex:1;min-width:8rem" role="progressbar" aria-valuemin="0" aria-valuemax="100"
                 aria-valuenow={Math.round(importProgress * 100)}><span style="width:{importProgress * 100}%"></span></div>
            <small class="num">{Math.round(importProgress * 100)} %</small>
          {/if}
        </div>
        {#if result}
          <div class="notice" role="status">
            {fmtInt(result.inserted)} valeurs ajoutées · {fmtInt(result.received - result.inserted - result.skipped)} déjà présentes
            {#if result.skipped} · {fmtInt(result.skipped)} hors de toute affectation (ignorées){/if}
            {#if result.extended} · {result.extended} affectation(s) étendue(s) vers le passé{/if}
            {#if result.rejected} · {result.rejected} valeur(s) marquée(s) rejetée(s){/if}
          </div>
        {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  fieldset { border: none; padding: 0; margin: 0; display: grid; gap: 0.4rem; }
  legend { font-size: 0.9rem; color: var(--muted); padding: 0; margin-bottom: 0.4rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
  .chip { border-radius: 999px; min-height: 2.1rem; padding: 0.3rem 0.8rem; font-size: 0.9rem; color: var(--muted); }
  .chip.on { color: var(--text); border-color: var(--text); font-weight: 600; }
  .grid input, .grid select { width: 100%; }
  .wrap { overflow-wrap: anywhere; }
</style>
