<script lang="ts">
  // Page d'un emplacement : détail d'un emplacement mesuré, ou page de groupe pour un emplacement
  // parent (avec des sous-emplacements mesurés). Un parent qui a aussi son propre capteur affiche la
  // page de groupe ; « ?seul » ouvre le détail de son capteur propre.
  import { api } from "../lib/api";
  import { router } from "../lib/router.svelte";
  import { flatten, placeTree } from "../lib/placetree";
  import type { Place, SeriesInfo } from "../lib/types";
  import Group from "./Group.svelte";
  import PlacePage from "./Place.svelte";

  let { placeId }: { placeId: number } = $props();

  let ctx = $state<{ places: Place[]; series: SeriesInfo[]; group: boolean } | null>(null);
  Promise.all([api.places(), api.seriesList()]).then(([places, series]) => {
    const n = flatten(placeTree(places, series)).find((x) => x.id === placeId);
    const parent = !!n && n.children.length > 0 && n.measured.some((id) => id !== n.id);
    ctx = { places, series, group: parent && !router.query.has("seul") };
  }).catch(() => (ctx = { places: [], series: [], group: false }));
</script>

{#if ctx === null}
  <p class="muted">Chargement…</p>
{:else if ctx.group}
  <Group {placeId} places={ctx.places} series={ctx.series} />
{:else}
  <PlacePage {placeId} />
{/if}
