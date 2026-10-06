<script lang="ts">
  import { api } from "../lib/api";
  import { canEdit } from "../lib/home.svelte";
  import { fmtAgo, fmtDate, fmtValue, isStale } from "../lib/format";
  import type { CurrentValue } from "../lib/types";
  import DisplayBar from "../components/DisplayBar.svelte";
  import TrendArrow from "../components/TrendArrow.svelte";
  import { computeTrend } from "../lib/trend";
  import type { Place, Point, SeriesInfo } from "../lib/types";
  import { averagePoints, placeTree, type PlaceNode } from "../lib/placetree";
  import { isDark, placeColor } from "../lib/colors";
  import { display, visibleProps } from "../lib/display.svelte";

  let values = $state<CurrentValue[] | null>(null);
  let places = $state<Place[]>([]);
  const dark = isDark();
  let error = $state("");
  let now = $state(Date.now());

  // Tendances : chargées après les valeurs (affichage immédiat), seulement pour les grandeurs
  // affichées, et au plus toutes les 5 minutes
  let history = $state(new Map<number, Point[]>());
  let historyAt = 0;
  let historyKey = "";
  async function loadTrends(force = false) {
    const ids = (values ?? []).filter((v) => visible.includes(v.property) && v.value !== null).map((v) => v.series_id);
    const key = ids.join(",");
    if (!ids.length || (!force && key === historyKey && Date.now() - historyAt < 5 * 60_000)) return;
    historyKey = key;
    historyAt = Date.now();
    try {
      const to = Date.now();
      history = await api.seriesData(ids, to - 25 * 3_600_000, to);
    } catch { historyKey = ""; /* les flèches attendront le prochain rafraîchissement */ }
  }
  const trends = $derived(new Map([...history].map(([id, pts]) => [id, computeTrend(pts,
    values?.find((v) => v.series_id === id)?.property ?? "", display.trend)])));
  // Grandeur réaffichée : ses tendances sont chargées à leur tour
  $effect(() => { void visible; if (values) setTimeout(() => loadTrends(), 0); });

  async function load() {
    try {
      const [cur, pl] = await Promise.all([api.currentValues(), api.places().catch(() => places)]);
      places = pl;
      values = cur;
      now = Date.now();
      error = "";
      setTimeout(() => loadTrends(), 0);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  load();

  // Actualisation toutes les 2 minutes tant que la page est visible
  $effect(() => {
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 120_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  });

  const ORDER = ["temperature", "humidity"];
  const rank = (p: string) => (ORDER.indexOf(p) + 9) % 9;
  /** Grandeurs présentes, et celles affichées (choix commun avec les courbes) */
  const properties = $derived.by(() => {
    const m = new Map<string, string>();
    for (const v of values ?? []) m.set(v.property, v.property === "temperature" ? "Temp." : v.property === "humidity" ? "Hum." : v.property);
    return [...m].map(([code, name]) => ({ code, name })).sort((a, b) => rank(a.code) - rank(b.code));
  });
  const visible = $derived(visibleProps(properties.map((p) => p.code)));

  /** Valeurs actuelles affichées, par emplacement */
  const byPlace = $derived.by(() => {
    const m = new Map<number, CurrentValue[]>();
    for (const v of values ?? []) {
      if (!visible.includes(v.property)) continue;
      m.set(v.place_id, [...(m.get(v.place_id) ?? []), v]);
    }
    for (const items of m.values()) items.sort((a, b) => rank(a.property) - rank(b.property));
    return m;
  });

  /** Arborescence des emplacements (ordre choisi dans Admin › Emplacements) */
  const tree = $derived(placeTree(places, (values ?? []).map((v) => ({
    id: v.series_id, name: v.series_name, place_id: v.place_id, place_name: v.place_name, exposure: null,
    property: v.property, property_name: v.property, unit: v.unit,
  }) as SeriesInfo)));

  /** Couleur choisie pour l'emplacement (marqueur), sinon rien */
  const markOf = (n: PlaceNode) => (n.custom || n.color !== null ? placeColor({ color: n.custom, color_slot: n.color }, dark, 0) : null);

  /** Moyenne actuelle d'un groupe, par grandeur, et sa tendance (moyenne des courbes) */
  function groupValues(n: PlaceNode) {
    return visible.flatMap((prop) => {
      const items = n.measured.flatMap((id) => (byPlace.get(id) ?? []).filter((v) => v.property === prop && v.value !== null));
      if (!items.length) return [];
      const value = items.reduce((t, v) => t + v.value!, 0) / items.length;
      const lists = items.map((v) => history.get(v.series_id)).filter((l): l is Point[] => !!l);
      const trend = lists.length === items.length ? computeTrend(averagePoints(lists), prop, display.trend) : null;
      const ts = items.map((v) => v.ts).filter(Boolean).sort()[0] ?? null;
      return [{ property: prop, unit: items[0].unit, value: Math.round(value * 10) / 10, n: items.length, trend, ts }];
    });
  }
</script>

<div class="row head">
  <h1 style="margin:0">Maintenant</h1>
  <span class="spacer"></span>
  {#if properties.length > 1}<DisplayBar {properties} curves={false} small />{/if}
  <button class="refresh" onclick={load} title="Actualiser" aria-label="Actualiser">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
  </button>
</div>

{#if error}
  <div class="notice err">{error}</div>
{:else if values === null}
  <p class="muted">Chargement…</p>
{:else if values.length === 0}
  <div class="card">
    <p>Aucun capteur n'est encore affecté à un emplacement de cette maison.</p>
    {#if canEdit()}<a href="#/admin/capteurs">Configurer les capteurs</a>{/if}
  </div>
{:else}
  {#snippet card(n: PlaceNode)}
    {@const items = byPlace.get(n.id) ?? []}
    {@const ts = items[0]?.ts ?? null}
    {@const stale = isStale(ts, now)}
    {@const mark = markOf(n)}
    <a class="card place" class:stale class:marked={mark} style={mark ? `--mark:${mark}` : ""} href="#/lieu/{n.id}"
       aria-label="{n.name} : historique et courbes">
      <h2>{n.name} <span class="chev" aria-hidden="true">›</span></h2>
      <div class="values">
        {#each items as v (v.series_id)}
          <div class="value {v.property}">
            <span class="num big">{fmtValue(v.value, v.unit)}{#if trends.get(v.series_id)}<span class="arrow"><TrendArrow
              trend={trends.get(v.series_id)!} unit={v.unit} detail={display.density !== "compact"} /></span>{/if}</span>
            <small class:hide={visible.length === 1 && display.density === "compact"}>{v.property === "temperature" ? "température" : v.property === "humidity" ? "humidité" : v.property}</small>
          </div>
        {/each}
      </div>
      <small title={fmtDate(ts)}>
        {#if stale}<span class="badge warn">ancienne</span>{/if}
        {fmtAgo(ts, now)}
      </small>
    </a>
  {/snippet}

  {#snippet node(n: PlaceNode)}
    {#if n.children.length}
      {#if n.measured.some((id) => byPlace.has(id))}
        {@const avg = groupValues(n)}
        {@const mark = markOf(n)}
        <section class="group" style={mark ? `--mark:${mark}` : ""} class:marked={mark}>
          <a class="group-head" href="#/lieu/{n.id}" aria-label="{n.name} : moyenne et détail du groupe">
            <h2>{n.name}</h2>
            {#each avg as g (g.property)}
              <span class="avg {g.property}" title="moyenne de {g.n} emplacement{g.n > 1 ? 's' : ''}">
                <span class="num">⌀ {fmtValue(g.value, g.unit)}</span>{#if g.trend}<span class="arrow"><TrendArrow
                  trend={g.trend} unit={g.unit} /></span>{/if}
              </span>
            {/each}
            <span class="chev" aria-hidden="true">›</span>
          </a>
          <div class="grid now" class:compact={display.density === "compact"}>
            {#if byPlace.has(n.id)}{@render card(n)}{/if}
            {#each n.children as c (c.id)}{@render node(c)}{/each}
          </div>
        </section>
      {/if}
    {:else if byPlace.has(n.id)}
      {@render card(n)}
    {/if}
  {/snippet}

  <div class="grid now" class:compact={display.density === "compact"}>
    {#each tree as n (n.id)}{@render node(n)}{/each}
  </div>
{/if}

<style>
  .head { margin-bottom: 1rem; flex-wrap: nowrap; gap: 0.5rem; }
  .head h1 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hide { display: none; }
  .refresh { min-height: 2rem; padding: 0.3rem 0.5rem; }
  .refresh svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  /* Présentation compacte : fiches plus étroites (2 colonnes sur téléphone), valeurs plus petites */
  .now.compact { grid-template-columns: repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr)); }
  .compact .place h2 { font-size: 0.9rem; margin-bottom: 0.35rem; }
  .compact .values { gap: 0.25rem 1rem; margin-bottom: 0.25rem; }
  .compact .big { font-size: 1.35rem; }
  .compact .value small { font-size: 0.75rem; }
  .place { display: block; color: inherit; text-decoration: none; transition: border-color 0.15s; }
  .place:hover { border-color: var(--primary); }
  .place h2 { font-size: 1rem; color: var(--muted); font-weight: 600; display: flex; justify-content: space-between; }
  .chev { color: var(--primary); font-size: 1.3rem; line-height: 1; }
  .values { display: flex; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
  .value { display: grid; }
  .big { font-size: 1.75rem; font-weight: 700; line-height: 1.1; }
  .arrow { font-size: 1rem; margin-left: 0.3rem; font-weight: 400; }
  .compact .arrow { font-size: 0.95rem; margin-left: 0.2rem; }
  .temperature .big { color: var(--temp); }
  .humidity .big { color: var(--hum); }
  .stale .big { opacity: 0.6; }
  /* Couleur choisie pour l'emplacement : liseré à gauche, comme repère commun avec les courbes */
  .place.marked { border-left: 4px solid var(--mark); }
  /* Emplacement parent : cadre en pointillé regroupant ses sous-emplacements, avec la moyenne */
  .group { grid-column: 1 / -1; border: 1.5px dashed var(--border); border-radius: var(--radius); padding: 0.6rem;
           display: grid; gap: 0.6rem; }
  .group.marked { border-color: var(--mark); }
  .group-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 1rem; text-decoration: none; color: inherit;
                padding: 0 0.25rem; }
  .group-head h2 { margin: 0; font-size: 1rem; }
  .group-head .chev { margin-left: auto; }
  .avg { display: inline-flex; align-items: center; font-weight: 700; }
  .avg.temperature { color: var(--temp); }
  .avg.humidity { color: var(--hum); }
  .compact.now, .group .now { gap: 0.5rem; }
</style>
