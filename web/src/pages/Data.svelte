<script lang="ts">
  import { api } from "../lib/api";
  import { buildPlan, mergePlans, readSheets, type ImportPlan, type ImportTz } from "../lib/dataio";
  import { fmtDate, fmtInt, toLocalInput } from "../lib/format";
  import { canEdit, currentHome } from "../lib/home.svelte";
  import { DAY } from "../lib/period";
  import { router } from "../lib/router.svelte";
  import type { ConflictSample, ExportOptions, ImportMode, ImportResult, SeriesInfo } from "../lib/types";

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
  interface GroupCheck { new: number; identical: number; conflict: number; samples: ConflictSample[] }

  let file = $state<File | null>(null);
  let importTz = $state<ImportTz>("Europe/Paris");
  let toleranceMin = $state(2);
  let plan = $state<ImportPlan | null>(null);
  let checks = $state<Map<string, GroupCheck> | null>(null);
  let tzShifted = $state(0);
  let tzSampled = $state(0);
  let mode = $state<ImportMode>("keep");
  let analysing = $state(false);
  let analyseProgress = $state(0);
  let importing = $state(false);
  let importProgress = $state(0);
  let result = $state<ImportResult | null>(null);
  let cancel = false;
  /** Capteurs et emplacements au moment de l'analyse (réutilisés pour l'import) */
  let ctxImport: Parameters<typeof buildPlan>[2] | null = null;
  const BATCH = 2000;

  const tolerance = $derived(Math.round(Math.max(0, Math.min(6, Number(toleranceMin) || 0)) * 60));
  const totals = $derived.by(() => {
    const t = { new: 0, identical: 0, conflict: 0 };
    for (const c of checks?.values() ?? []) { t.new += c.new; t.identical += c.identical; t.conflict += c.conflict; }
    return t;
  });
  // Plus d'un tiers des nouvelles valeurs retrouvées décalées d'1 h ou 2 h : fuseau probablement erroné
  const tzSuspect = $derived(tzSampled >= 10 && tzShifted / tzSampled > 0.33);

  function resetAnalysis() {
    plan = null;
    checks = null;
    result = null;
    mode = "keep";
  }

  async function analyse() {
    if (!file) return;
    error = "";
    resetAnalysis();
    analysing = true;
    analyseProgress = 0;
    try {
      const [places, devices] = await Promise.all([api.places(), api.devices()]);
      ctxImport = { series: series ?? [], places, devices };
      // Onglet par onglet (un seul en mémoire) : comparaison avec l'existant, par lots, sans rien écrire
      let p: ImportPlan | null = null;
      const byKey = new Map<number, GroupCheck>();
      let shifted = 0, sampled = 0;
      for await (const { sheet, index, count } of readSheets(file)) {
        const sp = buildPlan([sheet], importTz, ctxImport);
        p = mergePlans(p, sp);
        for (let i = 0; i < sp.rows.length; i += BATCH) {
          const r = await api.importPreview(sp.kind, sp.rows.slice(i, i + BATCH), tolerance);
          for (const g of r.groups) {
            const c = byKey.get(g.key) ?? { new: 0, identical: 0, conflict: 0, samples: [] };
            c.new += g.new; c.identical += g.identical; c.conflict += g.conflict;
            c.samples = [...c.samples, ...g.samples].slice(0, 5);
            byKey.set(g.key, c);
          }
          shifted += r.tz_shifted; sampled += r.tz_sampled;
          analyseProgress = Math.min(1, (index + Math.min(1, (i + BATCH) / sp.rows.length)) / count);
        }
        analyseProgress = (index + 1) / count;
      }
      if (!p || !p.groups.length) throw new Error("Aucune donnée reconnue : vérifiez l'en-tête (date;emplacement;grandeur;valeur).");
      const byGroup = new Map<string, GroupCheck>();
      for (const g of p.groups) {
        const c: GroupCheck = { new: 0, identical: 0, conflict: 0, samples: [] };
        for (const k of g.keys) {
          const x = byKey.get(k);
          if (!x) continue;
          c.new += x.new; c.identical += x.identical; c.conflict += x.conflict;
          c.samples = [...c.samples, ...x.samples].slice(0, 5);
        }
        byGroup.set(g.label, c);
      }
      plan = p;
      checks = byGroup;
      tzShifted = shifted;
      tzSampled = sampled;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      analysing = false;
    }
  }

  async function runImport() {
    if (!plan) return;
    if (mode === "replace" && totals.conflict > 0 && !confirm(
      `Remplacer ${fmtInt(totals.conflict)} valeur(s) existante(s) par celles du fichier ?\n\n` +
      "Les mesures existantes concernées seront supprimées définitivement. L'opération est enregistrée dans le journal.")) {
      return;
    }
    importing = true;
    cancel = false;
    importProgress = 0;
    const total: ImportResult = { received: 0, inserted: 0, identical: 0, conflicts: 0, replaced: 0, skipped: 0, extended: 0, rejected: 0 };
    try {
      // Onglet par onglet, relu dans le fichier (rien n'est gardé en mémoire depuis l'analyse)
      let sent = 0;
      for await (const { sheet } of readSheets(file!)) {
        if (cancel) break;
        const sp = buildPlan([sheet], importTz, ctxImport!);
        for (let i = 0; i < sp.rows.length && !cancel; i += BATCH) {
          const r = await api.importValues(sp.kind, sp.rows.slice(i, i + BATCH), tolerance, mode);
          for (const k of Object.keys(total) as (keyof ImportResult)[]) total[k] += r[k] ?? 0;
          result = { ...total };
          sent += Math.min(BATCH, sp.rows.length - i);
          importProgress = Math.min(1, sent / Math.max(1, plan.values));
        }
      }
    } catch (e) {
      error = `Import interrompu : ${e instanceof Error ? e.message : String(e)}. Les lots déjà envoyés sont enregistrés ; ` +
              "relancer l'import ne crée pas de doublons.";
    } finally {
      importing = false;
    }
  }

  const fmtVal = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
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
          <input type="file" accept=".csv,.txt,.xlsx" onchange={(e) => { file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null; resetAnalysis(); }} />
        </label>
        <label>Dates sans fuseau dans le fichier
          <select bind:value={importTz} onchange={resetAnalysis}>
            <option value="Europe/Paris">sont en heure de Paris (heure d'été / d'hiver)</option>
            <option value="UTC">sont en UTC</option>
          </select>
        </label>
        <label>Marge pour reconnaître une mesure existante (minutes)
          <input type="number" min="0" max="6" step="0.5" bind:value={toleranceMin} onchange={resetAnalysis} />
        </label>
      </div>
      <small class="muted">Les dates qui portent leur fuseau (ex. <span class="num">2026-10-05T14:10:00+02:00</span> ou
        <span class="num">…Z</span>) sont toujours lues telles quelles. Une valeur à moins de {toleranceMin} min d'une mesure
        existante est considérée comme la même mesure (les capteurs émettent environ toutes les 7 min : rester en dessous).</small>
      <div class="row">
        <button onclick={analyse} disabled={!file || analysing || importing}>
          {analysing ? `Analyse… ${Math.round(analyseProgress * 100)} %` : "Analyser le fichier"}
        </button>
        <small class="muted">L'analyse compare le fichier à l'existant sans rien modifier.</small>
      </div>

      {#if plan && checks}
        <div class="notice">
          Format reconnu : <strong>{plan.format}</strong> · {fmtInt(plan.values)} valeurs lues :
          <strong>{fmtInt(totals.new)}</strong> nouvelles, {fmtInt(totals.identical)} déjà présentes,
          <strong>{fmtInt(totals.conflict)}</strong> en conflit
          {#if plan.ignored} · {fmtInt(plan.ignored)} ignorées{/if}
          {#if plan.ignoredSheets.length} · onglets ignorés : {plan.ignoredSheets.join(", ")}{/if}
        </div>
        {#if tzSuspect}
          <div class="notice warn" role="alert">
            Beaucoup de valeurs du fichier se retrouvent dans l'existant avec un décalage d'exactement 1 h ou 2 h :
            le fuseau choisi (« {importTz === "UTC" ? "UTC" : "heure de Paris"} ») est peut-être incorrect.
          </div>
        {/if}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Données</th><th>Période</th><th class="r">Nouvelles</th><th class="r">Identiques</th><th class="r">Conflits</th></tr></thead>
            <tbody>
              {#each plan.groups as g (g.label)}
                {@const c = checks.get(g.label)}
                <tr>
                  <td>{g.label}{#if !g.ok}<br /><span class="badge warn">ignoré</span> <small>{g.problem}</small>{/if}</td>
                  <td class="num">{g.first ? fmtDate(new Date(g.first).toISOString()) : "–"}<br />→ {g.last ? fmtDate(new Date(g.last).toISOString()) : "–"}</td>
                  <td class="r num">{g.ok ? fmtInt(c?.new) : "–"}</td>
                  <td class="r num">{g.ok ? fmtInt(c?.identical) : "–"}</td>
                  <td class="r num">{#if c?.conflict}<span class="badge warn">{fmtInt(c.conflict)}</span>{:else}{g.ok ? 0 : "–"}{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        {#if totals.conflict > 0}
          <div class="stack conflicts">
            <h3 style="margin:0">Valeurs en conflit (exemples)</h3>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Données</th><th>Mesure existante</th><th>Valeur du fichier</th></tr></thead>
                <tbody>
                  {#each plan.groups as g (g.label)}
                    {#each checks.get(g.label)?.samples ?? [] as x (x.t)}
                      <tr>
                        <td>{g.label}</td>
                        <td class="num">{fmtVal(x.ev)} <small class="muted">{fmtDate(x.et)}</small></td>
                        <td class="num"><strong>{fmtVal(x.v)}</strong> <small class="muted">{fmtDate(x.t)}</small></td>
                      </tr>
                    {/each}
                  {/each}
                </tbody>
              </table>
            </div>
            <fieldset>
              <legend>En cas de conflit</legend>
              <label class="radio"><input type="radio" bind:group={mode} value="keep" /> Conserver les valeurs existantes (recommandé)</label>
              <label class="radio"><input type="radio" bind:group={mode} value="replace" /> Remplacer par les valeurs du fichier
                <small>(la mesure existante la plus proche est supprimée ; opération enregistrée dans le journal)</small></label>
            </fieldset>
          </div>
        {/if}

        <div class="row">
          {#if importing}
            <button onclick={() => (cancel = true)}>Arrêter</button>
          {:else}
            <button class="primary" class:danger-btn={mode === "replace" && totals.conflict > 0}
                    disabled={!totals.new && !(mode === "replace" && totals.conflict)} onclick={runImport}>
              {mode === "replace" && totals.conflict
                ? `Importer ${fmtInt(totals.new)} et remplacer ${fmtInt(totals.conflict)} valeurs`
                : `Importer ${fmtInt(totals.new)} nouvelles valeurs`}
            </button>
          {/if}
          {#if importing || result}
            <div class="bar" style="flex:1;min-width:8rem" role="progressbar" aria-valuemin="0" aria-valuemax="100"
                 aria-valuenow={Math.round(importProgress * 100)}><span style="width:{importProgress * 100}%"></span></div>
            <small class="num">{Math.round(importProgress * 100)} %</small>
          {/if}
        </div>
        {#if result}
          <div class="notice" role="status">
            {fmtInt(result.inserted)} valeurs ajoutées · {fmtInt(result.identical)} déjà présentes
            {#if result.conflicts} · {fmtInt(result.conflicts)} conflits, valeurs existantes conservées{/if}
            {#if result.replaced} · {fmtInt(result.replaced)} valeurs existantes remplacées{/if}
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
  .radio { display: flex; gap: 0.5rem; align-items: baseline; color: var(--text); font-size: 0.95rem; }
  .radio input { min-height: 0; }
  .conflicts { border-top: 1px solid var(--border); padding-top: 0.75rem; }
  .danger-btn { background: var(--err); border-color: var(--err); }
</style>
