<script lang="ts">
  // Synthèse (pensée pour le téléphone) : les courbes choisies dans la page Courbes, sans réglage,
  // et sous elles (ou à côté, en paysage) la légende avec les valeurs à l'instant du curseur, leur
  // tendance et les alertes. Le curseur est à « maintenant » par défaut : valeurs actuelles d'un coup d'œil.
  import { api } from "../lib/api";
  import { isDark } from "../lib/colors";
  import { loadRange, needsReload, type Window } from "../lib/period";
  import { fmtAgo, fmtValue } from "../lib/format";
  import { flatten, placeTree } from "../lib/placetree";
  import * as sel from "../lib/chartsel";
  import { curveData, valueAt } from "../lib/curve";
  import { computeTrend } from "../lib/trend";
  import { describe, RECENT } from "../lib/alerts.svelte";
  import { homeWeather, loadWeather, primaryStation, weatherCurve } from "../lib/weather-state.svelte";
  import { rulesBySeries, trendTone, zoneOf } from "../lib/zones";
  import type { WeatherSeries } from "../lib/weather-parse";
  import type { AlertEvent, AlertRule, Place, Point, SeriesInfo } from "../lib/types";
  import TimeChart, { type ChartSeries } from "../components/TimeChart.svelte";
  import TrendArrow from "../components/TrendArrow.svelte";
  import { display, visibleProps } from "../lib/display.svelte";
  import { ctx } from "../lib/home.svelte";

  const saved = sel.readSelection(ctx.homeId);
  let slots = $state<sel.Slots>(saved.slots);
  let all = $state<SeriesInfo[] | null>(null);
  let placeList = $state<Place[]>([]);
  const initial: Window = [Date.now() - saved.width, Date.now()];
  let win = $state<Window>(initial);
  let loaded = $state<Window>(loadRange(initial));
  let data = $state(new Map<number, Point[]>());
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
      if (!Object.keys(slots).length) slots = sel.defaultSlots(nodes);
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
      const res = await api.seriesData(sel.seriesIds(selected, seriesByPlace, visible), range[0], range[1]);
      if (id !== reqId) return;
      data = res;
      loaded = range;
      now = Date.now();
      error = "";
      api.alertEvents({ since: range[0] }).then((e) => (events = e)).catch(() => (events = []));
      const st = primaryStation();
      api.alertRules([...res.keys(), ...[st?.temperature, st?.humidity].filter((x): x is number => x != null)])
        .then((r) => (rules = rulesBySeries(r))).catch(() => {});
    } catch (e) {
      if (id === reqId) error = e instanceof Error ? e.message : String(e);
    } finally {
      if (id === reqId) loading = false;
    }
  }

  function setWindow(w: Window) {
    win = w;
    sel.saveSelection(ctx.homeId, slots, w[1] - w[0]);
    if (needsReload(w, loaded)) load(loadRange(w));
  }

  /** Curseur tout à droite (moins de 2 % de la fenêtre avant maintenant) : « maintenant » */
  function setCursor(t: number) {
    cursor = t >= Date.now() - 0.02 * (win[1] - win[0]) ? null : t;
  }
  const at = $derived(cursor ?? now);
  /** Trait du curseur : à l'instant choisi, ou au bord droit si la fenêtre se termine maintenant */
  const mark = $derived(cursor ?? (now - win[1] < 15 * 60_000 ? Math.min(now, win[1]) : null));

  // Fenêtre calée sur « maintenant » : suit le temps qui passe (toutes les 5 minutes, page visible)
  $effect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const w = win[1] - win[0];
      if (win[1] >= Date.now() - 10 * 60_000) setWindow([Date.now() - w, Date.now()]);
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
    loadWeather(on, a, b).then((w) => (weather = w));
  });

  /** Une courbe par grandeur affichée */
  const charts = $derived(shownProps.map((p) => {
    const curves: ChartSeries[] = [];
    for (const c of selected) {
      const points = sel.curvePoints(c, p.code, seriesByPlace, data);
      if (points) curves.push({ id: c.key, name: c.name, color: colorOf(c.key), points, dashed: c.avg });
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

  /** Légende : une ligne par courbe, valeurs à l'instant choisi, tendance et alerte */
  const rows = $derived.by(() => {
    const keys = new Map<string, { id: string | number; name: string; color: string; dashed?: boolean; dotted?: boolean;
                                   places: number[]; values: Map<string, { v: number | null; pts: Point[] }> }>();
    for (const c of charts) {
      for (const s of c.curves) {
        const k = String(s.id).replace(/^meteo-.*/, "meteo");
        const sc = selected.find((x) => x.key === s.id);
        if (!keys.has(k)) keys.set(k, { id: s.id, name: s.name, color: s.color, dashed: s.dashed, dotted: s.dotted,
                                         places: sc?.places ?? [], values: new Map() });
        const v = valueAt(curveData(s.points, display.curve), at, display.curve !== "step", 3 * 3_600_000);
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
  const unitOf = (prop: string) => properties.find((p) => p.code === prop)?.unit ?? "";
</script>

<div class="stack summary">
  <div class="row head">
    <h1 style="margin:0">Synthèse</h1>
    <span class="spacer"></span>
    <a href="#/courbes" class="btn" title="Choix des emplacements, période, rendu et autres options">Détails / options</a>
  </div>

  {#if error}<div class="notice err" role="alert">{error}</div>{/if}

  {#if all === null}
    <p class="muted">Chargement…</p>
  {:else if !selected.length || !charts.length}
    <div class="card">Aucune courbe choisie : <a href="#/courbes">choisir des emplacements</a>.</div>
  {:else}
    <div class="panels" class:landscape>
      <div class="charts">
        {#each charts as c (c.code)}
          <section class="card chart-card">
            {#if charts.length > 1}<h2>{c.name} <small class="muted">({c.unit})</small></h2>{/if}
            <TimeChart series={c.curves} unit={c.unit} {loaded} window={win} onwindow={setWindow} {loading}
                       curve={display.curve} group="synthese" label="{c.name} : {c.curves.map((s) => s.name).join(', ')}"
                       height={chartHeight} fullscreen={false} cursor={mark} oncursor={setCursor} />
          </section>
        {/each}
      </div>

      <section class="card legend" aria-live="polite">
        <div class="when">
          <strong>{cursor === null ? "Maintenant" : fmtTime(at)}</strong>
          {#if cursor !== null}
            <small class="muted">{fmtAgo(new Date(at).toISOString(), Date.now())}</small>
            <button class="link" onclick={() => (cursor = null)}>maintenant ›</button>
          {:else}
            <small class="muted">{new Date(now).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small>
          {/if}
        </div>
        <ul>
          {#each rows as r (r.id)}
            <li>
              <span class="key" class:dashed={r.dashed} class:dotted={r.dotted} style="--c:{r.color}"></span>
              {#if typeof r.id === "number"}
                <a class="name" href="#/lieu/{Math.abs(r.id)}">{r.name}</a>
              {:else}
                <span class="name">{r.name}</span>
              {/if}
              {#each shownProps as p (p.code)}
                {@const x = r.values.get(p.code)}
                {@const tr = r.trends.get(p.code) ?? null}
                {@const sid = seriesOf(r.id, p.code)}
                {@const rs = sid !== null ? rules.get(sid) ?? [] : []}
                {@const v = x && x.v !== null ? Math.round(x.v * 10) / 10 : null}
                {@const tone = trendTone(v, tr, rs, p.code)}
                <span class="val {p.code}">
                  <span class="num"><span class="zv {zoneOf(v, rs) ?? ''}" class:worse={tone?.startsWith("worse")}>{v !== null ? fmtValue(v, unitOf(p.code)) : "–"}</span></span>
                  <span class="arrow">{#if tr}<TrendArrow trend={tr} unit={unitOf(p.code)} {tone} />{/if}</span>
                </span>
              {/each}
              <span class="alert" title={r.alert ? describe(r.alert) : ""}>
                {#if r.alert}<span class={r.alert.level}>{r.alert.level === "warning" ? "⚠" : "ⓘ"}</span>{/if}
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
  li { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0; border-bottom: 1px solid var(--border); min-width: 0; }
  li:last-child { border-bottom: none; }
  .key { flex: none; width: 16px; height: 0; border-top: 3px solid var(--c); }
  .key.dashed { border-top-style: dashed; }
  .key.dotted { border-top: 2px dotted var(--c); }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text);
          text-decoration: none; font-size: 0.92rem; }
  .val { display: inline-flex; align-items: center; justify-content: flex-end; gap: 0.1rem; flex: none; }
  .val .num { font-weight: 700; min-width: 3.6rem; text-align: right; }
  .val.temperature .num { color: var(--val-temp); }
  .val.humidity .num { color: var(--val-hum); min-width: 2.8rem; }
  .arrow { display: inline-flex; width: 1.2rem; justify-content: center; font-size: 0.9rem; }
  .alert { flex: none; width: 1rem; text-align: center; font-weight: 700; }
  .alert .warning { color: var(--err); }
  .alert .info { color: var(--hum); }
  .hint { display: block; margin-top: 0.35rem; font-size: 0.75rem; }
</style>
