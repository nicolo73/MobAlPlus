<script lang="ts">
  import { api } from "../lib/api";
  import DisplayBar from "../components/DisplayBar.svelte";
  import TrendArrow from "../components/TrendArrow.svelte";
  import { currentSubscription, needsInstall, pushConfigured, pushSupported, savedLevel, subscribe, unsubscribe } from "../lib/push";
  import type { AlertLevel } from "../lib/types";
  import { onMount } from "svelte";
  import { ctx } from "../lib/home.svelte";
  import { router } from "../lib/router.svelte";
  import { nowHidden, setNowHidden } from "../lib/display.svelte";
  import { flatten, placeTree, type PlaceNode } from "../lib/placetree";

  // Page Maintenant : fiches affichées (emplacements mesurés, groupes, météo), propre à la maison
  let nowNodes = $state<PlaceNode[]>([]);
  Promise.all([api.places(), api.seriesList()]).then(([pl, se]) => {
    nowNodes = flatten(placeTree(pl, se)).filter((n) => n.measured.length > 0);
  }).catch(() => {});
  const hiddenAncestor = (n: PlaceNode): boolean => nowNodes.some((p) => p.children.some((c) => c.id === n.id) && (nowHidden(ctx.homeId, p.id) || hiddenAncestor(p)));
  onMount(() => {
    const section = router.query.get("section");
    if (section) setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: "smooth" }), 300);
  });

  // Notifications des alertes sur cet appareil
  let pushOn = $state(false);
  let pushLevel = $state<AlertLevel>(savedLevel());
  let pushBusy = $state(false);
  let pushError = $state("");
  currentSubscription().then((s) => (pushOn = !!s)).catch(() => {});
  async function setPush(on: boolean, level = pushLevel) {
    pushBusy = true;
    pushError = "";
    try {
      if (on) await subscribe(level); else await unsubscribe();
      pushOn = on;
      pushLevel = level;
    } catch (e) {
      pushError = e instanceof Error ? e.message : String(e);
    } finally {
      pushBusy = false;
    }
  }
  import { display, resetTrend, setDensity, setText, setTrend, setValueStyle, type Density, type TextSize, type ValueStyle } from "../lib/display.svelte";

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
  const VALUE_STYLES: { v: ValueStyle; label: string; help: string }[] = [
    { v: "bg", label: "Fond", help: "fond coloré selon les seuils d'alerte haut / bas de l'emplacement" },
    { v: "text", label: "Texte", help: "chiffres colorés selon les seuils d'alerte haut / bas" },
    { v: "property", label: "Par grandeur", help: "température en orange, humidité en bleu (sans tenir compte des seuils)" },
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
      <h2>Couleur des valeurs</h2>
      <div class="seg" role="group" aria-label="Couleur des valeurs">
        {#each VALUE_STYLES as v (v.v)}
          <button class:active={display.values === v.v} aria-pressed={display.values === v.v} onclick={() => setValueStyle(v.v)}
                  title={v.help}>{v.label}</button>
        {/each}
      </div>
      <small class="muted">{VALUE_STYLES.find((v) => v.v === display.values)?.help}.
        {#if display.values !== "property"}
          <span class="legend-z">
            <span class="zv hot2">au-delà important</span> <span class="zv hot1">au-delà info</span>
            <span class="zv cold1">sous info</span> <span class="zv cold2">sous important</span>
          </span>
          Flèche en gras rouge ou bleu foncé : la tendance aggrave la situation ; verte : un pic ou un
          creux ramène vers la normale.
        {/if}</small>
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

  <section class="card stack" id="maintenant">
    <h2 style="margin:0">Page Maintenant</h2>
    <p class="muted" style="margin:0">Fiches affichées sur cet appareil, pour la maison « {ctx.homes.find((h) => h.id === ctx.homeId)?.name} ».
      Décocher un emplacement parent masque tout son groupe.</p>
    <ul class="now-list">
      {#each nowNodes as n (n.id)}
        <li style="padding-left:{n.depth * 1.25}rem">
          <label class:off={hiddenAncestor(n)}>
            <input type="checkbox" disabled={hiddenAncestor(n)} checked={!nowHidden(ctx.homeId, n.id)}
                   onchange={(e) => setNowHidden(ctx.homeId, n.id, !(e.currentTarget as HTMLInputElement).checked)} />
            {n.name}{#if n.children.length}<small class="muted"> · groupe</small>{/if}
          </label>
        </li>
      {/each}
    </ul>
  </section>

  <section class="card stack">
    <h2 style="margin:0">Notifications des alertes sur cet appareil</h2>
    {#if !pushConfigured()}
      <p class="muted" style="margin:0">Pas encore activées pour cette installation : voir « Notifications » dans
        docs/supabase-setup.md (clés à créer une fois). Les alertes restent visibles dans l'application (🔔).</p>
    {:else if !pushSupported()}
      <p class="muted" style="margin:0">Ce navigateur ne permet pas les notifications.</p>
    {:else if needsInstall()}
      <p class="muted" style="margin:0">Sur iPhone, installer d'abord l'application (Partager › Sur l'écran d'accueil),
        puis l'ouvrir depuis son icône pour activer les notifications.</p>
    {:else}
      <div class="opt">
        <div class="seg" role="group" aria-label="Notifications">
          <button class:active={!pushOn} aria-pressed={!pushOn} disabled={pushBusy} onclick={() => setPush(false)}>Désactivées</button>
          <button class:active={pushOn && pushLevel === "warning"} aria-pressed={pushOn && pushLevel === "warning"} disabled={pushBusy}
                  onclick={() => setPush(true, "warning")}>Importantes</button>
          <button class:active={pushOn && pushLevel === "info"} aria-pressed={pushOn && pushLevel === "info"} disabled={pushBusy}
                  onclick={() => setPush(true, "info")}>Toutes</button>
        </div>
        <small class="muted">Une notification par alerte nouvelle (vérification toutes les 10 minutes), même
          application fermée. Réglage propre à cet appareil.</small>
        {#if pushError}<div class="notice err">{pushError}</div>{/if}
      </div>
    {/if}
  </section>

  <section class="card">
    <h2>Aperçu</h2>
    <p style="margin:0">Le changement s'applique tout de suite : ouvrez « Maintenant » pour voir le résultat. Le zoom
      du téléphone (deux doigts) reste aussi possible sur toutes les pages.</p>
  </section>
</div>

<style>
  .legend-z { display: inline-flex; flex-wrap: wrap; gap: 0.3rem 0.5rem; margin: 0.25rem 0; font-weight: 600; }
  .now-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.15rem; }
  .now-list label { display: inline-flex; align-items: center; gap: 0.5rem; min-height: 2rem; }
  .now-list input { min-height: 0; width: 1.1rem; height: 1.1rem; }
  .now-list .off { opacity: 0.5; }
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
