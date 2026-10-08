<script lang="ts">
  // Flèche de tendance : inclinée selon la pente ; « cassée » (pic ou creux) en cas d'inversion.
  // Ton (seuils d'alerte de la série) : rouge ou bleu foncé en gras si la tendance aggrave la
  // situation, vert si un pic ou un creux ramène vers des valeurs normales.
  import { fmtValue } from "../lib/format";
  import type { Trend } from "../lib/trend";
  import type { Tone } from "../lib/zones";

  let { trend, unit, detail = false, tone = null }: { trend: Trend; unit: string; detail?: boolean; tone?: Tone | null } = $props();

  // Une décimale de plus pour les pentes faibles (0,05 °C/h plutôt que 0,0)
  const decimals = $derived((unit === "%" ? 0 : 1) + (Math.abs(trend.slope) > 0 && Math.abs(trend.slope) < (unit === "%" ? 1 : 0.1) ? 1 : 0));
  const slopeText = $derived(`${trend.slope > 0 ? "+" : trend.slope < 0 ? "−" : "±"}${Math.abs(trend.slope)
    .toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${unit}/h`);
  const at = (ts: number) => new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const words = ["stable", "légère", "nette", "forte"];
  const title = $derived((trend.reversal
    ? `Inversion : ${trend.reversal.kind === "peak" ? "maximum" : "minimum"} de ${fmtValue(trend.reversal.value, unit)} à ${at(trend.reversal.ts)}, ${trend.reversal.kind === "peak" ? "en baisse" : "en hausse"} depuis (${slopeText})`
    : trend.level === 0 ? `Stable (${slopeText})`
    : `${trend.level > 0 ? "Hausse" : "Baisse"} ${words[Math.abs(trend.level)]} (${slopeText})`)
    + (tone === "worse-hot" ? " – vers ou au-delà du seuil haut" : tone === "worse-cold" ? " – vers ou en deçà du seuil bas"
       : tone === "better" ? " – retour vers des valeurs normales" : ""));
</script>

<span class="trend {tone ?? ''}" class:rev={trend.reversal} class:flat={!trend.reversal && trend.level === 0 && !tone} {title}
      role="img" aria-label={title}>
  {#if trend.reversal}
    <!-- Flèche « cassée » : montée puis descente (pic) ou l'inverse (creux) -->
    <svg viewBox="0 0 24 24" width="1.4em" height="1.2em" aria-hidden="true">
      {#if trend.reversal.kind === "peak"}
        <path d="M2 19L12 5L22 19" /><path d="M16 17.1L22 19L22.2 12.7" />
      {:else}
        <path d="M2 5L12 19L22 5" /><path d="M16 6.9L22 5L22.2 11.3" />
      {/if}
    </svg>
  {:else}
  <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" aria-hidden="true">
      <g transform="rotate({-trend.level * 25} 12 12)"><path d="M4 12h15M13 6l6 6-6 6" /></g>
  </svg>
  {/if}
  {#if detail}<small>{trend.reversal ? (trend.reversal.kind === "peak" ? "pic passé" : "creux passé") : slopeText}</small>{/if}
</span>

<style>
  .trend { display: inline-flex; align-items: center; gap: 0.2rem; color: var(--muted); vertical-align: middle; }
  .trend svg { fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; flex: none; }
  .trend.flat { opacity: 0.6; }
  .trend.rev { color: var(--warn); }
  .trend.rev svg { stroke-width: 2.6; }
  .trend.rev small { font-weight: 700; }
  small { font-size: 0.75rem; white-space: nowrap; }
  .trend.worse-hot { color: var(--z-hot2); }
  .trend.worse-cold { color: var(--z-cold2); }
  .trend.better { color: var(--ok); }
  .trend:is(.worse-hot, .worse-cold, .better) svg { stroke-width: 3.2; }
  .trend:is(.worse-hot, .worse-cold, .better) small { font-weight: 700; }
</style>
