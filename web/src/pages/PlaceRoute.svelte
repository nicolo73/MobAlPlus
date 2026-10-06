<script lang="ts">
  // Page d'un emplacement : détail d'un emplacement mesuré, ou page de groupe pour un
  // emplacement parent (sans capteur propre, avec des sous-emplacements mesurés).
  import { api } from "../lib/api";
  import { flatten, placeTree } from "../lib/placetree";
  import type { Place, SeriesInfo } from "../lib/types";
  import Group from "./Group.svelte";
  import PlacePage from "./Place.svelte";

  let { placeId }: { placeId: number } = $props();

  let ctx = $state<{ places: Place[]; series: SeriesInfo[]; group: boolean } | null>(null);
  Promise.all([api.places(), api.seriesList()]).then(([places, series]) => {
    const n = flatten(placeTree(places, series)).find((x) => x.id === placeId);
    ctx = { places, series, group: !!n && n.children.length > 0 && n.measured.length > 0 && !n.series.length };
  }).catch(() => (ctx = { places: [], series: [], group: false }));
</script>

{#if ctx === null}
  <p class="muted">Chargement…</p>
{:else if ctx.group}
  <Group {placeId} places={ctx.places} series={ctx.series} />
{:else}
  <PlacePage {placeId} />
{/if}
