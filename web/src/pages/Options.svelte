<script lang="ts">
  import { api } from "../lib/api";
  import DisplayBar from "../components/DisplayBar.svelte";
  import { display, setDensity, setText, type Density, type TextSize } from "../lib/display.svelte";

  const TEXTS: { v: TextSize; label: string }[] = [
    { v: "normal", label: "Normal" }, { v: "small", label: "Petit" }, { v: "smaller", label: "Très petit" },
  ];
  const DENSITIES: { v: Density; label: string; help: string }[] = [
    { v: "comfort", label: "Confortable", help: "fiches larges, grands chiffres" },
    { v: "compact", label: "Compacte", help: "plus de fiches à la fois (2 colonnes sur téléphone)" },
  ];

  // Grandeurs connues de la maison, pour le choix des grandeurs affichées
  let properties = $state<{ code: string; name: string }[]>([]);
  api.seriesList().then((all) => {
    const m = new Map<string, string>();
    for (const s of all) m.set(s.property, s.property_name);
    const order = ["temperature", "humidity"];
    properties = [...m].map(([code, name]) => ({ code, name }))
      .sort((a, b) => (order.indexOf(a.code) + 9) % 9 - (order.indexOf(b.code) + 9) % 9);
  }).catch(() => {});
</script>

<div class="stack">
  <h1 style="margin:0">Options d'affichage</h1>
  <p class="muted" style="margin:0">Réglages mémorisés sur cet appareil (téléphone et ordinateur se règlent séparément).</p>

  <section class="card stack">
    <div class="opt">
      <h2>Taille du texte</h2>
      <div class="seg" role="group" aria-label="Taille du texte">
        {#each TEXTS as t (t.v)}
          <button class:active={display.text === t.v} aria-pressed={display.text === t.v} onclick={() => setText(t.v)}>{t.label}</button>
        {/each}
      </div>
    </div>
    <div class="opt">
      <h2>Présentation</h2>
      <div class="seg" role="group" aria-label="Présentation">
        {#each DENSITIES as d (d.v)}
          <button class:active={display.density === d.v} aria-pressed={display.density === d.v} onclick={() => setDensity(d.v)}
                  title={d.help}>{d.label}</button>
        {/each}
      </div>
      <small class="muted">{DENSITIES.find((d) => d.v === display.density)?.help}</small>
    </div>
    <div class="opt">
      <h2>Grandeurs et rendu des courbes</h2>
      <DisplayBar {properties} />
      <small class="muted">Les grandeurs masquées disparaissent de « Maintenant », des courbes et des pages des
        emplacements.</small>
    </div>
  </section>

  <section class="card">
    <h2>Aperçu</h2>
    <p style="margin:0">Le changement s'applique tout de suite : ouvrez « Maintenant » pour voir le résultat. Le zoom
      du téléphone (deux doigts) reste aussi possible sur toutes les pages.</p>
  </section>
</div>

<style>
  .opt { display: grid; gap: 0.4rem; justify-items: start; }
  .opt h2 { margin: 0; font-size: 1rem; }
  .seg { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; max-width: 100%; }
  .seg button { border: none; border-radius: 0; min-height: 2.25rem; padding: 0.35rem 0.8rem; color: var(--muted); white-space: nowrap; }
  .seg button + button { border-left: 1px solid var(--border); }
  .seg button.active { background: var(--primary-soft); color: var(--text); font-weight: 600; }
</style>
