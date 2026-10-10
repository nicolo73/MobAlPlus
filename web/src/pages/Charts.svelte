<script lang="ts">
  import { api } from "../lib/api";
  import { MAX_SERIES, isDark } from "../lib/colors";
  import { loadRange, followsNow, needsReload, type Window } from "../lib/period";
  import { fmtValue } from "../lib/format";
  import type { Place, Point, SeriesInfo } from "../lib/types";
  import { flatten, placeTree, type PlaceNode } from "../lib/placetree";
  import * as sel from "../lib/chartsel";
  import { getDashboard, updateDashboard } from "../lib/dashboards";
  import { router } from "../lib/router.svelte";
  import { bandMain, type DayBand } from "../lib/longview";
  import { loadCurves, otherView } from "../lib/curveload";
  import type { AlertEvent } from "../lib/types";
  import { forecastCurve, homeWeather, loadForecast, loadWeather, weatherCurve } from "../lib/weather-state.svelte";
  import type { WeatherSeries } from "../lib/weather-parse";
  import PeriodBar from "../components/PeriodBar.svelte";
  import TimeChart, { type ChartSeries } from "../components/TimeChart.svelte";
  import DisplayBar from "../components/DisplayBar.svelte";
  import { display, visibleProps } from "../lib/display.svelte";

  import { ctx } from "../lib/home.svelte";

  // Réglages d'une synthèse (#/courbes?d=…) : ses courbes, sa durée et son nom
  const dash = getDashboard(ctx.homeId, router.query.get("d"));
  const saved = dash;
  let dashName = $state(dash.name);
  const backHref = `#/synthese/${encodeURIComponent(dash.id)}`;
  function rename() {
    const name = dashName.trim() || dash.name;
    dashName = name;
    updateDashboard(ctx.homeId, dash.id, { name });
  }

  let all = $state<SeriesInfo[] | null>(null);
  let placeList = $state<Place[]>([]);
  let error = $state("");
  // Courbe sélectionnée -> numéro de couleur (conservé tant qu'elle reste sélectionnée).
  // Clé : identifiant de l'emplacement (ses mesures), ou son opposé (moyenne de sa branche).
  let slots = $state<sel.Slots>(saved.slots);
  const initial: Window = [Date.now() - saved.width, Date.now()];
  let win = $state<Window>(initial);
  let loaded = $state<Window>(loadRange(initial));
  let data = $state(new Map<number, Point[]>());
  /** Temps long (plus de 8 jours affichés) : bandes min – max journalières au lieu des mesures */
  let bands = $state(new Map<number, DayBand[]>());
  let loadedKey = $state("");
  /** Bande min – max au premier plan (fenêtre large) ; la courbe détaillée passe en fond */
  const bandMode = $derived(bandMain(win, display.longview));
  let loading = $state(false);
  let dark = $state(isDark());
  let reqId = 0;

  $effect(() => updateDashboard(ctx.homeId, dash.id, { slots: $state.snapshot(slots), width: win[1] - win[0] }));

  $effect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const f = () => (dark = m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  });

  /** Arbre des emplacements, et courbes possibles : mesures d'un emplacement, moyenne d'une branche */
  const tree = $derived(placeTree(placeList, all ?? []));
  const nodes = $derived(flatten(tree));
  const byId = $derived(new Map(nodes.map((n) => [n.id, n])));
  const seriesByPlace = $derived(sel.groupByPlace(all ?? []));
  // Un emplacement parent se sélectionne en entier : moyenne de ses emplacements mesurés (lui compris)
  const { isParent, hasAvg } = sel;
  const validKey = (k: number) => sel.validKey(byId, k);
  type Selected = sel.Selected;
  const selected = $derived(sel.selectedCurves(nodes, slots));
  const full = $derived(selected.length >= MAX_SERIES);
  const slotOf = (key: number) => sel.slotOf(byId, slots, key);
  const colorOf = (key: number) => sel.colorOf(byId, slots, key, dark);
  /** Courbes affichées de la même couleur (à signaler) */
  const clashes = $derived.by(() => {
    const byColor = new Map<string, string[]>();
    for (const c of selected) byColor.set(colorOf(c.key), [...(byColor.get(colorOf(c.key)) ?? []), c.node.name]);
    return [...byColor.values()].filter((names) => names.length > 1);
  });
  const leaves = $derived(tree.filter((n) => !isParent(n)));
  const groups = $derived(tree.filter(isParent));
  const ORDER = ["temperature", "humidity"];
  const rank = (prop: string) => (ORDER.indexOf(prop) + 9) % 9;
  /** Grandeurs de la maison (température d'abord), et celles qui sont affichées */
  const properties = $derived.by(() => {
    const m = new Map<string, string>();
    for (const s of all ?? []) m.set(s.property, s.property_name);
    return [...m].map(([code, name]) => ({ code, name })).sort((a, b) => rank(a.code) - rank(b.code));
  });
  const visible = $derived(visibleProps(properties.map((p) => p.code)));

  async function init() {
    try {
      const [series, pl] = await Promise.all([api.seriesList(), api.places()]);
      placeList = pl;
      all = series;
      // Première visite : les premiers emplacements mesurés (4 au plus, pour garder des courbes lisibles)
      slots = Object.fromEntries(Object.entries(slots).filter(([k]) => validKey(Number(k))));
      if (!Object.keys(slots).length && dash.id === "principale") slots = sel.defaultSlots(nodes);
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  init();

  function toggle(key: number) {
    if (key in slots) {
      const { [key]: _, ...rest } = slots;
      slots = rest;
    } else if (!full) {
      // Couleur automatique : la première qui n'est ni attribuée ni choisie pour une courbe affichée
      const used = new Set(selected.filter((c) => !byId.get(Math.abs(c.key))?.custom).map((c) => slotOf(c.key)));
      let slot = 0;
      while (used.has(slot)) slot++;
      slots = { ...slots, [key]: slot };
      load();
    }
  }

  // Météo publique de la période chargée (si activée et position connue)
  let weather = $state<WeatherSeries | null>(null);
  $effect(() => {
    const [a, b] = loaded, on = display.weather;
    void homeWeather.stations;
    loadWeather(on, a, b, display.forecast, { raw: loadedKey.includes("r"), band: loadedKey.includes("b") }).then((w) => (weather = w));
  });

  // Prévision des stations météo choisies
  let forecast = $state(new Map<number, Point[]>());
  $effect(() => {
    const ids = display.forecast ? selected.filter((c) => !c.avg && homeWeather.stations.some((st) => st.placeId === c.node.id))
      .flatMap((c) => (seriesByPlace.get(c.node.id) ?? []).map((x) => x.id)) : [];
    void data;
    loadForecast(ids).then((f) => (forecast = f));
  });

  // Alertes importantes de la période, marquées sur les courbes des emplacements eux-mêmes
  let events = $state<AlertEvent[]>([]);
  async function loadEvents(from: number) {
    try { events = (await api.alertEvents({ since: from })).filter((e) => e.level === "warning"); } catch { events = []; }
  }
  function markersOf(prop: string) {
    const shown = new Set(selected.filter((c) => !c.avg).map((c) => c.node.id));
    // (comparaisons et pentes : leur valeur n'est pas sur l'échelle de la courbe, pas de marque ici)
    return events.filter((e) => e.property === prop && shown.has(e.place_id) && ["above", "below", "peak", "trough"].includes(e.kind))
      .map((e) => ({ ts: e.started_at, value: (e.kind === "above" || e.kind === "below" ? e.threshold : e.value) ?? 0, level: e.level }));
  }

  async function load(range = loadRange(win)) {
    // Les grandeurs masquées ne sont pas chargées
    const ids = sel.seriesIds(selected, seriesByPlace, visible);
    const id = ++reqId;
    loading = true;
    try {
      const r = await loadCurves(ids, range, win);
      if (id !== reqId) return;
      data = r.data;
      bands = r.bands;
      loadedKey = r.key;
      loaded = range;
      loadEvents(range[0]);
      error = "";
    } catch (e) {
      if (id === reqId) error = e instanceof Error ? e.message : String(e);
    } finally {
      if (id === reqId) loading = false;
    }
  }

  // Seuils du temps long modifiés : données d'une autre nature à charger
  $effect(() => { void display.longview; if (loadedKey && otherView(win, loadedKey)) load(loadRange(win)); });

  function setWindow(w: Window) {
    win = w;
    if (needsReload(w, loaded) || otherView(w, loadedKey)) load(loadRange(w));
  }

  // Grandeur réaffichée : ses mesures n'ont pas été chargées
  let shown = "";
  $effect(() => {
    const key = visible.join(",");
    if (all && shown && key !== shown && visible.some((v) => !shown.split(",").includes(v))) load();
    shown = key;
  });

  const curvePoints = (c: Selected, prop: string) => sel.curvePoints(c, prop, seriesByPlace, data);

  /** Une courbe par grandeur affichée (jamais deux unités sur un même axe) */
  const charts = $derived.by(() => {
    const byProp = new Map<string, { title: string; unit: string; series: ChartSeries[] }>();
    for (const s of all ?? []) {
      if (visible.includes(s.property) && !byProp.has(s.property))
        byProp.set(s.property, { title: s.property_name, unit: s.unit, series: [] });
    }
    for (const c of selected) {
      for (const [prop, chart] of byProp) {
        const base = { id: c.key, name: c.name, color: colorOf(c.key) };
        // Mesures détaillées et / ou bande min – max (le graphique choisit ce qui est au premier plan)
        const band = bands.size ? sel.curveBand(c, prop, seriesByPlace, bands) : null;
        const points = curvePoints(c, prop);
        if (!points && !band) continue;
        chart.series.push({ ...base, points: points ?? [], ...(band ? { band } : {}), dashed: c.avg });
        if (!points?.length) continue;
        // Station météo : sa prévision prolonge sa courbe
        const sid = c.avg ? undefined : seriesByPlace.get(c.node.id)?.find((x) => x.property === prop)?.id;
        if (sid !== undefined && forecast.has(sid)) chart.series.push(...forecastCurve(base, points, forecast.get(sid)));
      }
    }
    for (const [prop, c] of byProp) if (c.series.length) c.series.push(...weatherCurve(weather, prop, selected.map((x) => x.node.id)));
    return [...byProp.entries()].filter(([, c]) => c.series.length).sort(([a], [b]) => rank(a) - rank(b));
  });

  /** Récapitulatif d'une courbe en bandes : moyenne du dernier jour, minimum et maximum de la fenêtre */
  function summaryBand(band: DayBand[]) {
    const inWin = band.filter((b) => b.ts >= win[0] - 43_200_000 && b.ts <= win[1] + 43_200_000);
    if (!inWin.length) return null;
    return { last: inWin.at(-1)!.avg, min: Math.min(...inWin.map((b) => b.min)), max: Math.max(...inWin.map((b) => b.max)) };
  }

  /** Tableau récapitulatif de la fenêtre visible : dernière valeur, minimum, maximum */
  function summary(points: Point[]) {
    const inWin = points.filter((p) => p.quality !== "rejected" && p.ts >= win[0] && p.ts <= win[1]);
    if (!inWin.length) return null;
    let min = Infinity, max = -Infinity;
    for (const p of inWin) { min = Math.min(min, p.value); max = Math.max(max, p.value); }
    return { last: inWin.at(-1)!.value, min, max };
  }

  // Fenêtre calée sur « maintenant » : suit le temps qui passe (toutes les 5 minutes, page visible)
  $effect(() => {
    const t = setInterval(() => {
      const w = win[1] - win[0];
      if (document.visibilityState === "visible" && followsNow(win)) setWindow([Date.now() - w, Date.now()]);
    }, 5 * 60_000);
    return () => clearInterval(t);
  });
</script>

<div class="stack">
  <div class="row">
    <a href={backHref} class="back">‹ Synthèse</a>
    <span class="spacer"></span>
    <a href={backHref} class="btn primary">Terminé</a>
  </div>
  <div class="row name">
    <h1 style="margin:0">Réglages de la synthèse</h1>
    <label class="name-field">Nom
      <input bind:value={dashName} onchange={rename} onblur={rename} maxlength="40" />
    </label>
  </div>
  <small class="muted">Emplacements, durée, grandeurs et rendu de cette page de synthèse. Une autre synthèse se crée avec
    le bouton + de la page Synthèse.</small>

  <PeriodBar window={win} onchange={setWindow} {loading} />

  {#if error}<div class="notice err" role="alert">{error}</div>{/if}

  {#if all === null}
    <p class="muted">Chargement…</p>
  {:else if !nodes.some((n) => n.series.length)}
    <div class="card">Aucune série : affectez d'abord des capteurs à des emplacements (Admin › Capteurs).</div>
  {:else}
    {#snippet chip(key: number, label: string, help = "")}
      {@const on = key in slots}
      <button class="chip" class:on class:avg={key < 0} aria-pressed={on} disabled={!on && full} onclick={() => toggle(key)}
              title={!on && full ? `${MAX_SERIES} courbes au plus en même temps` : help}>
        {#if on}<span class="key" class:dashed={key < 0} style="--c:{colorOf(key)}"></span>{/if}
        {label}
      </button>
    {/snippet}
    {#snippet item(n: PlaceNode)}
      {#if isParent(n)}
        <!-- Parent, puis ses sous-emplacements à la suite, ou en retrait dessous s'ils ne tiennent pas -->
        <div class="group">
          {#if hasAvg(n)}
            {@render chip(-n.id, n.name, n.measured.length > 1 ? `Moyenne des ${n.measured.length} emplacements mesurés de « ${n.name} »` : `Mesures de « ${n.name} »`)}
          {:else}
            <span class="chip avg none" title="Aucune mesure dans cet emplacement ni ses sous-emplacements">{n.name}</span>
          {/if}
          <div class="kids">{#each n.children as c (c.id)}{@render item(c)}{/each}</div>
        </div>
      {:else if n.series.length}
        {@render chip(n.id, n.name)}
      {:else}
        <span class="chip none" title="Aucune mesure : aucun capteur affecté">{n.name}</span>
      {/if}
    {/snippet}

    <div class="places" role="group" aria-label="Courbes affichées">
      {#if leaves.length}
        <div class="chips">{#each leaves as n (n.id)}{@render item(n)}{/each}</div>
      {/if}
      {#each groups as g (g.id)}{@render item(g)}{/each}
      {#if groups.length}
        <small class="muted"><span class="legend-avg"></span> emplacement parent : moyenne de ses sous-emplacements</small>
      {/if}
    </div>
    <DisplayBar {properties} />
    {#if clashes.length}
      <small class="muted">Même couleur pour {clashes.map((n) => n.join(" et ")).join(", ")} : la couleur d'un emplacement
        se choisit sur sa page (ou dans Admin › Emplacements).</small>
    {/if}
    {#if full}<small class="muted">{MAX_SERIES} courbes au plus en même temps : retirez-en une pour en ajouter une autre.</small>{/if}

    {#if selected.length === 0}
      <div class="card muted">Choisissez un ou plusieurs emplacements ci-dessus (ou la moyenne d'un groupe).</div>
    {:else}
      {#each charts as [prop, c] (prop)}
        <section class="card">
          <h2>{c.title} <small class="muted">({c.unit})</small></h2>
          <TimeChart series={c.series} unit={c.unit} {loaded} window={win} onwindow={setWindow} {loading}
                     curve={display.curve} alertPoints={markersOf(prop)} alertsWideOnly group="courbes" label="{c.title} : {c.series.map((s) => s.name).join(', ')}" />
        </section>
      {/each}
      <small class="muted">Toucher ou survoler une courbe pour lire les valeurs ; zoomer à deux doigts ou à la molette ;
        se déplacer dans le temps avec la barre sous la courbe et ses poignées. Les courbes de la page bougent ensemble.
        Bouton en haut à droite : plein écran.</small>

      <section class="card">
        <h2>Sur la période affichée</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Emplacement</th>
                {#each charts as [prop, c] (prop)}<th class="r">{c.title} {bandMode ? "moyenne du dernier jour" : "actuelle"}</th><th class="r">min – max</th>{/each}
              </tr>
            </thead>
            <tbody>
              {#each selected as p (p.key)}
                <tr>
                  <td><span class="key" class:dashed={p.avg} style="--c:{colorOf(p.key)}"></span>
                    {#if p.avg}{p.name}{:else}<a href="#/lieu/{p.node.id}">{p.name}</a>{/if}</td>
                  {#each charts as [prop, c] (prop)}
                    {@const band = bandMode ? sel.curveBand(p, prop, seriesByPlace, bands) : null}
                    {@const pts = bandMode ? null : curvePoints(p, prop)}
                    {@const sum = band ? summaryBand(band) : pts ? summary(pts) : null}
                    <td class="r num">{sum ? fmtValue(sum.last, c.unit) : "–"}</td>
                    <td class="r num">{sum ? `${fmtValue(sum.min, c.unit)} – ${fmtValue(sum.max, c.unit)}` : "–"}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .back { text-decoration: none; font-weight: 600; }
  .name { align-items: end; }
  .name-field { display: flex; align-items: center; gap: 0.5rem; }
  .name-field input { width: 14rem; max-width: 60vw; }
  td.num { white-space: nowrap; }
  .places { display: grid; gap: 0.5rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip { border-radius: 999px; min-height: 2.1rem; padding: 0.3rem 0.8rem; font-size: 0.9rem; color: var(--muted); }
  .chip.on { color: var(--text); border-color: var(--text); font-weight: 600; }
  .chip.avg { border: 1.5px dashed var(--muted); font-weight: 600; color: var(--text); }
  .chip.avg.on { border-color: var(--text); }
  .chip.none { display: inline-flex; align-items: center; border: 1px dotted var(--border); background: none;
               color: var(--muted); opacity: 0.6; cursor: default; font-weight: 400; }
  /* Retrait « suspendu » : le parent en tête, les sous-emplacements à la suite ou décalés à la ligne */
  .group { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; padding-left: 1.5rem; }
  .group > .chip { margin-left: -1.5rem; }
  .kids { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; min-width: 0;
          border-left: 2px solid var(--border); padding-left: 0.5rem; }
  .kids > .group { padding-left: 1.5rem; margin-right: 0.4rem; }
  .legend-avg { display: inline-block; width: 1.4rem; height: 0.9rem; border: 1.5px dashed var(--muted); border-radius: 999px;
                vertical-align: middle; }
  .key { display: inline-block; width: 14px; height: 0; border-top: 3px solid var(--c); vertical-align: middle; margin-right: 0.35rem; }
  .key.dashed { border-top-style: dashed; width: 16px; }
  h2 small { font-weight: 400; }
</style>
