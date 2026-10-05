<script lang="ts">
  import { api } from "../lib/api";
  import { MAX_SERIES, isDark, slotColor } from "../lib/colors";
  import { DAY, loadRange, needsReload, type Window } from "../lib/period";
  import { fmtValue } from "../lib/format";
  import type { Place, Point, SeriesInfo } from "../lib/types";
  import { averagePoints, flatten, placeTree, type PlaceNode } from "../lib/placetree";
  import PeriodBar from "../components/PeriodBar.svelte";
  import TimeChart, { type ChartSeries } from "../components/TimeChart.svelte";
  import DisplayBar from "../components/DisplayBar.svelte";
  import { display, visibleProps } from "../lib/display.svelte";

  import { ctx } from "../lib/home.svelte";

  // Sélection mémorisée par maison
  const STORE = `mobalplus.charts.${ctx.homeId}`;

  let all = $state<SeriesInfo[] | null>(null);
  let placeList = $state<Place[]>([]);
  let error = $state("");
  // Courbe sélectionnée -> numéro de couleur (conservé tant qu'elle reste sélectionnée).
  // Clé : identifiant de l'emplacement (ses mesures), ou son opposé (moyenne de sa branche).
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

  /** Arbre des emplacements, et courbes possibles : mesures d'un emplacement, moyenne d'une branche */
  const tree = $derived(placeTree(placeList, all ?? []));
  const nodes = $derived(flatten(tree));
  const byId = $derived(new Map(nodes.map((n) => [n.id, n])));
  const seriesByPlace = $derived.by(() => {
    const m = new Map<number, SeriesInfo[]>();
    for (const s of all ?? []) m.set(s.place_id, [...(m.get(s.place_id) ?? []), s]);
    return m;
  });
  const hasAvg = (n: PlaceNode) => n.children.length > 0 && n.measured.length >= 2;
  const validKey = (k: number) => { const n = byId.get(Math.abs(k)); return !!n && (k > 0 ? n.series.length > 0 : hasAvg(n)); };
  interface Selected { key: number; node: PlaceNode; avg: boolean; name: string; places: number[] }
  const selected = $derived<Selected[]>(Object.keys(slots).map(Number).filter(validKey).map((key) => {
    const node = byId.get(Math.abs(key))!;
    const avg = key < 0;
    return { key, node, avg, name: avg ? `${node.name} (moyenne de ${node.measured.length})` : node.name,
             places: avg ? node.measured : [node.id] };
  }).sort((a, b) => nodes.indexOf(a.node) - nodes.indexOf(b.node) || b.key - a.key));
  const full = $derived(selected.length >= MAX_SERIES);
  const leaves = $derived(tree.filter((n) => !n.children.length));
  const groups = $derived(tree.filter((n) => n.children.length));
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
      if (!Object.keys(slots).length) nodes.filter((n) => n.series.length).slice(0, 4).forEach((n, i) => (slots[n.id] = i));
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
      const used = new Set(Object.values(slots));
      let slot = 0;
      while (used.has(slot)) slot++;
      slots = { ...slots, [key]: slot };
      load();
    }
  }

  async function load(range = loadRange(win)) {
    // Les grandeurs masquées ne sont pas chargées
    const ids = [...new Set(selected.flatMap((c) => c.places.flatMap((id) => seriesByPlace.get(id) ?? []))
      .filter((s) => visible.includes(s.property)).map((s) => s.id))];
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

  /** Points d'une courbe pour une grandeur : mesures de l'emplacement, ou moyenne de la branche */
  function curvePoints(c: Selected, prop: string): Point[] | null {
    const lists = c.places.flatMap((id) => (seriesByPlace.get(id) ?? []).filter((s) => s.property === prop))
      .map((s) => data.get(s.id) ?? []);
    if (!lists.length) return null;
    return c.avg ? averagePoints(lists) : lists[0];
  }

  /** Une courbe par grandeur affichée (jamais deux unités sur un même axe) */
  const charts = $derived.by(() => {
    const byProp = new Map<string, { title: string; unit: string; series: ChartSeries[] }>();
    for (const s of all ?? []) {
      if (visible.includes(s.property) && !byProp.has(s.property))
        byProp.set(s.property, { title: s.property_name, unit: s.unit, series: [] });
    }
    for (const c of selected) {
      for (const [prop, chart] of byProp) {
        const points = curvePoints(c, prop);
        if (points) chart.series.push({ id: c.key, name: c.name, color: slotColor(slots[c.key], dark), points, dashed: c.avg });
      }
    }
    return [...byProp.entries()].filter(([, c]) => c.series.length).sort(([a], [b]) => rank(a) - rank(b));
  });

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
  {:else if !nodes.some((n) => n.series.length)}
    <div class="card">Aucune série : affectez d'abord des capteurs à des emplacements (Admin › Capteurs).</div>
  {:else}
    {#snippet chip(key: number, label: string, help = "")}
      {@const on = key in slots}
      <button class="chip" class:on class:avg={key < 0} aria-pressed={on} disabled={!on && full} onclick={() => toggle(key)}
              title={!on && full ? `${MAX_SERIES} courbes au plus en même temps` : help}>
        {#if on}<span class="key" class:dashed={key < 0} style="--c:{slotColor(slots[key], dark)}"></span>{/if}
        {label}
      </button>
    {/snippet}
    {#snippet item(n: PlaceNode, prefix: string)}
      {#if n.series.length}{@render chip(n.id, prefix + n.name)}
      {:else if !hasAvg(n)}
        <span class="chip none" title="Aucune mesure : ni capteur, ni sous-emplacement mesuré">{prefix + n.name}</span>
      {/if}
      {#if hasAvg(n)}{@render chip(-n.id, `${prefix + n.name} · moyenne`, `Moyenne de ${n.measured.length} emplacements`)}{/if}
      {#each n.children as c (c.id)}{@render item(c, `${prefix}${n.name} › `)}{/each}
    {/snippet}

    <div class="places" role="group" aria-label="Courbes affichées">
      {#if leaves.length}
        <div class="chips">{#each leaves as n (n.id)}{@render item(n, "")}{/each}</div>
      {/if}
      {#each groups as g (g.id)}
        <div class="group">
          <div class="group-head">
            {#if g.series.length}{@render chip(g.id, g.name, "Capteur placé directement dans cet emplacement")}
            {:else}<span class="group-name">{g.name}</span>{/if}
            {#if hasAvg(g)}{@render chip(-g.id, "moyenne", `Moyenne des ${g.measured.length} emplacements mesurés de « ${g.name} »`)}{/if}
          </div>
          <div class="chips">
            {#each g.children as c (c.id)}{@render item(c, "")}{/each}
          </div>
        </div>
      {/each}
    </div>
    <DisplayBar {properties} />
    {#if full}<small class="muted">{MAX_SERIES} courbes au plus en même temps : retirez-en une pour en ajouter une autre.</small>{/if}

    {#if selected.length === 0}
      <div class="card muted">Choisissez un ou plusieurs emplacements ci-dessus (ou la moyenne d'un groupe).</div>
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
              {#each selected as p (p.key)}
                <tr>
                  <td><span class="key" class:dashed={p.avg} style="--c:{slotColor(slots[p.key], dark)}"></span>
                    {#if p.avg}{p.name}{:else}<a href="#/lieu/{p.node.id}">{p.name}</a>{/if}</td>
                  {#each charts as [prop, c] (prop)}
                    {@const pts = curvePoints(p, prop)}
                    {@const sum = pts ? summary(pts) : null}
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
  td.num { white-space: nowrap; }
  .places { display: grid; gap: 0.6rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip { border-radius: 999px; min-height: 2.1rem; padding: 0.3rem 0.8rem; font-size: 0.9rem; color: var(--muted); }
  .chip.on { color: var(--text); border-color: var(--text); font-weight: 600; }
  .chip.avg { border-style: dashed; }
  .chip.none { display: inline-flex; align-items: center; border: 1px dotted var(--border); background: none;
               color: var(--muted); opacity: 0.7; cursor: default; }
  .group { display: grid; gap: 0.4rem; padding-left: 0.75rem; border-left: 3px solid var(--border); }
  .group-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
  .group-name { font-weight: 600; margin-right: 0.2rem; }
  .key { display: inline-block; width: 14px; height: 0; border-top: 3px solid var(--c); vertical-align: middle; margin-right: 0.35rem; }
  .key.dashed { border-top-style: dashed; width: 16px; }
  h2 small { font-weight: 400; }
</style>
