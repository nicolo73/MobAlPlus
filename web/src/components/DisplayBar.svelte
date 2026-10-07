<script lang="ts">
  import { display, setCurve, setWeather, toggleProp, visibleProps } from "../lib/display.svelte";
  import { homeWeather } from "../lib/weather-state.svelte";

  /** Grandeurs présentes sur la page, dans l'ordre d'affichage */
  interface Props {
    properties: { code: string; name: string }[];
    /** Choix du rendu des courbes (absent sur la page « Maintenant ») */
    curves?: boolean;
    /** Version discrète, plus petite */
    small?: boolean;
    /** Bouton « Météo » (si la position de la maison est connue) */
    weatherToggle?: boolean;
  }
  let { properties, curves = true, small = false, weatherToggle = true }: Props = $props();

  const codes = $derived(properties.map((p) => p.code));
  const visible = $derived(visibleProps(codes));
  const CURVES = [
    { mode: "step", label: "Escalier", help: "Rendu fidèle : chaque valeur reste constante jusqu'à la mesure suivante" },
    { mode: "smooth", label: "Lissé", help: "Courbe adoucie passant par toutes les mesures" },
    { mode: "simple", label: "Simplifié", help: "Un point au milieu de chaque palier de valeurs identiques : supprime les marches dues à l'arrondi du capteur" },
  ] as const;
</script>

<div class="display" class:small>
  {#if properties.length > 1}
    <div class="seg" role="group" aria-label="Grandeurs affichées">
      {#each properties as p (p.code)}
        {@const on = visible.includes(p.code)}
        <button class:active={on} aria-pressed={on} onclick={() => toggleProp(p.code, codes)}
                title={on && visible.length === 1 ? "Au moins une grandeur reste affichée" : on ? `Masquer : ${p.name}` : `Afficher : ${p.name}`}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            {#if on}<path d="M5 12l5 5 9-10" />{:else}<path d="M7 7l10 10M17 7L7 17" />{/if}
          </svg>
          {p.name}
        </button>
      {/each}
    </div>
  {/if}
  {#if weatherToggle && homeWeather.loc}
    <div class="seg" role="group" aria-label="Météo publique">
      <button class:active={display.weather} aria-pressed={display.weather} onclick={() => setWeather(!display.weather)}
              title="Température et humidité extérieures publiques (Open-Meteo) à {homeWeather.loc.label ?? 'la position de la maison'}">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18z" /></svg>
        Météo
      </button>
    </div>
  {/if}
  {#if curves}
  <div class="seg" role="group" aria-label="Rendu des courbes">
    {#each CURVES as c (c.mode)}
      <button class:active={display.curve === c.mode} aria-pressed={display.curve === c.mode}
              onclick={() => setCurve(c.mode)} title="{c.help} (affichage seulement, les données ne changent pas)">{c.label}</button>
    {/each}
  </div>
  {/if}
</div>

<style>
  .display { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center; }
  .seg { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; max-width: 100%; }
  .seg button { border: none; border-radius: 0; min-height: 2.1rem; padding: 0.3rem 0.7rem; font-size: 0.9rem;
                white-space: nowrap; color: var(--muted); gap: 0.3rem; }
  .seg button + button { border-left: 1px solid var(--border); }
  .seg button.active { background: var(--primary-soft); color: var(--text); font-weight: 600; }
  .small .seg button { min-height: 1.8rem; padding: 0.15rem 0.55rem; font-size: 0.8rem; }
  svg { fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
</style>
