<script lang="ts">
  // Choix d'une couleur : palette de l'application (adaptée au thème clair / sombre), couleurs
  // supplémentaires (gris, marron…), couleur personnalisée, ou automatique.
  import { EXTRA_COLORS, MAX_SERIES, slotColor, type ColorChoice } from "../lib/colors";

  interface Props {
    value: ColorChoice;
    dark: boolean;
    onchange: (c: ColorChoice) => void;
    disabled?: boolean;
    label?: string;
  }
  let { value, dark, onchange, disabled = false, label = "Couleur dans les courbes" }: Props = $props();
  const NAMES = ["bleu", "orange", "vert", "jaune", "rose", "vert foncé", "violet", "rouge"];
  const isCustom = $derived(typeof value === "string" && !EXTRA_COLORS.some((c) => c.hex === value));
  let input: HTMLInputElement;
</script>

<div class="picker" role="radiogroup" aria-label={label}>
  <button type="button" class="auto" class:on={value === null} role="radio" aria-checked={value === null} {disabled}
          title="Automatique : couleur attribuée selon l'ordre de sélection" onclick={() => onchange(null)}>auto</button>
  {#each Array.from({ length: MAX_SERIES }, (_, i) => i) as i (i)}
    <button type="button" class="swatch" class:on={value === i} role="radio" aria-checked={value === i} {disabled}
            style="--c:{slotColor(i, dark)}" title={NAMES[i]} aria-label={NAMES[i]} onclick={() => onchange(i)}></button>
  {/each}
  <span class="sep" aria-hidden="true"></span>
  {#each EXTRA_COLORS as c (c.hex)}
    <button type="button" class="swatch" class:on={value === c.hex} role="radio" aria-checked={value === c.hex} {disabled}
            style="--c:{c.hex}" title={c.name} aria-label={c.name} onclick={() => onchange(c.hex)}></button>
  {/each}
  <button type="button" class="auto custom" class:on={isCustom} role="radio" aria-checked={isCustom} {disabled}
          title="Choisir n'importe quelle couleur" onclick={() => input.click()}>
    {#if isCustom}<span class="mini" style="--c:{value}"></span>{/if}Personnalisée…
  </button>
  <input bind:this={input} type="color" class="native" tabindex="-1" aria-hidden="true"
         value={typeof value === "string" ? value : "#7a7f85"}
         onchange={(e) => onchange((e.currentTarget as HTMLInputElement).value.toLowerCase())} />
</div>

<style>
  .picker { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; position: relative; }
  button { min-height: 0; padding: 0; }
  .swatch { width: 1.75rem; height: 1.75rem; border-radius: 50%; background: var(--c); border: 2px solid var(--surface);
            box-shadow: 0 0 0 1px var(--border); }
  .swatch.on { box-shadow: 0 0 0 2px var(--text); }
  .auto { height: 1.75rem; padding: 0 0.6rem; border-radius: 999px; font-size: 0.8rem; color: var(--muted); gap: 0.3rem; }
  .auto.on { color: var(--text); border-color: var(--text); font-weight: 600; }
  .mini { width: 0.8rem; height: 0.8rem; border-radius: 50%; background: var(--c); }
  .sep { width: 1px; height: 1.4rem; background: var(--border); margin: 0 0.15rem; }
  /* Sélecteur natif du système, ouvert par le bouton « Personnalisée… » */
  .native { position: absolute; left: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: 0; padding: 0; }
</style>
