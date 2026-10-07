<script lang="ts">
  // Seuils d'alerte d'une série, sur deux niveaux : au-dessus / en dessous, pic / creux passé,
  // capteur muet, comparaison avec un autre emplacement (même grandeur), montée / baisse rapide.
  import { api } from "../lib/api";
  import { display } from "../lib/display.svelte";
  import type { AlertKind, AlertLevel, AlertRule, SeriesInfo } from "../lib/types";

  let listing: Promise<SeriesInfo[]> | null = null;
  async function candidatesOf(s: SeriesInfo): Promise<SeriesInfo[]> {
    listing ??= api.seriesList().catch(() => { listing = null; return []; });
    return (await listing).filter((x) => x.property === s.property && x.place_id !== s.place_id)
      .sort((a, b) => a.place_name.localeCompare(b.place_name, "fr"));
  }

  interface Props {
    series: SeriesInfo;
    rules: AlertRule[];
    editable: boolean;
    onsaved: () => void;
  }
  let { series, rules, editable, onsaved }: Props = $props();

  const LEVELS: { v: AlertLevel; label: string }[] = [{ v: "info", label: "Info" }, { v: "warning", label: "Importante" }];
  interface Row { kind: AlertKind; label: string; value: boolean; unit?: string; ref?: boolean; help?: string }
  const ROWS: Row[] = [
    { kind: "above", label: "Au-dessus de", value: true },
    { kind: "below", label: "En dessous de", value: true },
    { kind: "peak", label: "Pic passé", value: false },
    { kind: "trough", label: "Creux passé", value: false },
    { kind: "silent", label: "Muet depuis plus de", value: true, unit: "h" },
    { kind: "gap_above", label: "Plus haut que", value: true, ref: true, help: "de plus de" },
    { kind: "gap_below", label: "Plus bas que", value: true, ref: true, help: "de plus de" },
    { kind: "rise", label: "Monte de plus de", value: true, unit: "/h", help: "sur la dernière heure" },
    { kind: "fall", label: "Baisse de plus de", value: true, unit: "/h", help: "sur la dernière heure" },
  ];
  const key = (k: AlertKind, l: AlertLevel) => `${k}:${l}`;
  const refKey = (k: AlertKind) => `${k}:ref`;

  /** Séries comparables : même grandeur, autre emplacement (chargées une fois pour toutes les courbes) */
  let candidates = $state<SeriesInfo[]>([]);
  $effect(() => { candidatesOf(series).then((c) => (candidates = c)); });
  const rows = $derived(ROWS.filter((r) => !r.ref || candidates.length));

  /** Brouillon : seuil (texte), case cochée (pic / creux), emplacement de référence (comparaison) */
  let draft = $state<Record<string, string | boolean>>({});
  let saving = $state(false);
  let error = $state("");
  let saved = $state(false);
  function reset() {
    const d: Record<string, string | boolean> = {};
    for (const r of ROWS) for (const l of LEVELS) {
      const rule = rules.find((x) => x.kind === r.kind && x.level === l.v && x.enabled);
      d[key(r.kind, l.v)] = r.value ? (rule?.threshold != null ? String(rule.threshold).replace(".", ",") : "") : !!rule;
      if (r.ref && rule?.ref_series_id) d[refKey(r.kind)] = String(rule.ref_series_id);
    }
    for (const r of ROWS) if (r.ref) d[refKey(r.kind)] ??= "";
    draft = d;
  }
  $effect(() => { void rules; reset(); });

  const num = (s: string | boolean) => (typeof s === "string" && s.trim() !== "" ? Number(s.replace(",", ".")) : null);
  const invalid = $derived(ROWS.filter((r) => r.value).some((r) => LEVELS.some((l) => {
    const v = draft[key(r.kind, l.v)];
    return typeof v === "string" && v.trim() !== "" && !Number.isFinite(num(v));
  })));
  /** Comparaison avec un seuil mais sans emplacement choisi */
  const missingRef = $derived(ROWS.filter((r) => r.ref).some((r) =>
    !draft[refKey(r.kind)] && LEVELS.some((l) => num(draft[key(r.kind, l.v)]) != null)));
  const warning = $derived.by(() => {
    const ia = num(draft["above:info"]), wa = num(draft["above:warning"]);
    const ib = num(draft["below:info"]), wb = num(draft["below:warning"]);
    if (ia != null && wa != null && wa < ia) return "Le seuil haut « important » est d'ordinaire plus élevé que le seuil « info ».";
    if (ib != null && wb != null && wb > ib) return "Le seuil bas « important » est d'ordinaire plus bas que le seuil « info ».";
    const sh = [num(draft["silent:info"]), num(draft["silent:warning"])].filter((x): x is number => x != null);
    if (sh.some((h) => h <= 0)) return "La durée de silence doit être positive (en heures).";
    const rates = ["rise", "fall"].flatMap((k) => LEVELS.map((l) => num(draft[`${k}:${l.v}`]))).filter((x): x is number => x != null);
    if (rates.some((x) => x <= 0)) return "La vitesse de montée ou de baisse doit être positive (par heure).";
    if (missingRef) return "Choisir l'emplacement de comparaison.";
    return "";
  });
  const count = $derived(rules.filter((r) => r.enabled).length);

  async function save() {
    const out: Omit<AlertRule, "series_id">[] = [];
    for (const r of ROWS) for (const l of LEVELS) {
      const v = draft[key(r.kind, l.v)];
      if (r.value) {
        const n = num(v);
        if (n != null) out.push({ kind: r.kind, level: l.v, threshold: n, enabled: true,
                                  ...(r.ref ? { ref_series_id: Number(draft[refKey(r.kind)]) } : {}) });
      } else if (v === true) {
        // Montée minimale : celle des flèches de tendance (Options), pour rester cohérent
        out.push({ kind: r.kind, level: l.v, threshold: display.trend.reversal[series.property] ?? null, enabled: true });
      }
    }
    saving = true;
    error = "";
    try {
      await api.saveAlertRules(series.id, out);
      saved = true;
      setTimeout(() => (saved = false), 2500);
      onsaved();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

<details class="rules" open={count > 0}>
  <summary>
    <strong>Alertes</strong>
    <span class="muted">{count ? `${count} règle${count > 1 ? "s" : ""}` : "aucune"}</span>
  </summary>
  <table>
    <thead><tr><th></th>{#each LEVELS as l (l.v)}<th class="lvl {l.v}">{l.label}</th>{/each}</tr></thead>
    <tbody>
      {#each rows as r (r.kind)}
        <tr class:sep={r.kind === "gap_above" || (r.kind === "rise" && !candidates.length)}>
          <th scope="row">
            {r.label}
            {#if r.ref}
              <select disabled={!editable} aria-label="{r.label} : emplacement" value={draft[refKey(r.kind)] as string}
                      onchange={(e) => (draft[refKey(r.kind)] = (e.currentTarget as HTMLSelectElement).value)}>
                <option value="">— choisir —</option>
                {#each candidates as c (c.id)}<option value={String(c.id)}>{c.place_name}</option>{/each}
              </select>
            {/if}
            {#if r.help}<small class="muted">{r.help}</small>{/if}
          </th>
          {#each LEVELS as l (l.v)}
            <td>
              {#if r.value}
                <span class="field">
                  <input inputmode="decimal" disabled={!editable} aria-label="{r.label} ({l.label})" placeholder="—"
                         value={draft[key(r.kind, l.v)] as string}
                         oninput={(e) => (draft[key(r.kind, l.v)] = (e.currentTarget as HTMLInputElement).value)} />
                  {r.unit === "/h" ? `${series.unit}/h` : r.unit ?? series.unit}
                </span>
              {:else}
                <input type="checkbox" disabled={!editable} aria-label="{r.label} ({l.label})"
                       checked={draft[key(r.kind, l.v)] === true}
                       onchange={(e) => (draft[key(r.kind, l.v)] = (e.currentTarget as HTMLInputElement).checked)} />
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
  {#if warning}<small class="warn-text">{warning}</small>{/if}
  {#if error}<div class="notice err">{error}</div>{/if}
  {#if editable}
    <div class="row">
      <button class="primary" disabled={saving || invalid || missingRef} onclick={save}>{saving ? "…" : "Enregistrer les alertes"}</button>
      {#if saved}<span class="muted">Enregistré ✓</span>{/if}
    </div>
    <small class="muted">Vide : pas d'alerte. Pic / creux : même sensibilité que les flèches de tendance (Options).
      Capteur muet : un réglage sur une seule courbe suffit (température et humidité viennent du même capteur).
      Plus haut / plus bas que : comparaison avec un autre emplacement (« plus chaud dehors que dedans » :
      Extérieur plus haut que Salon de plus de 0 °C). Monte / baisse : variation sur la dernière heure.
      Les alertes sont vérifiées toutes les 10 minutes.</small>
  {:else}
    <small class="muted">Réglage réservé aux comptes « gestion » de la maison.</small>
  {/if}
</details>

<style>
  .rules { margin-top: 0.75rem; border-top: 1px solid var(--border); padding-top: 0.6rem; }
  summary { cursor: pointer; display: flex; gap: 0.6rem; align-items: baseline; list-style: none; }
  summary::before { content: "▸"; color: var(--muted); }
  .rules[open] summary::before { content: "▾"; }
  table { margin: 0.5rem 0; width: auto; max-width: 100%; }
  th, td { padding: 0.25rem 0.3rem; border: none; vertical-align: middle; }
  th:first-child { padding-left: 0; }
  th[scope="row"] { font-weight: 500; font-size: 0.85rem; text-transform: none; letter-spacing: 0; }
  th[scope="row"] select { display: block; margin-top: 0.2rem; min-height: 2rem; padding: 0.2rem 0.35rem; font-size: 0.85rem; width: 100%; max-width: 9rem; }
  th[scope="row"] { max-width: 9rem; }
  th[scope="row"] small { display: block; font-weight: 400; font-size: 0.75rem; }
  tr.sep > * { border-top: 1px solid var(--border); padding-top: 0.45rem; }
  .lvl { font-size: 0.8rem; }
  .lvl.info { color: var(--hum); }
  .lvl.warning { color: var(--err); }
  .field { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.85rem; color: var(--muted); }
  .field input { width: 3.2rem; min-height: 2rem; padding: 0.2rem 0.35rem; }
  .warn-text { color: var(--warn); display: block; margin-bottom: 0.4rem; }
  .row { margin: 0.4rem 0; }
</style>
