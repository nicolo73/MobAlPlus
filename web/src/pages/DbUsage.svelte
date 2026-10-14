<script lang="ts">
  // Admin › Base de données : occupation par rapport au quota (offre gratuite : 500 Mo), seuils
  // d'alerte, et détail par maison, emplacement et capteur, et par niveau de stockage.
  import { api } from "../lib/api";
  import { fmtBytes, fmtDate } from "../lib/format";
  import { usageTree, type Sizes, type UsageRow } from "../lib/dbusage";
  import type { DbUsage } from "../lib/types";

  let usage = $state<DbUsage | null>(null);
  let error = $state("");
  let open = $state(new Set<string>());
  // Réglages
  let quota = $state("");
  let info = $state("");
  let warning = $state("");
  let saving = $state(false);
  let saved = $state(false);

  async function load() {
    try {
      usage = await api.dbUsage();
      quota = String(usage.quota_mb);
      info = usage.info_pct != null ? String(usage.info_pct) : "";
      warning = usage.warning_pct != null ? String(usage.warning_pct) : "";
      error = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  load();

  const quotaBytes = $derived((usage?.quota_mb ?? 500) * 1024 * 1024);
  const pct = $derived(usage ? (usage.total_bytes / quotaBytes) * 100 : 0);
  const tree = $derived(usage ? usageTree(usage) : null);
  const level = $derived(usage?.warning_pct != null && pct >= usage.warning_pct ? "err"
    : usage?.info_pct != null && pct >= usage.info_pct ? "warn" : "ok");
  const share = (b: number) => (quotaBytes ? `${((b / quotaBytes) * 100).toLocaleString("fr-FR", { maximumFractionDigits: b / quotaBytes < 0.01 ? 2 : 1 })} %` : "–");
  const size = (b: number) => (b > 0 ? fmtBytes(b) : "–");

  function toggle(key: string) {
    const s = new Set(open);
    if (s.has(key)) s.delete(key); else s.add(key);
    open = s;
  }

  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  const invalid = $derived(!(Number(num(quota)) > 0) || [info, warning].some((v) => v.trim() !== "" && !(Number(num(v)) > 0 && Number(num(v)) <= 100)));
  async function saveSettings(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    error = "";
    try {
      await api.saveSetting("db_quota_mb", num(quota));
      // (vide : pas d'alerte de ce niveau)
      await api.saveSetting("db_alert_info_pct", num(info) ?? "");
      await api.saveSetting("db_alert_warning_pct", num(warning) ?? "");
      saved = true;
      setTimeout(() => (saved = false), 2500);
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

{#snippet cells(s: Sizes, bold = false)}
  <td class="r num hide-sm">{size(s.detail)}</td>
  <td class="r num hide-sm">{size(s.compact)}</td>
  <td class="r num hide-sm">{size(s.simplified)}</td>
  <td class="r num hide-sm">{size(s.weather)}</td>
  <td class="r num" class:b={bold}>{size(s.total)}</td>
  <td class="r num" class:b={bold}>{share(s.total)}</td>
{/snippet}

{#snippet line(r: UsageRow, child = false)}
  <tr class:child>
    <td class="name">{r.label}{#if r.sub}<br /><small class="muted">{r.sub}</small>{/if}</td>
    {@render cells(r.sizes)}
  </tr>
{/snippet}

{#if error}<div class="notice err" style="margin-bottom:1rem">{error}</div>{/if}

{#if usage && tree}
  <div class="stack">
    <section class="card stack">
      <h2 style="margin:0">Occupation</h2>
      <div class="kpi num">{fmtBytes(usage.total_bytes)} <span class="muted">sur {fmtBytes(quotaBytes)}</span></div>
      <div class="gauge">
        <div class="bar {level}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(pct)} aria-label="Occupation du quota">
          <span style="width:{Math.min(100, pct)}%"></span>
        </div>
        {#if usage.info_pct != null}<i class="tick info" style="left:{usage.info_pct}%" title="Seuil info : {usage.info_pct} %"></i>{/if}
        {#if usage.warning_pct != null}<i class="tick warning" style="left:{usage.warning_pct}%" title="Seuil important : {usage.warning_pct} %"></i>{/if}
      </div>
      <small class="num">{pct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % du quota</small>
      {#if usage.alert}
        <div class="notice {usage.alert.level === 'warning' ? 'err' : 'warn'}">
          {usage.alert.level === "warning" ? "⚠ Alerte importante" : "ⓘ Alerte info"} depuis le {fmtDate(usage.alert.started_at)} :
          {Math.round(usage.alert.value)} % du quota (seuil {usage.alert.threshold} %).
          Pistes : réduire la durée du détail récent ou l'âge de simplification (Maintenance), retirer des capteurs inutiles,
          passer à une offre supérieure.
        </div>
      {/if}
    </section>

    <form class="card stack" onsubmit={saveSettings}>
      <h2 style="margin:0">Seuils d'alerte</h2>
      <div class="row settings">
        <label>Quota (Mo) <input inputmode="decimal" bind:value={quota} /></label>
        <label>Alerte info (%) <input inputmode="decimal" bind:value={info} placeholder="aucune" /></label>
        <label>Alerte importante (%) <input inputmode="decimal" bind:value={warning} placeholder="aucune" /></label>
        <button class="primary" type="submit" disabled={saving || invalid}>{saving ? "…" : "Enregistrer"}</button>
        {#if saved}<span class="muted">Enregistré ✓</span>{/if}
      </div>
      <small class="muted">Vérifiée chaque heure ; une alerte s'affiche ici et sur le tableau de bord, et les administrateurs
        abonnés aux notifications (Options) sont prévenus. Vide : pas d'alerte de ce niveau.</small>
    </form>

    <section class="card">
      <h2>Détail</h2>
      <p class="muted hint">Estimation de la place de chaque capteur selon le niveau de stockage : <strong>détail</strong>
        (mesures récentes, une ligne par mesure), <strong>compacté</strong> (au-delà, sans perte), <strong>simplifié</strong>
        (points significatifs, au-delà de quelques années), <strong>prévision et normales</strong> (stations météo).
        Toucher une maison pour son détail.</p>
      <div class="table-wrap">
        <table class="usage">
          <thead>
            <tr><th>Rubrique</th><th class="r hide-sm">Détail</th><th class="r hide-sm">Compacté</th><th class="r hide-sm">Simplifié</th>
              <th class="r hide-sm">Prévision, normales</th><th class="r">Total</th><th class="r">% quota</th></tr>
          </thead>
          <tbody>
            {@render line(tree.general)}
            {#each tree.groups as g (g.key)}
              <tr class="group" onclick={() => toggle(g.key)}>
                <td class="name"><button class="link" aria-expanded={open.has(g.key)}>{open.has(g.key) ? "▾" : "▸"} {g.label}</button>
                  {#if g.sub}<br /><small class="muted">{g.sub}</small>{/if}</td>
                {@render cells(g.sizes, true)}
              </tr>
              {#if open.has(g.key)}
                {#each g.children as r (r.key)}{@render line(r, true)}{/each}
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  </div>
{:else if !error}
  <p class="muted">Chargement…</p>
{/if}

<style>
  .kpi { font-size: 1.6rem; font-weight: 700; }
  .gauge { position: relative; }
  .tick { position: absolute; top: -3px; bottom: -3px; width: 2px; transform: translateX(-1px); }
  .tick.info { background: var(--hum); }
  .tick.warning { background: var(--err); }
  .settings { align-items: end; flex-wrap: wrap; }
  .settings label { flex: 0 1 11rem; }
  .settings input { width: 100%; }
  .hint { font-size: 0.85rem; margin: 0 0 0.5rem; }
  .usage td.name { min-width: 12rem; }
  .usage tr.group { cursor: pointer; }
  .usage tr.group td { border-top: 2px solid var(--border); }
  .usage tr.child td.name { padding-left: 1.6rem; }
  .usage .b { font-weight: 700; }
  .usage td.num { white-space: nowrap; }
  .usage .link { font-weight: 600; color: var(--text); padding: 0; min-height: 0; text-align: left; justify-content: flex-start; }
  @media (max-width: 600px) { .hide-sm { display: none; } }
</style>
