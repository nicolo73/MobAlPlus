<script lang="ts">
  // Petite carte de situation (tuiles OpenStreetMap, sans bibliothèque) : la station au centre, et
  // le point de grille retenu par le modèle météo s'il est connu ; zoom par boutons, lien vers la
  // carte complète.

  interface Props {
    lat: number;
    lon: number;
    /** Point de grille du modèle (Open-Meteo), affiché s'il est dans le cadre */
    grid?: { lat: number; lon: number } | null;
    label: string;
    height?: number;
  }
  let { lat, lon, grid = null, label, height = 190 }: Props = $props();

  const TILE = 256;
  let zoom = $state(12);
  let width = $state(0);

  /** Position en pixels (au zoom courant) d'un point */
  function px(la: number, lo: number, z: number) {
    const n = 2 ** z * TILE;
    const r = (la * Math.PI) / 180;
    return { x: ((lo + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
  }

  const center = $derived(px(lat, lon, zoom));
  const tiles = $derived.by(() => {
    if (!width) return [];
    const left = center.x - width / 2, top = center.y - height / 2;
    const max = 2 ** zoom;
    const out: { key: string; src: string; x: number; y: number }[] = [];
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
      if (ty < 0 || ty >= max) continue;
      for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
        const wx = ((tx % max) + max) % max;
        out.push({ key: `${zoom}/${tx}/${ty}`, src: `https://tile.openstreetmap.org/${zoom}/${wx}/${ty}.png`,
                   x: tx * TILE - left, y: ty * TILE - top });
      }
    }
    return out;
  });
  /** Point de grille, en pixels dans le cadre (null s'il en sort ou se confond avec la station) */
  const gridAt = $derived.by(() => {
    if (!grid || !width) return null;
    const g = px(grid.lat, grid.lon, zoom);
    const x = g.x - center.x + width / 2, y = g.y - center.y + height / 2;
    if (x < 6 || y < 6 || x > width - 6 || y > height - 6) return null;
    return Math.hypot(x - width / 2, y - height / 2) < 6 ? null : { x, y };
  });
  const osm = $derived(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`);
</script>

<div class="map" style="height:{height}px" bind:clientWidth={width} role="img"
     aria-label="Carte : {label} ({lat.toFixed(4)}, {lon.toFixed(4)})">
  {#each tiles as t (t.key)}
    <img src={t.src} alt="" width={TILE} height={TILE} style="left:{t.x}px;top:{t.y}px" loading="lazy" draggable="false"
         onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")} />
  {/each}
  {#if gridAt}
    <span class="grid" style="left:{gridAt.x}px;top:{gridAt.y}px" title="Point de grille du modèle météo"></span>
  {/if}
  <svg class="pin" viewBox="0 0 24 32" width="24" height="32" aria-hidden="true">
    <path d="M12 31s10-11.2 10-19A10 10 0 0 0 2 12c0 7.8 10 19 10 19z" /><circle cx="12" cy="12" r="3.6" />
  </svg>
  <div class="zoom">
    <button onclick={() => (zoom = Math.min(16, zoom + 1))} disabled={zoom >= 16} aria-label="Zoomer">+</button>
    <button onclick={() => (zoom = Math.max(5, zoom - 1))} disabled={zoom <= 5} aria-label="Dézoomer">−</button>
  </div>
  <a class="credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>
  <a class="open" href={osm} target="_blank" rel="noopener" title="Ouvrir la carte complète">Agrandir ↗</a>
</div>

<style>
  .map { position: relative; overflow: hidden; border-radius: 8px; border: 1px solid var(--border); background: var(--bg, #ddd);
         user-select: none; }
  img { position: absolute; max-width: none; }
  @media (prefers-color-scheme: dark) { img { filter: brightness(0.75) contrast(1.1); } }
  .pin { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -100%); filter: drop-shadow(0 1px 1px rgba(0,0,0,.4)); }
  .pin path { fill: var(--primary); stroke: #fff; stroke-width: 1.5; }
  .pin circle { fill: #fff; }
  .grid { position: absolute; width: 10px; height: 10px; transform: translate(-50%, -50%); border: 2px solid #333;
          background: rgba(255,255,255,.7); }
  .zoom { position: absolute; top: 6px; left: 6px; display: flex; flex-direction: column; gap: 2px; }
  .zoom button { min-height: 0; width: 1.8rem; height: 1.8rem; padding: 0; font-size: 1.05rem; line-height: 1;
                 background: var(--surface); }
  .credit, .open { position: absolute; bottom: 0; font-size: 0.7rem; padding: 1px 5px; background: rgba(255,255,255,.8);
                   color: #333; text-decoration: none; }
  .credit { right: 0; }
  .open { left: 0; }
</style>
