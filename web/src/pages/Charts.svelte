<script lang="ts">
  import { api } from "../lib/api";
  import { MAX_SERIES, isDark, slotColor } from "../lib/colors";
  import { DAY, loadRange, needsReload, type Window } from "../lib/period";
  import { fmtValue } from "../lib/format";
  import type { Point, SeriesInfo } from "../lib/types";
  import PeriodBar from "../components/PeriodBar.svelte";
  import TimeChart, { type ChartSeries } from "../components/TimeChart.svelte";
  import DisplayBar from "../components/DisplayBar.svelte";
  import { display, visibleProps } from "../lib/display.svelte";

  import { ctx } from "../lib/home.svelte";

  // Sélection mémorisée par maison
  const STORE = `mobalplus.charts.${ctx.homeId}`;

  let all = $state<SeriesInfo[] | null>(null);
  let error = $state("");
  // Emplacement sélectionné -> numéro de couleur (conservé tant qu'il reste sélectionné)
  let slots = $state<Record<number, number>>({});
  const initial = ((): Window => {
    try {
      const width = JSON.parse(localStorage.getItem(STORE) ?? "{}").width;
      if (width > 0) return [Date.now() - width, Date.now()];
    } catch { /* stockage indisponible */ }
    return [Date.now() - DAY, Date.now()];
  })();
  let win = $state<Window>(initial);
  let loaded = $state<Window>(loadRange(initial));
  let data = $state(new Map<number, Point[]>());
  let loading = $state(false);
  let dark = $state(isDark());
  let reqId = 0;

  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    if (saved.slots) slots = saved.slots;
  } catch { /* stockage indisponible : valeurs par défaut */ }

  $effect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ slots, width: win[1] - win[0] })); } catch { /* ignoré */ }
  });

  $effect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const f = () => (dark = m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  });

  /** Emplacements disposant de séries, avec leurs séries par grandeur */
  const places = $derived.by(() => {
    const map = new Map<number, { id: number; name: string; series: SeriesInfo[] }>();
    for (const s of all ?? []) {
      if (!map.has(s.place_id)) map.set(s.place_id, { id: s.place_id, name: s.place_name, series: [] });
      map.get(s.place_id)!.series.push(s);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  const selected = $derived(places.filter((p) => p.id in slots));
  const ORDER = ["temperature", "humidity"];
  const rank = (prop: string) => (ORDER.indexOf(prop) + 9) % 9;
  /** Grandeurs de la maison (température d'abord), et celles qui sont affichées */
  const properties = $derived.by(() => {
    const m = new Map<string, string>();
    for (const s of all ?? []) m.set(s.property, s.property_name);
    return [...m].map(([code, name]) => ({ code, name })).sort((a, b) => rank(a.code) - rank(b.code));
  });
  const visible = $derived(visibleProps(properties.map((p) => p.code)));
  const full = $derived(selected.length >= MAX_SERIES);

  async function init() {
    try {
      all = await api.seriesList();
      // Première visite : les premiers emplacements (4 au plus, pour garder des courbes lisibles)
      const known = new Set(places.map((p) => p.id));
      slots = Object.fromEntries(Object.entries(slots).filter(([id]) => known.has(Number(id))));
      if (!Object.keys(slots).length) places.slice(0, 4).forEach((p, i) => (slots[p.id] = i));
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  init();

  function toggle(placeId: number) {
    if (placeId in slots) {
      const { [placeId]: _, ...rest } = slots;
      slots = rest;
    } else if (!full) {
      const used = new Set(Object.values(slots));
      let slot = 0;
      while (used.has(slot)) slot++;
      slots = { ...slots, [placeId]: slot };
      load();
    }
  }

  async function load(range = loadRange(win)) {
    // Les grandeurs masquées ne sont pas chargées
    const ids = selected.flatMap((p) => p.series.filter((s) => visible.includes(s.property)).map((s) => s.id));
    const id = ++reqId;
    loading = true;
    try {
      const res = await api.seriesData(ids, range[0], range[1]);
      if (id !== reqId) return;
      data = res;
      loaded = range;
      error = "";
    } catch (e) {
      if (id === reqId) error = e instanceof Error ? e.message : String(e);
    } finally {
      if (id === reqId) loading = false;
    }
  }

  function setWindow(w: Window) {
    win = w;
    if (needsReload(w, loaded)) load(loadRange(w));
  }

  // Grandeur réaffichée : ses mesures n'ont pas été chargées
  let shown = "";
  $effect(() => {
    const key = visible.join(",");
    if (all && shown && key !== shown && visible.some((v) => !shown.split(",").includes(v))) load();
    shown = key;
  });

  /** Une courbe par grandeur affichée (jamais deux unités sur un même axe) */
  const charts = $derived.by(() => {
    const byProp = new Map<string, { title: string; unit: string; series: ChartSeries[] }>();
    for (const p of selected) {
      for (const s of p.series) {
        if (!visible.includes(s.property)) continue;
        if (!byProp.has(s.property)) byProp.set(s.property, { title: s.property_name, unit: s.unit, series: [] });
        byProp.get(s.property)!.series.push({
          id: s.id, name: p.name, color: slotColor(slots[p.id], dark), points: data.get(s.id) ?? [],
        });
      }
    }
    return [...byProp.entries()].sort(([a], [b]) => rank(a) - rank(b));
  });

  /** Tableau récapitulatif de la fenêtre visible : dernière valeur, minimum, maximum */
  function summary(points: Point[]) {
    const inWin = points.filter((p) => p.quality !== "rejected" && p.ts >= win[0] && p.ts <= win[1]);
    if (!inWin.length) return null;
    return {
      last: inWin.at(-1)!.value,
      min: Math.min(...inWin.map((p) => p.value)),
      max: Math.max(...inWin.map((p) => p.value)),
    };
  }

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
  <div class="row"><h1 style="margin:0">Courbes</h1></div>

  <PeriodBar window={win} onchange={setWindow} {loading} />

  {#if error}<div class="notice err" role="alert">{error}</div>{/if}

  {#if all === null}
    <p class="muted">Chargement…</p>
  {:else if places.length === 0}
    <div class="card">Aucune série : affectez d'abord des capteurs à des emplacements (Admin › Capteurs).</div>
  {:else}
    <div class="chips" role="group" aria-label="Emplacements affichés">
      {#each places as p (p.id)}
        {@const on = p.id in slots}
        <button class="chip" class:on aria-pressed={on} disabled={!on && full} onclick={() => toggle(p.id)}
                title={!on && full ? `${MAX_SERIES} emplacements au plus en même temps` : ""}>
          {#if on}<span class="key" style="background:{slotColor(slots[p.id], dark)}"></span>{/if}
          {p.name}
        </button>
      {/each}
    </div>
    <DisplayBar {properties} />
    {#if full}<small class="muted">{MAX_SERIES} emplacements au plus en même temps : retirez-en un pour en ajouter un autre.</small>{/if}

    {#if selected.length === 0}
      <div class="card muted">Choisissez un ou plusieurs emplacements ci-dessus.</div>
    {:else}
      {#each charts as [prop, c] (prop)}
        <section class="card">
          <h2>{c.title} <small class="muted">({c.unit})</small></h2>
          <TimeChart series={c.series} unit={c.unit} {loaded} window={win} onwindow={setWindow} {loading}
                     curve={display.curve} group="courbes" label="{c.title} : {c.series.map((s) => s.name).join(', ')}" />
        </section>
      {/each}
      <small class="muted">Glisser sur une courbe pour se déplacer dans le temps, molette ou poignées du curseur
        pour zoomer. Les courbes de la page bougent ensemble.</small>

      <section class="card">
        <h2>Sur la période affichée</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Emplacement</th>
                {#each charts as [prop, c] (prop)}<th class="r">{c.title} actuelle</th><th class="r">min – max</th>{/each}
              </tr>
            </thead>
            <tbody>
              {#each selected as p (p.id)}
                <tr>
                  <td><span class="key" style="background:{slotColor(slots[p.id], dark)}"></span>
                    <a href="#/lieu/{p.id}">{p.name}</a></td>
                  {#each charts as [prop, c] (prop)}
                    {@const s = p.series.find((x) => x.property === prop)}
                    {@const sum = s ? summary(data.get(s.id) ?? []) : null}
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
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip { border-radius: 999px; min-height: 2.1rem; padding: 0.3rem 0.8rem; font-size: 0.9rem; color: var(--muted); }
  .chip.on { color: var(--text); border-color: var(--text); font-weight: 600; }
  .key { display: inline-block; width: 14px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 0.35rem; }
  h2 small { font-weight: 400; }
</style>
