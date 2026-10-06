<script lang="ts">
  // Choix d'une couleur dans la palette validée (lisible en clair et en sombre), ou automatique
  import { MAX_SERIES, slotColor } from "../lib/colors";

  interface Props {
    value: number | null;
    dark: boolean;
    onchange: (slot: number | null) => void;
    disabled?: boolean;
    label?: string;
  }
  let { value, dark, onchange, disabled = false, label = "Couleur dans les courbes" }: Props = $props();
  const NAMES = ["bleu", "orange", "vert", "jaune", "rose", "vert foncé", "violet", "rouge"];
</script>

<div class="picker" role="radiogroup" aria-label={label}>
  <button type="button" class="auto" class:on={value === null} role="radio" aria-checked={value === null} {disabled}
          title="Automatique : couleur attribuée selon l'ordre de sélection" onclick={() => onchange(null)}>auto</button>
  {#each Array.from({ length: MAX_SERIES }, (_, i) => i) as i (i)}
    <button type="button" class="swatch" class:on={value === i} role="radio" aria-checked={value === i} {disabled}
            style="--c:{slotColor(i, dark)}" title={NAMES[i]} aria-label={NAMES[i]} onclick={() => onchange(i)}></button>
  {/each}
</div>

<style>
  .picker { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; }
  button { min-height: 0; padding: 0; }
  .swatch { width: 1.75rem; height: 1.75rem; border-radius: 50%; background: var(--c); border: 2px solid var(--surface);
            box-shadow: 0 0 0 1px var(--border); }
  .swatch.on { box-shadow: 0 0 0 2px var(--text); }
  .auto { height: 1.75rem; padding: 0 0.6rem; border-radius: 999px; font-size: 0.8rem; color: var(--muted); }
  .auto.on { color: var(--text); border-color: var(--text); font-weight: 600; }
</style>
