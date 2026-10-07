<script lang="ts">
  import { api } from "../lib/api";
  import { isDark, propertyColor, slotColor, type ColorChoice } from "../lib/colors";
  import { fmtAgo, fmtDate, fmtValue, isStale } from "../lib/format";
  import { DAY, loadRange, needsReload, type Window } from "../lib/period";
  import type { CurrentValue, Observation, PlaceDeployment, Point, SeriesInfo, SeriesStats } from "../lib/types";
  import PeriodBar from "../components/PeriodBar.svelte";
  import TimeChart from "../components/TimeChart.svelte";
  import DisplayBar from "../components/DisplayBar.svelte";
  import TrendArrow from "../components/TrendArrow.svelte";
  import ColorPicker from "../components/ColorPicker.svelte";
  import AlertRulesEditor from "../components/AlertRulesEditor.svelte";
  import { homeWeather, loadWeather, weatherCurve } from "../lib/weather-state.svelte";
  import type { WeatherSeries } from "../lib/weather-parse";
  import type { AlertEvent, AlertRule } from "../lib/types";
  import { canEdit } from "../lib/home.svelte";
  import { router } from "../lib/router.svelte";
  import { loadAlerts } from "../lib/alerts.svelte";
  import { computeTrend } from "../lib/trend";
  import { display, visibleProps } from "../lib/display.svelte";

  let { placeId }: { placeId: number } = $props();

  const PAGE = 50;
  const EXPOSURE: Record<string, string> = { indoor: "intérieur", outdoor: "extérieur", appliance: "appareil" };

  let series = $state<SeriesInfo[] | null>(null);
  let current = $state<CurrentValue[]>([]);
  let deployments = $state<PlaceDeployment[]>([]);
  let win = $state<Window>([Date.now() - DAY, Date.now()]);
  let loaded = $state<Window>(loadRange([Date.now() - DAY, Date.now()]));
  let data = $state(new Map<number, Point[]>());
  let stats = $state(new Map<number, SeriesStats>());
  let rows = $state<Observation[]>([]);
  let moreAvailable = $state(true);
  let loading = $state(false);
  let error = $state("");
  let dark = $state(isDark());
  let reqId = 0;
  let statsTimer: ReturnType<typeof setTimeout> | undefined;

  const order = ["temperature", "humidity"];
  const sorted = $derived([...(series ?? [])].sort((a, b) =>
    (order.indexOf(a.property) + 9) % 9 - (order.indexOf(b.property) + 9) % 9));
  const properties = $derived(sorted.map((s) => ({ code: s.property, name: s.property_name })));
  const visible = $derived(visibleProps(properties.map((p) => p.code)));
  /** Séries dont la courbe est affichée (les grandeurs masquées ne sont ni chargées ni tracées) */
  const shownSeries = $derived(sorted.filter((s) => visible.includes(s.property)));
  const name = $derived(series?.[0]?.place_name ?? current[0]?.place_name ?? "Emplacement");
  const lastTs = $derived(current.map((c) => c.ts).filter(Boolean).sort().at(-1) ?? null);

  $effect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const f = () => (dark = m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  });

  // Tendances des valeurs actuelles : chargées à part, après le reste de la page
  let history = $state(new Map<number, Point[]>());
  /** Couleur de l'emplacement dans la page Courbes (undefined : pas encore lue) */
  let color = $state<ColorChoice | undefined>(undefined);
  let colorOpen = $state(false);
  async function saveColor(choice: ColorChoice) {
    const before = color;
    color = choice;
    try { await api.setPlaceColor(placeId, choice); } catch (e) {
      color = before;
      error = e instanceof Error ? e.message : String(e);
    }
  }
  async function loadTrends() {
    const ids = sorted.map((s) => s.id);
    if (!ids.length) return;
    try {
      const to = Date.now();
      history = await api.seriesData(ids, to - 25 * 3_600_000, to);
    } catch { /* pas de flèche : rien de bloquant */ }
  }
  const trends = $derived(new Map(sorted.map((s) => [s.id, history.has(s.id)
    ? computeTrend(history.get(s.id)!, s.property, display.trend) : null])));

  // Alertes : règles des séries de l'emplacement, et alertes de la période chargée (pics, creux)
  let rules = $state<AlertRule[]>([]);
  let events = $state<AlertEvent[]>([]);
  async function loadAlertData() {
    const ids = sorted.map((s) => s.id);
    try {
      [rules, events] = await Promise.all([api.alertRules(ids), api.alertEvents({ since: loaded[0], seriesIds: ids })]);
    } catch { /* base pas encore à jour : pas d'alerte */ }
  }
  const thresholdsOf = (id: number) => rules
    .filter((r) => r.series_id === id && r.enabled && (r.kind === "above" || r.kind === "below") && r.threshold != null)
    .map((r) => {
      const u = sorted.find((s) => s.id === id)?.unit ?? "";
      return { value: r.threshold!, level: r.level,
               label: `${r.level === "warning" ? "⚠" : "ⓘ"} ${fmtValue(r.threshold, u)}` };
    });
  /** Silence au-delà duquel une période est « sans mesure » : seuil « capteur muet » de la série, 3 h sinon */
  const silenceOf = (id: number) => (rules.find((r) => r.series_id === id && r.kind === "silent" && r.enabled)?.threshold ?? 3) * 3_600_000;
  /** Périodes sans mesure, grisées et sans tracé sur la courbe */
  function gapsOf(id: number): [number, number][] {
    const gap = silenceOf(id);
    const pts = (data.get(id) ?? []).filter((p) => p.quality !== "rejected");
    const out: [number, number][] = [];
    for (let i = 1; i < pts.length; i++) if (pts[i].ts - pts[i - 1].ts > gap) out.push([pts[i - 1].ts, pts[i].ts]);
    const last = pts.at(-1);
    if (last && Date.now() - last.ts > gap && loaded[1] >= Date.now() - gap) out.push([last.ts, Date.now()]);
    return out;
  }

  /** Mesures au-delà d'un seuil (niveau le plus élevé atteint) et pics / creux signalés */
  function alertPointsOf(id: number) {
    const rs = rules.filter((r) => r.series_id === id && r.enabled && r.threshold != null);
    const out: { ts: number; value: number; level: "info" | "warning" }[] = [];
    for (const p of data.get(id) ?? []) {
      if (p.quality === "rejected") continue;
      let level: "info" | "warning" | null = null;
      for (const r of rs) {
        const hit = (r.kind === "above" && p.value > r.threshold!) || (r.kind === "below" && p.value < r.threshold!);
        if (hit && (level === null || r.level === "warning")) level = r.level;
      }
      if (level) out.push({ ts: p.ts, value: p.value, level });
    }
    const pts = (data.get(id) ?? []).filter((p) => p.quality !== "rejected");
    for (const e of events) {
      if (e.series_id !== id) continue;
      if ((e.kind === "peak" || e.kind === "trough") && e.value !== null)
        out.push({ ts: e.started_at, value: e.value, level: e.level });
      // Comparaison, montée / baisse rapide : marque sur la courbe au début de l'alerte
      if (e.kind === "gap_above" || e.kind === "gap_below" || e.kind === "rise" || e.kind === "fall") {
        const at = pts.filter((p) => p.ts <= e.started_at).at(-1);
        if (at) out.push({ ts: e.started_at, value: at.value, level: e.level });
      }
    }
    return out;
  }

  // Météo publique de la période chargée
  let weather = $state<WeatherSeries | null>(null);
  $effect(() => {
    const [a, b] = loaded, on = display.weather;
    void homeWeather.stations;
    loadWeather(on, a, b).then((w) => (weather = w));
  });

  async function init() {
    try {
      const [all, cur, deps] = await Promise.all([api.seriesList(), api.currentValues(), api.placeDeployments(placeId)]);
      api.places().then((ps) => { const p = ps.find((x) => x.id === placeId); color = p?.color ?? p?.color_slot ?? null; }).catch(() => {});
      series = all.filter((s) => s.place_id === placeId);
      current = cur.filter((c) => c.place_id === placeId);
      deployments = deps;
      // Courbes, statistiques et liste indépendantes : l'échec de l'une n'empêche pas les autres
      const results = await Promise.allSettled([load(), loadRows(true), loadStats()]);
      setTimeout(loadTrends, 0);
      setTimeout(loadAlertData, 0);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      if (failed) error = failed.reason instanceof Error ? failed.reason.message : String(failed.reason);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  init();

  async function load(range = loadRange(win)) {
    const id = ++reqId;
    loading = true;
    try {
      const res = await api.seriesData(shownSeries.map((s) => s.id), range[0], range[1]);
      if (id !== reqId) return;
      data = res;
      if (range[0] < loaded[0]) setTimeout(loadAlertData, 0);  // période élargie : alertes plus anciennes
      loaded = range;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      if (id === reqId) loading = false;
    }
  }

  async function loadStats() {
    const w = win;
    const entries = await Promise.all(shownSeries.map(async (s) => [s.id, await api.seriesStats(s.id, w[0], w[1])] as const));
    if (w === win) stats = new Map(entries);
  }

  /** Liste des mesures de la fenêtre, les plus récentes d'abord, par pages */
  async function loadRows(reset = false) {
    const before = reset || !rows.length ? win[1] : Math.min(...rows.map((r) => r.ts));
    const res = await api.observations((series ?? []).map((s) => s.id), win[0], before, PAGE);
    rows = reset ? res : [...rows, ...res];
    moreAvailable = res.length >= PAGE;
  }

  function setWindow(w: Window) {
    win = w;
    if (needsReload(w, loaded)) load(loadRange(w));
    clearTimeout(statsTimer);
    statsTimer = setTimeout(() => { loadStats(); loadRows(true); }, 400);
  }

  // Grandeur réaffichée : ses courbes et statistiques n'ont pas été chargées
  let shown = "";
  $effect(() => {
    const key = visible.join(",");
    if (series && shown && key !== shown && visible.some((v) => !shown.split(",").includes(v))) { load(); loadStats(); }
    shown = key;
  });

  /** Une ligne par horodatage : température et humidité côte à côte */
  const table = $derived.by(() => {
    const byTs = new Map<number, Map<number, Observation>>();
    for (const r of rows) {
      if (!byTs.has(r.ts)) byTs.set(r.ts, new Map());
      byTs.get(r.ts)!.set(r.series_id, r);
    }
    return [...byTs.entries()].sort(([a], [b]) => b - a);
  });

  const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "…");

  // Fenêtre calée sur « maintenant » : suit le temps qui passe (toutes les 5 minutes, page visible)
  $effect(() => {
    const t = setInterval(() => {
      const w = win[1] - win[0];
      if (document.visibilityState === "visible" && win[1] >= Date.now() - 10 * 60_000) setWindow([Date.now() - w, Date.now()]);
      if (document.visibilityState === "visible") {
        // valeurs actuelles et tendances suivent aussi le temps qui passe
        api.currentValues().then((cur) => (current = cur.filter((c) => c.place_id === placeId))).catch(() => {});
        loadTrends();
      }
    }, 5 * 60_000);
    return () => clearInterval(t);
  });
</script>

<div class="stack">
  <div class="row">
    <a href="#/" class="back">‹ Maintenant</a>
    {#if router.query.has("seul")}<a href="#/lieu/{placeId}" class="back">‹ Groupe</a>{/if}
    <span class="spacer"></span>
    <a href="#/donnees?lieu={placeId}" class="btn">Exporter les données</a>
  </div>

  {#if error}<div class="notice err" role="alert">{error}</div>{/if}

  <section class="card head"
           style={color != null ? `border-left: 4px solid ${typeof color === "string" ? color : slotColor(color, dark)}` : ""}>
    <div class="row">
      <h1 style="margin:0">{name}</h1>
      {#if series?.[0]?.exposure}<span class="badge">{EXPOSURE[series[0].exposure]}</span>{/if}
    </div>
    <div class="values">
      {#each sorted as s (s.id)}
        {@const c = current.find((x) => x.series_id === s.id)}
        <div class="value">
          <span class="num big" style="color:{propertyColor(s.property, dark)}">{fmtValue(c?.value ?? null, s.unit)}{#if trends.get(s.id)}<span
            class="arrow"><TrendArrow trend={trends.get(s.id)!} unit={s.unit} detail /></span>{/if}</span>
          <small>{s.property_name.toLowerCase()}</small>
        </div>
      {/each}
    </div>
    {#if canEdit() && color !== undefined}
      <div class="color">
        <button class="link" onclick={() => (colorOpen = !colorOpen)} aria-expanded={colorOpen}>
          {#if color !== null}<span class="dot" style="--c:{typeof color === "string" ? color : slotColor(color, dark)}"></span>{/if}
          Couleur dans les courbes : {color === null ? "automatique" : "choisie"} {colorOpen ? "▴" : "▾"}
        </button>
        {#if colorOpen}<ColorPicker value={color} {dark} onchange={saveColor} />{/if}
      </div>
    {/if}
    <small title={fmtDate(lastTs)}>
      {#if isStale(lastTs)}<span class="badge warn">ancienne</span>{/if} dernière mesure {fmtAgo(lastTs)}
    </small>
  </section>

  <PeriodBar window={win} onchange={setWindow} {loading} />
  {#if sorted.length}<DisplayBar {properties} />{/if}

  {#if series && series.length === 0}
    <div class="card muted">Aucun capteur n'est affecté à cet emplacement.</div>
  {/if}

  {#each shownSeries as s (s.id)}
    {@const st = stats.get(s.id)}
    <section class="card">
      <h2>{s.property_name} <small class="muted">({s.unit})</small></h2>
      <TimeChart series={[{ id: s.id, name: s.property_name, color: propertyColor(s.property, dark), points: data.get(s.id) ?? [] },
                         ...weatherCurve(weather, s.property, [s.place_id])]}
                 unit={s.unit} {loaded} window={win} onwindow={setWindow} {loading} height={240}
                 curve={display.curve} thresholds={thresholdsOf(s.id)} alertPoints={alertPointsOf(s.id)} gaps={gapsOf(s.id)} cutAfter={silenceOf(s.id)}
                 group="lieu-{placeId}" label="{s.property_name} – {name}" />
      {#if st}
        <dl class="stats">
          <div><dt>Minimum</dt><dd class="num">{fmtValue(st.vmin, s.unit)}</dd><small>{fmtDate(st.tmin)}</small></div>
          <div><dt>Maximum</dt><dd class="num">{fmtValue(st.vmax, s.unit)}</dd><small>{fmtDate(st.tmax)}</small></div>
          <div><dt>Moyenne</dt><dd class="num">{fmtValue(st.vavg, s.unit)}</dd></div>
          <div><dt>Mesures</dt><dd class="num">{st.n.toLocaleString("fr-FR")}</dd></div>
        </dl>
      {/if}
      <AlertRulesEditor series={s} rules={rules.filter((r) => r.series_id === s.id)} editable={canEdit()}
                        onsaved={() => { loadAlertData(); loadAlerts(); }} />
    </section>
  {/each}

  {#if sorted.length}
    <section class="card">
      <h2>Mesures <small class="muted">(période affichée, plus récentes d'abord)</small></h2>
      <div class="table-wrap values-table">
        <table>
          <thead>
            <tr><th>Date</th>{#each sorted as s (s.id)}<th class="r">{s.property_name}</th>{/each}</tr>
          </thead>
          <tbody>
            {#each table as [ts, cells] (ts)}
              <tr>
                <td class="num">{fmtDate(new Date(ts).toISOString())}</td>
                {#each sorted as s (s.id)}
                  {@const o = cells.get(s.id)}
                  <td class="r num" class:rejected={o?.quality === "rejected"}
                      title={o?.quality === "rejected" ? "valeur rejetée" : o?.quality === "corrected" ? "valeur corrigée" : ""}>
                    {o ? fmtValue(o.value, s.unit) : ""}{#if o?.quality === "corrected"}*{/if}
                  </td>
                {/each}
              </tr>
            {:else}
              <tr><td colspan={sorted.length + 1} class="muted">Aucune mesure sur cette période.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if moreAvailable && rows.length}
        <button style="margin-top:0.75rem" onclick={() => loadRows()}>Afficher plus</button>
      {/if}
    </section>

    <section class="card">
      <h2>Capteurs</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Capteur</th><th>Grandeur</th><th>Période</th></tr></thead>
          <tbody>
            {#each deployments as d (d.series_id + d.ma_id + (d.from ?? ""))}
              <tr>
                <td>{d.device_name ?? d.ma_id}<br /><small class="num">{d.ma_id} · canal {d.channel_no}</small></td>
                <td>{d.property_name}</td>
                <td>{d.to ? `du ${fmtDay(d.from)} au ${fmtDay(d.to)}` : d.from ? `depuis le ${fmtDay(d.from)}` : "depuis l'origine"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</div>

<style>
  .back { text-decoration: none; font-weight: 600; }
  .head { display: grid; gap: 0.5rem; }
  .values { display: flex; gap: 2rem; flex-wrap: wrap; }
  .value { display: grid; }
  .color { display: grid; gap: 0.4rem; justify-items: start; }
  .color .link { font-size: 0.85rem; color: var(--muted); display: inline-flex; align-items: center; gap: 0.35rem; }
  .dot { display: inline-block; width: 0.8rem; height: 0.8rem; border-radius: 50%; background: var(--c); }
  .arrow { font-size: 1rem; margin-left: 0.4rem; font-weight: 400; }
  .big { font-size: 2rem; font-weight: 700; line-height: 1.1; }
  h2 small { font-weight: 400; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: 0.75rem; margin: 0.75rem 0 0; }
  .stats div { display: grid; gap: 0.1rem; }
  dt { font-size: 0.8rem; color: var(--muted); }
  dd { margin: 0; font-weight: 700; font-size: 1.1rem; }
  .values-table { max-height: 26rem; overflow-y: auto; }
  .values-table thead th { position: sticky; top: 0; background: var(--surface); }
  .rejected { text-decoration: line-through; color: var(--muted); }
</style>
