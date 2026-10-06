<script lang="ts">
  import { api } from "../lib/api";
  import DisplayBar from "../components/DisplayBar.svelte";
  import TrendArrow from "../components/TrendArrow.svelte";
  import { display, resetTrend, setDensity, setText, setTrend, type Density, type TextSize } from "../lib/display.svelte";

  const WINDOWS = [{ v: 30, label: "30 min" }, { v: 60, label: "1 h" }, { v: 120, label: "2 h" }];
  const SENSITIVITIES = [{ v: 1.6, label: "Faible" }, { v: 1, label: "Normale" }, { v: 0.6, label: "Forte" }];
  const HOLDS = [{ v: 60, label: "1 h" }, { v: 120, label: "2 h" }, { v: 180, label: "3 h" }];
  const EXAMPLES = [
    { level: 3, label: "forte hausse" }, { level: 1, label: "légère hausse" }, { level: 0, label: "stable" },
    { level: -2, label: "nette baisse" },
  ];
  const now = Date.now();
  function setReversal(prop: string, e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value.replace(",", "."));
    if (v > 0) setTrend({ reversal: { ...display.trend.reversal, [prop]: v } });
  }

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
  <p class="muted" style="margin:0">Réglages mémorisés sur cet appareil (téléphone et ordinateur se règlent séparément).
    Mode d'emploi : <a href="#/aide">guide d'utilisation</a>.</p>

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

  <section class="card stack">
    <h2 style="margin:0">Flèches de tendance</h2>
    <div class="legend">
      {#each EXAMPLES as ex (ex.level)}
        <span><TrendArrow trend={{ level: ex.level, slope: ex.level / 2 }} unit="°C" /> {ex.label}</span>
      {/each}
      <span><TrendArrow trend={{ level: -2, slope: -0.5, reversal: { kind: "peak", ts: now, value: 24 } }} unit="°C" /> pic passé</span>
      <span><TrendArrow trend={{ level: 2, slope: 0.5, reversal: { kind: "trough", ts: now, value: 12 } }} unit="°C" /> creux passé</span>
    </div>
    <p class="muted" style="margin:0">La pente est calculée sur la dernière période ci-dessous et comparée à l'écart du
      jour (minimum – maximum des dernières 24 h) : une même hausse compte plus un jour calme. Une inversion est
      signalée quand la valeur a monté d'au moins le seuil puis a commencé à baisser (ou l'inverse).</p>
    <div class="opt">
      <h3>Période de calcul de la pente</h3>
      <div class="seg" role="group" aria-label="Période de calcul">
        {#each WINDOWS as w (w.v)}
          <button class:active={display.trend.windowMin === w.v} aria-pressed={display.trend.windowMin === w.v}
                  onclick={() => setTrend({ windowMin: w.v })}>{w.label}</button>
        {/each}
      </div>
    </div>
    <div class="opt">
      <h3>Sensibilité des flèches</h3>
      <div class="seg" role="group" aria-label="Sensibilité des flèches">
        {#each SENSITIVITIES as v (v.v)}
          <button class:active={display.trend.sensitivity === v.v} aria-pressed={display.trend.sensitivity === v.v}
                  onclick={() => setTrend({ sensitivity: v.v })}>{v.label}</button>
        {/each}
      </div>
      <small class="muted">Forte : les flèches s'inclinent dès une petite variation.</small>
    </div>
    <div class="opt">
      <h3>Inversion de tendance (pic ou creux)</h3>
      <div class="row">
        <label class="num-field">Température
          <span><input type="number" min="0.1" step="0.1" value={display.trend.reversal.temperature}
                       onchange={(e) => setReversal("temperature", e)} /> °C</span></label>
        <label class="num-field">Humidité
          <span><input type="number" min="1" step="1" value={display.trend.reversal.humidity}
                       onchange={(e) => setReversal("humidity", e)} /> %</span></label>
      </div>
      <small class="muted">Montée minimale avant le pic ; après le pic, une baisse de la moitié suffit (au moins
        2 pas de mesure : 0,2 °C, 2 %).</small>
    </div>
    <div class="opt">
      <h3>Inversion signalée pendant</h3>
      <div class="seg" role="group" aria-label="Durée de signalement">
        {#each HOLDS as h (h.v)}
          <button class:active={display.trend.holdMin === h.v} aria-pressed={display.trend.holdMin === h.v}
                  onclick={() => setTrend({ holdMin: h.v })}>{h.label}</button>
        {/each}
      </div>
    </div>
    <div><button onclick={resetTrend}>Valeurs par défaut</button></div>
  </section>

  <section class="card">
    <h2>Aperçu</h2>
    <p style="margin:0">Le changement s'applique tout de suite : ouvrez « Maintenant » pour voir le résultat. Le zoom
      du téléphone (deux doigts) reste aussi possible sur toutes les pages.</p>
  </section>
</div>

<style>
  .opt { display: grid; gap: 0.4rem; justify-items: start; }
  .opt h2, .opt h3 { margin: 0; font-size: 1rem; }
  .legend { display: flex; flex-wrap: wrap; gap: 0.4rem 1.2rem; font-size: 0.9rem; }
  .num-field { display: grid; gap: 0.2rem; font-size: 0.9rem; }
  .num-field input { width: 5.5rem; }
  .seg { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; max-width: 100%; }
  .seg button { border: none; border-radius: 0; min-height: 2.25rem; padding: 0.35rem 0.8rem; color: var(--muted); white-space: nowrap; }
  .seg button + button { border-left: 1px solid var(--border); }
  .seg button.active { background: var(--primary-soft); color: var(--text); font-weight: 600; }
</style>
