<script lang="ts">
  import { api } from "../lib/api";
  import { isDark, propertyColor } from "../lib/colors";
  import { fmtAgo, fmtDate, fmtValue, isStale } from "../lib/format";
  import { DAY, loadRange, needsReload, type Window } from "../lib/period";
  import type { CurrentValue, Observation, PlaceDeployment, Point, SeriesInfo, SeriesStats } from "../lib/types";
  import PeriodBar from "../components/PeriodBar.svelte";
  import TimeChart from "../components/TimeChart.svelte";

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
  const name = $derived(series?.[0]?.place_name ?? current[0]?.place_name ?? "Emplacement");
  const lastTs = $derived(current.map((c) => c.ts).filter(Boolean).sort().at(-1) ?? null);

  $effect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const f = () => (dark = m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  });

  async function init() {
    try {
      const [all, cur, deps] = await Promise.all([api.seriesList(), api.currentValues(), api.placeDeployments(placeId)]);
      series = all.filter((s) => s.place_id === placeId);
      current = cur.filter((c) => c.place_id === placeId);
      deployments = deps;
      // Courbes, statistiques et liste indépendantes : l'échec de l'une n'empêche pas les autres
      const results = await Promise.allSettled([load(), loadRows(true), loadStats()]);
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
      const res = await api.seriesData((series ?? []).map((s) => s.id), range[0], range[1]);
      if (id !== reqId) return;
      data = res;
      loaded = range;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      if (id === reqId) loading = false;
    }
  }

  async function loadStats() {
    const w = win;
    const entries = await Promise.all((series ?? []).map(async (s) => [s.id, await api.seriesStats(s.id, w[0], w[1])] as const));
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
    }, 5 * 60_000);
    return () => clearInterval(t);
  });
</script>

<div class="stack">
  <div class="row">
    <a href="#/" class="back">‹ Maintenant</a>
    <span class="spacer"></span>
    <a href="#/donnees?lieu={placeId}" class="btn">Exporter les données</a>
  </div>

  {#if error}<div class="notice err" role="alert">{error}</div>{/if}

  <section class="card head">
    <div class="row">
      <h1 style="margin:0">{name}</h1>
      {#if series?.[0]?.exposure}<span class="badge">{EXPOSURE[series[0].exposure]}</span>{/if}
    </div>
    <div class="values">
      {#each sorted as s (s.id)}
        {@const c = current.find((x) => x.series_id === s.id)}
        <div class="value">
          <span class="num big" style="color:{propertyColor(s.property, dark)}">{fmtValue(c?.value ?? null, s.unit)}</span>
          <small>{s.property_name.toLowerCase()}</small>
        </div>
      {/each}
    </div>
    <small title={fmtDate(lastTs)}>
      {#if isStale(lastTs)}<span class="badge warn">ancienne</span>{/if} dernière mesure {fmtAgo(lastTs)}
    </small>
  </section>

  <PeriodBar window={win} onchange={setWindow} {loading} />

  {#if series && series.length === 0}
    <div class="card muted">Aucun capteur n'est affecté à cet emplacement.</div>
  {/if}

  {#each sorted as s (s.id)}
    {@const st = stats.get(s.id)}
    <section class="card">
      <h2>{s.property_name} <small class="muted">({s.unit})</small></h2>
      <TimeChart series={[{ id: s.id, name: s.property_name, color: propertyColor(s.property, dark), points: data.get(s.id) ?? [] }]}
                 unit={s.unit} {loaded} window={win} onwindow={setWindow} {loading} height={240}
                 group="lieu-{placeId}" label="{s.property_name} – {name}" />
      {#if st}
        <dl class="stats">
          <div><dt>Minimum</dt><dd class="num">{fmtValue(st.vmin, s.unit)}</dd><small>{fmtDate(st.tmin)}</small></div>
          <div><dt>Maximum</dt><dd class="num">{fmtValue(st.vmax, s.unit)}</dd><small>{fmtDate(st.tmax)}</small></div>
          <div><dt>Moyenne</dt><dd class="num">{fmtValue(st.vavg, s.unit)}</dd></div>
          <div><dt>Mesures</dt><dd class="num">{st.n.toLocaleString("fr-FR")}</dd></div>
        </dl>
      {/if}
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
