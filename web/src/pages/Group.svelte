<script lang="ts">
  // Page d'un emplacement parent (groupe) : moyenne de ses sous-emplacements, leurs courbes
  // superposées avec la moyenne en tirets, et la liste des sous-emplacements.
  import { api } from "../lib/api";
  import { isDark, placeColor, slotColor, type ColorChoice } from "../lib/colors";
  import { fmtAgo, fmtValue, isStale } from "../lib/format";
  import { canEdit } from "../lib/home.svelte";
  import { DAY, loadRange, needsReload, type Window } from "../lib/period";
  import { averagePoints, flatten, placeTree, type PlaceNode } from "../lib/placetree";
  import { computeTrend } from "../lib/trend";
  import { display, visibleProps } from "../lib/display.svelte";
  import type { CurrentValue, Place, Point, SeriesInfo } from "../lib/types";
  import PeriodBar from "../components/PeriodBar.svelte";
  import DisplayBar from "../components/DisplayBar.svelte";
  import TimeChart, { type ChartSeries } from "../components/TimeChart.svelte";
  import TrendArrow from "../components/TrendArrow.svelte";
  import ColorPicker from "../components/ColorPicker.svelte";
  import { homeWeather, loadWeather, weatherCurve } from "../lib/weather-state.svelte";
  import type { WeatherSeries } from "../lib/weather";

  let { placeId, places, series }: { placeId: number; places: Place[]; series: SeriesInfo[] } = $props();

  // svelte-ignore state_referenced_locally
  const node = flatten(placeTree(places, series)).find((n) => n.id === placeId)!;
  // svelte-ignore state_referenced_locally
  const place = places.find((p) => p.id === placeId)!;
  const dark = isDark();
  const ORDER = ["temperature", "humidity"];
  const rank = (p: string) => (ORDER.indexOf(p) + 9) % 9;

  /** Sous-emplacements mesurés, dans l'ordre de l'arborescence, avec leur couleur */
  const members = (node.series.length ? [node] : []).concat(flatten(node.children).filter((n) => n.series.length))
    .map((n, i) => ({ node: n, color: n.custom ?? slotColor(n.color ?? i, dark) }));
  const groupColor = place.color ?? (place.color_slot != null ? slotColor(place.color_slot, dark) : "#7a7f85");

  // svelte-ignore state_referenced_locally
  const properties = [...new Map(series.filter((s) => node.measured.includes(s.place_id)).map((s) => [s.property, s.property_name]))]
    .map(([code, name]) => ({ code, name })).sort((a, b) => rank(a.code) - rank(b.code));
  const visible = $derived(visibleProps(properties.map((p) => p.code)));
  // svelte-ignore state_referenced_locally
  const seriesOf = (placeId: number, prop: string) => series.find((s) => s.place_id === placeId && s.property === prop);

  let current = $state<CurrentValue[]>([]);
  let win = $state<Window>([Date.now() - DAY, Date.now()]);
  let loaded = $state<Window>(loadRange([Date.now() - DAY, Date.now()]));
  let data = $state(new Map<number, Point[]>());
  let history = $state(new Map<number, Point[]>());
  let loading = $state(false);
  let error = $state("");
  let reqId = 0;
  let color = $state<ColorChoice>(place.color ?? place.color_slot ?? null);
  let colorOpen = $state(false);

  const ids = () => members.flatMap((m) => visible.map((p) => seriesOf(m.node.id, p)?.id)).filter((id): id is number => id != null);

  async function load(range = loadRange(win)) {
    const id = ++reqId;
    loading = true;
    try {
      const res = await api.seriesData(ids(), range[0], range[1]);
      if (id !== reqId) return;
      data = res;
      loaded = range;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      if (id === reqId) loading = false;
    }
  }
  async function loadCurrent() {
    try {
      current = (await api.currentValues()).filter((c) => node.measured.includes(c.place_id));
      const to = Date.now();
      history = await api.seriesData(ids(), to - 25 * 3_600_000, to);
    } catch { /* valeurs actuelles indisponibles : la page reste utilisable */ }
  }
  load();
  loadCurrent();

  let weather = $state<WeatherSeries | null>(null);
  $effect(() => {
    const [a, b] = loaded, on = display.weather;
    void homeWeather.loc;
    loadWeather(on, a, b).then((w) => (weather = w));
  });

  function setWindow(w: Window) {
    win = w;
    if (needsReload(w, loaded)) load(loadRange(w));
  }
  // Grandeur réaffichée : ses mesures n'ont pas été chargées
  let shown = "";
  $effect(() => {
    const key = visible.join(",");
    if (shown && key !== shown) { load(); loadCurrent(); }
    shown = key;
  });
  $effect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const w = win[1] - win[0];
      if (win[1] >= Date.now() - 10 * 60_000) setWindow([Date.now() - w, Date.now()]);
      loadCurrent();
    }, 5 * 60_000);
    return () => clearInterval(t);
  });

  /** Moyenne actuelle et tendance de la moyenne, par grandeur affichée */
  const averages = $derived(visible.flatMap((prop) => {
    const items = current.filter((c) => c.property === prop && c.value !== null);
    if (!items.length) return [];
    const lists = items.map((c) => history.get(c.series_id)).filter((l): l is Point[] => !!l);
    return [{
      property: prop, unit: items[0].unit, n: items.length,
      value: Math.round((items.reduce((t, c) => t + c.value!, 0) / items.length) * 10) / 10,
      trend: lists.length === items.length ? computeTrend(averagePoints(lists), prop, display.trend) : null,
    }];
  }));

  /** Une courbe par grandeur : chaque sous-emplacement, et la moyenne en tirets */
  const charts = $derived(visible.flatMap((prop) => {
    const curves: ChartSeries[] = [];
    for (const m of members) {
      const s = seriesOf(m.node.id, prop);
      if (s) curves.push({ id: s.id, name: m.node.id === placeId ? `${m.node.name} (capteur propre)` : m.node.name, color: m.color, points: data.get(s.id) ?? [] });
    }
    if (!curves.length) return [];
    const p = properties.find((x) => x.code === prop)!;
    const unit = series.find((s) => s.property === prop)?.unit ?? "";
    if (curves.length > 1)
      curves.unshift({ id: `avg-${prop}`, name: "Moyenne", color: groupColor, dashed: true, points: averagePoints(curves.map((c) => c.points)) });
    curves.push(...weatherCurve(weather, prop));
    return [{ prop, title: p.name, unit, curves }];
  }));

  async function saveColor(choice: ColorChoice) {
    const before = color;
    color = choice;
    try { await api.setPlaceColor(placeId, choice); } catch (e) {
      color = before;
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const lastTs = $derived(current.map((c) => c.ts).filter(Boolean).sort().at(-1) ?? null);
</script>

<div class="stack">
  <div class="row">
    <a href="#/" class="back">‹ Maintenant</a>
    <span class="spacer"></span>
    {#if canEdit()}<a href="#/admin/emplacements" class="btn">Organiser les emplacements</a>{/if}
  </div>

  {#if error}<div class="notice err" role="alert">{error}</div>{/if}

  <section class="card head">
    <div class="row">
      <h1 style="margin:0">{node.name}</h1>
      <span class="badge">groupe de {node.measured.length} emplacement{node.measured.length > 1 ? "s" : ""}</span>
    </div>
    <div class="values">
      {#each averages as a (a.property)}
        <div class="value">
          <span class="num big {a.property}">⌀ {fmtValue(a.value, a.unit)}{#if a.trend}<span class="arrow"><TrendArrow
            trend={a.trend} unit={a.unit} detail /></span>{/if}</span>
          <small>{a.property === "temperature" ? "température" : a.property === "humidity" ? "humidité" : a.property} moyenne</small>
        </div>
      {/each}
    </div>
    {#if canEdit()}
      <div class="color">
        <button class="link" onclick={() => (colorOpen = !colorOpen)} aria-expanded={colorOpen}>
          {#if color !== null}<span class="dot" style="--c:{placeColor({ color: typeof color === 'string' ? color : null, color_slot: typeof color === 'number' ? color : null }, dark, 0)}"></span>{/if}
          Couleur de la moyenne : {color === null ? "automatique" : "choisie"} {colorOpen ? "▴" : "▾"}
        </button>
        {#if colorOpen}<ColorPicker value={color} {dark} onchange={saveColor} />{/if}
      </div>
    {/if}
    <small>dernière mesure {fmtAgo(lastTs)}</small>
  </section>

  <PeriodBar window={win} onchange={setWindow} {loading} />
  {#if properties.length}<DisplayBar {properties} />{/if}

  {#each charts as c (c.prop)}
    <section class="card">
      <h2>{c.title} <small class="muted">({c.unit})</small></h2>
      <TimeChart series={c.curves} unit={c.unit} {loaded} window={win} onwindow={setWindow} {loading}
                 curve={display.curve} group="groupe-{placeId}" label="{c.title} – {node.name}" />
    </section>
  {/each}

  <section class="card">
    <h2>Sous-emplacements</h2>
    <ul class="members">
      {#each members as m (m.node.id)}
        {@const cur = current.filter((c) => c.place_id === m.node.id && visible.includes(c.property))
          .sort((a, b) => rank(a.property) - rank(b.property))}
        <li>
          <span class="key" style="--c:{m.color}"></span>
          {#if m.node.id === placeId}
            <a href="#/lieu/{m.node.id}?seul">{m.node.name}</a> <small class="muted">capteur propre</small>
          {:else}
            <a href="#/lieu/{m.node.id}">{m.node.name}</a>
          {/if}
          <span class="spacer"></span>
          {#each cur as v (v.series_id)}
            <span class="num {v.property}" class:stale={isStale(v.ts)}>{fmtValue(v.value, v.unit)}</span>
          {/each}
        </li>
      {/each}
    </ul>
  </section>
</div>

<style>
  .back { text-decoration: none; font-weight: 600; }
  .head { display: grid; gap: 0.5rem; border-style: dashed; }
  .values { display: flex; gap: 2rem; flex-wrap: wrap; }
  .value { display: grid; }
  .big { font-size: 2rem; font-weight: 700; line-height: 1.1; }
  .temperature { color: var(--temp); }
  .humidity { color: var(--hum); }
  .arrow { font-size: 1rem; margin-left: 0.4rem; font-weight: 400; }
  h2 small { font-weight: 400; }
  .color { display: grid; gap: 0.4rem; justify-items: start; }
  .color .link { font-size: 0.85rem; color: var(--muted); display: inline-flex; align-items: center; gap: 0.35rem; }
  .dot { display: inline-block; width: 0.8rem; height: 0.8rem; border-radius: 50%; background: var(--c); }
  .members { list-style: none; margin: 0; padding: 0; }
  .members li { display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0; border-bottom: 1px solid var(--border); }
  .members li:last-child { border-bottom: none; }
  .members .num { font-weight: 700; }
  .key { width: 14px; height: 0; border-top: 3px solid var(--c); }
  .stale { opacity: 0.6; }
</style>
