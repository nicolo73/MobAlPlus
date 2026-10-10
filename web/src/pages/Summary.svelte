<script lang="ts">
  // Synthèse (pensée pour le téléphone) : les courbes choisies dans la page Courbes, sans réglage,
  // et sous elles (ou à côté, en paysage) la légende avec les valeurs à l'instant du curseur, leur
  // tendance et les alertes. Le curseur est à « maintenant » par défaut : valeurs actuelles d'un coup d'œil.
  import { api } from "../lib/api";
  import { isDark } from "../lib/colors";
  import { loadRange, followsNow, needsReload, type Window } from "../lib/period";
  import { fmtAgo, fmtValue } from "../lib/format";
  import { flatten, placeTree } from "../lib/placetree";
  import * as sel from "../lib/chartsel";
  import { addDashboard, getDashboard, listDashboards, removeDashboard, updateDashboard } from "../lib/dashboards";
  import { bandMain, type DayBand } from "../lib/longview";
  import { loadCurves, otherView } from "../lib/curveload";
  import { curveData, valueAt } from "../lib/curve";
  import { computeTrend } from "../lib/trend";
  import { describe, RECENT } from "../lib/alerts.svelte";
  import { forecastCurve, homeWeather, loadForecast, loadWeather, primaryStation, weatherCurve } from "../lib/weather-state.svelte";
  import { rulesBySeries, trendTone, zoneOf } from "../lib/zones";
  import type { WeatherSeries } from "../lib/weather-parse";
  import type { AlertEvent, AlertRule, Place, Point, SeriesInfo } from "../lib/types";
  import TimeChart, { type ChartSeries } from "../components/TimeChart.svelte";
  import TrendArrow from "../components/TrendArrow.svelte";
  import { display, visibleProps } from "../lib/display.svelte";
  import { ctx } from "../lib/home.svelte";

  let { dashboardId = null }: { dashboardId?: string | null } = $props();

  // Synthèse affichée (il peut y en avoir plusieurs, chacune avec ses courbes) et la liste, pour en changer
  // svelte-ignore state_referenced_locally
  const dash = getDashboard(ctx.homeId, dashboardId);
  const dashboards = listDashboards(ctx.homeId);
  const saved = dash;
  let slots = $state<sel.Slots>(dash.slots);
  let all = $state<SeriesInfo[] | null>(null);
  let placeList = $state<Place[]>([]);
  const initial: Window = [Date.now() - saved.width, Date.now()];
  let win = $state<Window>(initial);
  let loaded = $state<Window>(loadRange(initial));
  let data = $state(new Map<number, Point[]>());
  /** Temps long (plus de 8 jours affichés) : bandes min – max journalières au lieu des mesures */
  let bands = $state(new Map<number, DayBand[]>());
  let loadedKey = $state("");
  /** Bande min – max au premier plan (fenêtre large) ; la courbe détaillée passe en fond */
  const bandMode = $derived(bandMain(win, display.longview));
  let events = $state<AlertEvent[]>([]);
  /** Seuils d'alerte haut / bas des séries affichées : couleur des valeurs et des flèches */
  let rules = $state(new Map<number, AlertRule[]>());
  let loading = $state(false);
  let error = $state("");
  let dark = $state(isDark());
  let now = $state(Date.now());
  /** Instant choisi ; null = maintenant (suit le temps qui passe) */
  let cursor = $state<number | null>(null);
  let reqId = 0;

  const tree = $derived(placeTree(placeList, all ?? []));
  const nodes = $derived(flatten(tree));
  const byId = $derived(new Map(nodes.map((n) => [n.id, n])));
  const seriesByPlace = $derived(sel.groupByPlace(all ?? []));
  const selected = $derived(sel.selectedCurves(nodes, slots, true));
  const colorOf = (key: number) => sel.colorOf(byId, slots, key, dark);
  const ORDER = ["temperature", "humidity"];
  const rank = (prop: string) => (ORDER.indexOf(prop) + 9) % 9;
  const properties = $derived.by(() => {
    const m = new Map<string, { name: string; unit: string }>();
    for (const s of all ?? []) m.set(s.property, { name: s.property_name, unit: s.unit });
    return [...m].map(([code, p]) => ({ code, ...p })).sort((a, b) => rank(a.code) - rank(b.code));
  });
  const visible = $derived(visibleProps(properties.map((p) => p.code)));
  const shownProps = $derived(properties.filter((p) => visible.includes(p.code)));

  async function init() {
    try {
      const [series, pl] = await Promise.all([api.seriesList(), api.places()]);
      placeList = pl;
      all = series;
      slots = Object.fromEntries(Object.entries(slots).filter(([k]) => sel.validKey(byId, Number(k))));
      // Première synthèse jamais réglée : les premiers emplacements ; une synthèse ajoutée reste à régler
      if (!Object.keys(slots).length && dash.id === "principale" && dashboards.length === 1) {
        slots = sel.defaultSlots(nodes);
        updateDashboard(ctx.homeId, dash.id, { slots });
      }
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  init();

  async function load(range = loadRange(win)) {
    const id = ++reqId;
    loading = true;
    try {
      const ids = sel.seriesIds(selected, seriesByPlace, visible);
      const r = await loadCurves(ids, range, win);
      if (id !== reqId) return;
      data = r.data;
      bands = r.bands;
      loadedKey = r.key;
      loaded = range;
      now = Date.now();
      error = "";
      api.alertEvents({ since: range[0] }).then((e) => (events = e)).catch(() => (events = []));
      const st = primaryStation();
      api.alertRules([...ids, ...[st?.temperature, st?.humidity].filter((x): x is number => x != null)])
        .then((r) => (rules = rulesBySeries(r))).catch(() => {});
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
    updateDashboard(ctx.homeId, dash.id, { width: w[1] - w[0] });
    if (needsReload(w, loaded) || otherView(w, loadedKey)) load(loadRange(w));
  }

  function addNew() {
    location.hash = `#/courbes?d=${encodeURIComponent(addDashboard(ctx.homeId))}`;
  }
  function remove() {
    if (!confirm(`Supprimer la synthèse « ${dash.name} » ? Les mesures ne sont pas touchées.`)) return;
    location.hash = `#/synthese/${encodeURIComponent(removeDashboard(ctx.homeId, dash.id))}`;
  }

  /** Curseur à moins de 2 % de la fenêtre de maintenant : « maintenant » ; au-delà, passé ou futur (prévisions) */
  function setCursor(t: number) {
    cursor = Math.abs(t - Date.now()) <= 0.02 * (win[1] - win[0]) ? null : t;
  }
  const at = $derived(cursor ?? now);
  /** Trait du curseur : à l'instant choisi, ou au bord droit si la fenêtre se termine maintenant */
  const mark = $derived(cursor ?? (now - win[1] < 15 * 60_000 ? Math.min(now, win[1]) : null));

  // Fenêtre calée sur « maintenant » : suit le temps qui passe (toutes les 5 minutes, page visible)
  $effect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const w = win[1] - win[0];
      if (followsNow(win)) setWindow([Date.now() - w, Date.now()]);
      else now = Date.now();
      if (!needsReload(win, loaded)) load(loadRange(win));
    }, 5 * 60_000);
    return () => clearInterval(t);
  });

  $effect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const f = () => (dark = m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  });

  // Hauteur des courbes : l'écran se partage entre courbes et légende (portrait) ou les courbes
  // prennent toute la hauteur (paysage, légende à côté)
  let vh = $state(innerHeight);
  let landscape = $state(false);
  $effect(() => {
    const q = matchMedia("(orientation: landscape) and (min-width: 600px)");
    const f = () => { vh = innerHeight; landscape = q.matches; };
    f();
    addEventListener("resize", f);
    q.addEventListener("change", f);
    return () => { removeEventListener("resize", f); q.removeEventListener("change", f); };
  });
  const chartHeight = $derived.by(() => {
    const n = Math.max(1, shownProps.length);
    return Math.round(landscape ? Math.max(170, (vh - 170) / n) : n === 1 ? Math.min(380, Math.max(220, vh * 0.42)) : Math.max(165, vh * 0.24));
  });

  // Météo publique (courbe de comparaison, si activée dans les options)
  let weather = $state<WeatherSeries | null>(null);
  $effect(() => {
    const [a, b] = loaded, on = display.weather;
    void homeWeather.stations;
    loadWeather(on, a, b, display.forecast, { raw: loadedKey.includes("r"), band: loadedKey.includes("b") }).then((w) => (weather = w));
  });

  // Stations météo choisies : leur prévision prolonge leur courbe
  let forecast = $state(new Map<number, Point[]>());
  const stationSeries = $derived(selected.filter((c) => !c.avg && homeWeather.stations.some((st) => st.placeId === c.node.id))
    .flatMap((c) => (seriesByPlace.get(c.node.id) ?? []).map((x) => x.id)));
  $effect(() => {
    const ids = display.forecast ? stationSeries : [];
    void data;
    loadForecast(ids).then((f) => (forecast = f));
  });

  /** Une courbe par grandeur affichée */
  const charts = $derived(shownProps.map((p) => {
    const curves: ChartSeries[] = [];
    for (const c of selected) {
      const base = { id: c.key, name: c.name, color: colorOf(c.key) };
      const band = bands.size ? sel.curveBand(c, p.code, seriesByPlace, bands) : null;
      const points = sel.curvePoints(c, p.code, seriesByPlace, data);
      if (!points && !band) continue;
      curves.push({ ...base, points: points ?? [], ...(band ? { band } : {}), dashed: c.avg });
      if (!points?.length) continue;
      const sid = c.avg ? undefined : seriesByPlace.get(c.node.id)?.find((x) => x.property === p.code)?.id;
      if (sid !== undefined && forecast.has(sid)) curves.push(...forecastCurve(base, points, forecast.get(sid)));
    }
    if (curves.length) curves.push(...weatherCurve(weather, p.code, selected.map((x) => x.node.id)));
    return { ...p, curves };
  }).filter((c) => c.curves.length));

  /** Série d'une ligne de légende pour une grandeur (emplacement ou station météo ; pas les moyennes) */
  function seriesOf(id: string | number, prop: string): number | null {
    if (typeof id === "string") {
      const st = primaryStation();
      return (prop === "temperature" ? st?.temperature : prop === "humidity" ? st?.humidity : null) ?? null;
    }
    if (id < 0) return null;
    return seriesByPlace.get(id)?.find((s) => s.property === prop)?.id ?? null;
  }

  /** Ligne de légende d'une courbe : l'emplacement (sa prévision comprise), ou « meteo » pour la comparaison */
  const curveKey = (id: string | number) => String(id).replace(/-prevision$/, "").replace(/^meteo-.*/, "meteo");
  /** Ligne survolée (souris) ou touchée (valeurs, sur téléphone) : sa courbe est mise en évidence */
  let hovered = $state<string | null>(null);
  /** Dernier type de pointeur (souris : le survol suffit ; toucher : bascule) */
  let pointer = "";
  const highlightOf = (curves: ChartSeries[]) => hovered === null ? [] : curves.filter((x) => curveKey(x.id) === hovered).map((x) => String(x.id));

  /** Légende : une ligne par courbe, valeurs à l'instant choisi, tendance et alerte */
  const rows = $derived.by(() => {
    const keys = new Map<string, { id: string | number; name: string; color: string; dashed?: boolean; dotted?: boolean;
                                   places: number[]; values: Map<string, { v: number | null; pts: Point[]; day?: DayBand }> }>();
    for (const c of charts) {
      for (const s of c.curves) {
        // Une ligne par emplacement : sa prévision donne la valeur quand le curseur est dans le futur
        const k = curveKey(s.id);
        const sc = selected.find((x) => String(x.key) === k);
        if (!keys.has(k)) keys.set(k, { id: sc?.key ?? s.id, name: s.name, color: s.color, dashed: s.dashed, dotted: s.dotted,
                                         places: sc?.places ?? [], values: new Map() });
        if (s.forecast && at <= now) continue;
        if (s.band && bandMode) {
          // Temps long : minimum et maximum du jour sous le curseur
          const day = s.band.find((b) => Math.abs(b.ts - at) <= 12 * 3_600_000);
          keys.get(k)!.values.set(c.code, { v: day?.max ?? null, pts: [], day });
          continue;
        }
        const v = valueAt(curveData(s.points, display.curve), at, display.curve !== "step" || !!s.forecast, 3 * 3_600_000);
        if (s.forecast && v === null) continue;
        keys.get(k)!.values.set(c.code, { v, pts: s.points });
      }
    }
    const first = shownProps[0]?.code;
    return [...keys.values()].map((r) => ({
      ...r,
      alert: alertAt(r.places),
      trends: new Map([...r.values].map(([prop, x]) =>
        [prop, x.v === null ? null : computeTrend(x.pts.filter((p) => p.ts <= at && p.ts > at - 25 * 3_600_000), prop, display.trend)])),
    })).sort((a, b) => (b.values.get(first)?.v ?? -Infinity) - (a.values.get(first)?.v ?? -Infinity));
  });

  /** Alerte la plus importante en cours à l'instant choisi, pour les emplacements d'une courbe */
  function alertAt(places: number[]): AlertEvent | null {
    const hits = events.filter((e) => !e.archived && places.includes(e.place_id) && visible.includes(e.property)
      && (e.kind === "peak" || e.kind === "trough"
        ? at >= e.started_at && at - e.started_at < RECENT
        : e.started_at <= at && (e.ended_at ?? Infinity) >= at));
    return hits.find((e) => e.level === "warning") ?? hits[0] ?? null;
  }

  const fmtTime = (t: number) => {
    const d = new Date(t);
    return `${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} ${
      d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  };
  /** « dans 5 h », « dans 2 j » */
  const fmtIn = (t: number) => {
    const m = Math.max(0, (t - Date.now()) / 60_000);
    return m < 60 ? `dans ${Math.round(m)} min` : m < 1440 ? `dans ${Math.round(m / 60)} h` : `dans ${Math.round(m / 1440)} j`;
  };
  const fmtDay = (t: number) => new Date(t).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  /** Nombre seul (sans unité), à la précision de la grandeur */
  const numOnly = (v: number, unit: string) => {
    const d = unit === "%" ? 0 : 1;
    return v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const unitOf = (prop: string) => properties.find((p) => p.code === prop)?.unit ?? "";
</script>

<div class="stack summary">
  <div class="row head">
    <h1 style="margin:0">{dash.name}</h1>
    <span class="spacer"></span>
    <div class="tools">
      <a href="#/courbes?d={encodeURIComponent(dash.id)}" class="icon-btn" title="Réglages de cette synthèse : emplacements, période, rendu…"
         aria-label="Réglages de cette synthèse">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path
          d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
      </a>
      <button class="icon-btn" title="Nouvelle synthèse" aria-label="Nouvelle synthèse" onclick={addNew}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
      {#if dashboards.length > 1}
        <button class="icon-btn" title="Supprimer cette synthèse" aria-label="Supprimer cette synthèse" onclick={remove}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
        </button>
      {/if}
    </div>
  </div>
  {#if dashboards.length > 1}
    <!-- Autres synthèses (glisser à gauche / à droite pour passer de l'une à l'autre sur téléphone) -->
    <nav class="dash-tabs" aria-label="Synthèses" data-noswipe>
      {#each dashboards as d (d.id)}
        <a href="#/synthese/{encodeURIComponent(d.id)}" class:active={d.id === dash.id} aria-current={d.id === dash.id ? "page" : undefined}>{d.name}</a>
      {/each}
    </nav>
  {/if}

  {#if error}<div class="notice err" role="alert">{error}</div>{/if}

  {#if all === null}
    <p class="muted">Chargement…</p>
  {:else if !selected.length || !charts.length}
    <div class="card">Aucune courbe choisie : <a href="#/courbes?d={encodeURIComponent(dash.id)}">choisir des emplacements</a>.</div>
  {:else}
    <div class="panels" class:landscape>
      <div class="charts">
        {#each charts as c (c.code)}
          <section class="card chart-card">
            {#if charts.length > 1}<h2>{c.name} <small class="muted">({c.unit})</small></h2>{/if}
            <TimeChart series={c.curves} unit={c.unit} {loaded} window={win} onwindow={setWindow} {loading}
                       curve={display.curve} group="synthese" label="{c.name} : {c.curves.map((s) => s.name).join(', ')}"
                       height={chartHeight} fullscreen={false} cursor={mark} oncursor={setCursor} highlight={highlightOf(c.curves)} />
          </section>
        {/each}
      </div>

      <section class="card legend" aria-live="polite">
        <div class="when">
          <strong>{cursor === null ? (bandMode ? "Aujourd'hui" : "Maintenant") : bandMode ? fmtDay(at) : fmtTime(at)}</strong>
          {#if bandMode}<small class="muted">min – max du jour ({shownProps.map((p) => p.unit).join(", ")})</small>{/if}
          {#if cursor !== null}
            <small class="muted">{at > Date.now() ? `prévision, ${fmtIn(at)}` : fmtAgo(new Date(at).toISOString(), Date.now())}</small>
            <button class="link" onclick={() => (cursor = null)}>maintenant ›</button>
          {:else if !bandMode}
            <small class="muted">{new Date(now).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small>
          {/if}
        </div>
        <ul>
          {#each rows as r (r.id)}
            {@const key = curveKey(r.id)}
            <li class:hl={hovered === key}
                onpointerenter={(e) => { if (e.pointerType === "mouse") hovered = key; }}
                onpointerleave={(e) => { if (e.pointerType === "mouse" && hovered === key) hovered = null; }}>
              <span class="key" class:dashed={r.dashed} class:dotted={r.dotted} style="--c:{r.color}"></span>
              {#if typeof r.id === "number"}
                <a class="name" href="#/lieu/{Math.abs(r.id)}">{r.name}</a>
              {:else}
                <span class="name">{r.name}</span>
              {/if}
              <!-- Valeurs : toucher met la courbe en évidence (le nom, lui, ouvre la page de l'emplacement) -->
              <span class="vals" role="button" tabindex="0" aria-pressed={hovered === key}
                    title="Mettre en évidence la courbe de {r.name}"
                    onpointerdown={(e) => (pointer = e.pointerType)}
                    onclick={() => (hovered = pointer === "mouse" || hovered !== key ? key : null)}
                    onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hovered = hovered === key ? null : key; } }}>
              {#each shownProps as p (p.code)}
                {@const x = r.values.get(p.code)}
                {@const tr = r.trends.get(p.code) ?? null}
                {@const sid = seriesOf(r.id, p.code)}
                {@const rs = sid !== null ? rules.get(sid) ?? [] : []}
                {@const v = x && x.v !== null ? Math.round(x.v * 10) / 10 : null}
                {@const tone = trendTone(v, tr, rs, p.code)}
                <span class="val {p.code}">
                  {#if x?.day}
                    <!-- Temps long : minimum – maximum du jour (fond selon la valeur la plus à risque) -->
                    <span class="num range zv {zoneOf(x.day.max, rs) ?? zoneOf(x.day.min, rs) ?? ''}" title="minimum – maximum du jour">{numOnly(x.day.min, unitOf(p.code))}–{numOnly(x.day.max, unitOf(p.code))}</span>
                  {:else}
                  <span class="num zv {zoneOf(v, rs) ?? ''}" class:worse={tone?.startsWith("worse")}>{v !== null ? fmtValue(v, unitOf(p.code)) : "–"}</span>
                  {/if}
                  <span class="arrow">{#if tr}<TrendArrow trend={tr} unit={unitOf(p.code)} {tone} />{/if}</span>
                </span>
              {/each}
              <span class="alert" title={r.alert ? describe(r.alert) : ""}>
                {#if r.alert}<span class={r.alert.level}>{r.alert.level === "warning" ? "⚠" : "ⓘ"}</span>{/if}
              </span>
              </span>
            </li>
          {/each}
        </ul>
        <small class="muted hint">Toucher ou glisser sur la courbe pour lire un autre instant.</small>
      </section>
    </div>
  {/if}
</div>

<style>
  .head { flex-wrap: nowrap; }
  .head h1 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tools { display: flex; gap: 0.25rem; flex: none; }
  .icon-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 2.25rem; min-width: 2.25rem;
              padding: 0.3rem; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); }
  .icon-btn:hover { color: var(--text); }
  .icon-btn svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .dash-tabs { display: flex; gap: 0.35rem; overflow-x: auto; margin-top: -0.25rem; }
  .dash-tabs a { flex: none; padding: 0.3rem 0.75rem; border-radius: 999px; border: 1px solid var(--border); color: var(--muted);
                 text-decoration: none; font-size: 0.9rem; white-space: nowrap; }
  .dash-tabs a.active { color: var(--primary); border-color: var(--primary); font-weight: 600; background: var(--primary-soft); }
  .panels { display: grid; gap: 0.75rem; grid-template-columns: minmax(0, 1fr); }
  .panels.landscape { grid-template-columns: minmax(0, 1fr) minmax(15rem, 24rem); align-items: start; }
  .charts { display: grid; gap: 0.75rem; min-width: 0; }
  .chart-card { padding: 0.5rem 0.4rem 0.2rem; }
  .chart-card h2 { font-size: 0.95rem; margin: 0 0 0 0.4rem; }
  .landscape .legend { position: sticky; top: 4rem; }
  .legend { padding: 0.6rem 0.75rem; }
  .when { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.15rem 0.5rem; margin-bottom: 0.35rem; }
  .when > * { white-space: nowrap; }
  .when .link { font-size: 0.85rem; margin-left: auto; }
  ul { list-style: none; margin: 0; padding: 0; }
  /* Lignes sans marge verticale propre : le fond de zone d'une valeur occupe toute leur hauteur */
  li { display: flex; align-items: stretch; gap: 0.5rem; border-bottom: 1px solid var(--border); min-width: 0; min-height: 2.3rem; }
  li > :not(.vals) { align-self: center; }
  li.hl { background: var(--surface-2); }
  .vals { display: flex; align-items: stretch; gap: 0.5rem; flex: none; cursor: pointer; }
  .vals > .alert { align-self: center; }
  li:last-child { border-bottom: none; }
  .key { flex: none; width: 16px; height: 0; border-top: 3px solid var(--c); }
  .key.dashed { border-top-style: dashed; }
  .key.dotted { border-top: 2px dotted var(--c); }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text);
          text-decoration: none; font-size: 0.92rem; }
  .val { display: inline-flex; align-items: stretch; justify-content: flex-end; gap: 0.1rem; flex: none; }
  .val .num { display: flex; align-items: center; justify-content: flex-end; font-weight: 700; min-width: 3.6rem;
              padding: 0 0.5rem; }
  .val .arrow { align-self: center; }
  .val .num.range { font-size: 0.85rem; white-space: nowrap; }
  .val.temperature .num { color: var(--val-temp); }
  .val.humidity .num { color: var(--val-hum); min-width: 2.8rem; }
  .arrow { display: inline-flex; width: 1.2rem; justify-content: center; font-size: 0.9rem; }
  .alert { flex: none; width: 1rem; text-align: center; font-weight: 700; }
  .alert .warning { color: var(--err); }
  .alert .info { color: var(--hum); }
  .hint { display: block; margin-top: 0.35rem; font-size: 0.75rem; }
</style>
