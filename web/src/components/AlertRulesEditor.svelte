<script lang="ts">
  // Seuils d'alerte d'une série : au-dessus / en dessous, pic / creux passé, sur deux niveaux.
  import { api } from "../lib/api";
  import { display } from "../lib/display.svelte";
  import type { AlertKind, AlertLevel, AlertRule, SeriesInfo } from "../lib/types";

  interface Props {
    series: SeriesInfo;
    rules: AlertRule[];
    editable: boolean;
    onsaved: () => void;
  }
  let { series, rules, editable, onsaved }: Props = $props();

  const LEVELS: { v: AlertLevel; label: string }[] = [{ v: "info", label: "Info" }, { v: "warning", label: "Importante" }];
  const ROWS: { kind: AlertKind; label: string; value: boolean }[] = [
    { kind: "above", label: "Au-dessus de", value: true },
    { kind: "below", label: "En dessous de", value: true },
    { kind: "peak", label: "Pic passé", value: false },
    { kind: "trough", label: "Creux passé", value: false },
  ];
  const key = (k: AlertKind, l: AlertLevel) => `${k}:${l}`;

  /** Brouillon : seuil (texte) pour above / below, case cochée pour peak / trough */
  let draft = $state<Record<string, string | boolean>>({});
  let saving = $state(false);
  let error = $state("");
  let saved = $state(false);
  function reset() {
    const d: Record<string, string | boolean> = {};
    for (const r of ROWS) for (const l of LEVELS) {
      const rule = rules.find((x) => x.kind === r.kind && x.level === l.v && x.enabled);
      d[key(r.kind, l.v)] = r.value ? (rule?.threshold != null ? String(rule.threshold).replace(".", ",") : "") : !!rule;
    }
    draft = d;
  }
  $effect(() => { void rules; reset(); });

  const num = (s: string | boolean) => (typeof s === "string" && s.trim() !== "" ? Number(s.replace(",", ".")) : null);
  const invalid = $derived(ROWS.filter((r) => r.value).some((r) => LEVELS.some((l) => {
    const v = draft[key(r.kind, l.v)];
    return typeof v === "string" && v.trim() !== "" && !Number.isFinite(num(v));
  })));
  const warning = $derived.by(() => {
    const ia = num(draft["above:info"]), wa = num(draft["above:warning"]);
    const ib = num(draft["below:info"]), wb = num(draft["below:warning"]);
    if (ia != null && wa != null && wa < ia) return "Le seuil haut « important » est d'ordinaire plus élevé que le seuil « info ».";
    if (ib != null && wb != null && wb > ib) return "Le seuil bas « important » est d'ordinaire plus bas que le seuil « info ».";
    return "";
  });
  const count = $derived(rules.filter((r) => r.enabled).length);

  async function save() {
    const out: Omit<AlertRule, "series_id">[] = [];
    for (const r of ROWS) for (const l of LEVELS) {
      const v = draft[key(r.kind, l.v)];
      if (r.value) {
        const n = num(v);
        if (n != null) out.push({ kind: r.kind, level: l.v, threshold: n, enabled: true });
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
      {#each ROWS as r (r.kind)}
        <tr>
          <th scope="row">{r.label}</th>
          {#each LEVELS as l (l.v)}
            <td>
              {#if r.value}
                <span class="field">
                  <input inputmode="decimal" disabled={!editable} aria-label="{r.label} ({l.label})" placeholder="—"
                         value={draft[key(r.kind, l.v)] as string}
                         oninput={(e) => (draft[key(r.kind, l.v)] = (e.currentTarget as HTMLInputElement).value)} />
                  {series.unit}
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
      <button class="primary" disabled={saving || invalid} onclick={save}>{saving ? "…" : "Enregistrer les alertes"}</button>
      {#if saved}<span class="muted">Enregistré ✓</span>{/if}
    </div>
    <small class="muted">Vide : pas d'alerte. Pic / creux : même sensibilité que les flèches de tendance (Options).
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
  table { margin: 0.5rem 0; width: auto; }
  th, td { padding: 0.25rem 0.3rem; border: none; vertical-align: middle; }
  th:first-child { padding-left: 0; }
  th[scope="row"] { font-weight: 500; font-size: 0.85rem; text-transform: none; letter-spacing: 0; }
  .lvl { font-size: 0.8rem; }
  .lvl.info { color: var(--hum); }
  .lvl.warning { color: var(--err); }
  .field { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.85rem; color: var(--muted); }
  .field input { width: 3.8rem; min-height: 2rem; padding: 0.2rem 0.35rem; }
  .warn-text { color: var(--warn); display: block; margin-bottom: 0.4rem; }
  .row { margin: 0.4rem 0; }
</style>
