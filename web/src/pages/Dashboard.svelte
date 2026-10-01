<script lang="ts">
  import { api } from "../lib/api";
  import { fmtAgo, fmtBytes, fmtDate, fmtInt, isStale } from "../lib/format";
  import type { CollectResult, Stats } from "../lib/types";

  let stats = $state<Stats | null>(null);
  let error = $state("");
  let collecting = $state(false);
  let collectResult = $state<CollectResult[] | null>(null);

  async function load() {
    try {
      stats = await api.stats();
      error = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  load();

  async function collect() {
    collecting = true;
    collectResult = null;
    try {
      collectResult = await api.collectNow();
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      collecting = false;
    }
  }

  const quota = $derived(Number(stats?.settings.db_quota_mb ?? 500) * 1024 * 1024);
  const usage = $derived(stats ? stats.db_size_bytes / quota : 0);
  const totalValues = $derived(stats ? stats.values.recent + stats.values.compacted + stats.values.simplified : 0);

  function status(d: Stats["devices"][number]) {
    if (!d.active) return { cls: "", label: "retiré" };
    if (d.status === "ERROR") return { cls: "err", label: "erreur" };
    if (isStale(d.last_ts)) return { cls: "warn", label: "muet" };
    return { cls: "ok", label: "OK" };
  }
</script>

{#if error}<div class="notice err" style="margin-bottom:1rem">{error}</div>{/if}

{#if stats}
  <div class="stack">
    <div class="grid kpis">
      <div class="card">
        <small>Base de données</small>
        <div class="kpi num">{fmtBytes(stats.db_size_bytes)}</div>
        <div class="bar" class:warn={usage > 0.7} class:err={usage > 0.9}
             role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(usage * 100)}
             aria-label="Occupation du quota">
          <span style="width:{Math.min(100, usage * 100)}%"></span>
        </div>
        <small class="num">{Math.round(usage * 100)} % de {fmtBytes(quota)}</small>
      </div>
      <div class="card">
        <small>Capteurs actifs</small>
        <div class="kpi num">{stats.counts.active_devices} <span class="muted">/ {stats.counts.devices}</span></div>
        <small>{stats.counts.channels} canaux · {stats.counts.places} emplacements</small>
      </div>
      <div class="card">
        <small>Mesures stockées</small>
        <div class="kpi num">{fmtInt(totalValues)}</div>
        <small class="num">
          {fmtInt(stats.values.recent)} récentes · {fmtInt(stats.values.compacted)} compactées
          {#if stats.values.simplified} · {fmtInt(stats.values.simplified)} simplifiées{/if}
        </small>
      </div>
      <div class="card">
        <small>Qualité</small>
        <div class="kpi num">{stats.counts.corrections}</div>
        <small>corrections · {stats.counts.annotations} annotations</small>
      </div>
    </div>

    <section class="card">
      <div class="row" style="margin-bottom:0.5rem">
        <h2 style="margin:0">Collecte</h2>
        <span class="spacer"></span>
        <button class="primary" onclick={collect} disabled={collecting}>
          {collecting ? "Collecte en cours…" : "Collecter maintenant"}
        </button>
      </div>
      {#if collectResult}
        {@const errors = collectResult.filter((r) => r.status === "ERROR")}
        <div class="notice" class:err={errors.length > 0} style="margin-bottom:0.75rem">
          {collectResult.filter((r) => r.status === "OK").length} capteur(s) collecté(s),
          {collectResult.reduce((n, r) => n + (r.inserted ?? 0), 0)} valeur(s) ajoutée(s)
          {#if errors.length} · {errors.length} erreur(s){/if}
        </div>
      {/if}
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Capteur</th><th>État</th><th>Dernière mesure</th><th class="r">Mesures</th><th class="hide-sm">Depuis</th></tr>
          </thead>
          <tbody>
            {#each stats.devices as d (d.ma_id)}
              {@const s = status(d)}
              <tr>
                <td>{d.name ?? d.ma_id}<br /><small class="num">{d.ma_id}</small></td>
                <td><span class="badge {s.cls}" title={d.message ?? ""}>{s.label}</span></td>
                <td title={fmtDate(d.last_ts)}>{fmtAgo(d.last_ts)}</td>
                <td class="r num">{fmtInt(d.values)}</td>
                <td class="hide-sm">{d.first_ts ? new Date(d.first_ts).toLocaleDateString("fr-FR") : "–"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2>Stockage</h2>
      <div class="table-wrap">
        <table>
          <tbody>
            <tr><td>Mesures récentes (détail)</td><td class="r num">{fmtBytes(stats.tables.reading)}</td></tr>
            <tr><td>Historique compacté</td><td class="r num">{fmtBytes(stats.tables.reading_day)}</td></tr>
            <tr><td>Corrections et annotations</td>
                <td class="r num">{fmtBytes((stats.tables.correction ?? 0) + (stats.tables.annotation ?? 0))}</td></tr>
          </tbody>
        </table>
      </div>
      <small>Dernière maintenance : {stats.last_maintenance ? fmtDate(stats.last_maintenance.run_at) : "jamais"}</small>
    </section>
  </div>
{:else if !error}
  <p class="muted">Chargement…</p>
{/if}

<style>
  .kpi { font-size: 1.6rem; font-weight: 700; margin: 0.15rem 0 0.4rem; }
  .kpis .card { display: grid; gap: 0.2rem; }
  @media (max-width: 600px) { .hide-sm { display: none; } }
</style>
