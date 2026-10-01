<script lang="ts">
  import { api } from "../lib/api";
  import { fmtDate, fmtInt } from "../lib/format";
  import type { Property, Stats } from "../lib/types";

  let stats = $state<Stats | null>(null);
  let props = $state<Property[]>([]);
  let hotDays = $state(90);
  let simplifyYears = $state(3);
  let error = $state("");
  let info = $state("");
  let running = $state(false);

  async function load() {
    try {
      [stats, props] = await Promise.all([api.stats(), api.properties()]);
      hotDays = Number(stats.settings.hot_days ?? 90);
      simplifyYears = Math.round((Number(stats.settings.simplify_after_days ?? 1095) / 365) * 10) / 10;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  load();

  async function act(action: () => Promise<unknown>, success: string) {
    error = "";
    info = "";
    try {
      await action();
      info = success;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function saveRetention(e: SubmitEvent) {
    e.preventDefault();
    await act(async () => {
      await api.saveSetting("hot_days", hotDays);
      await api.saveSetting("simplify_after_days", Math.round(simplifyYears * 365));
    }, "Durées enregistrées ; elles s'appliqueront à la prochaine maintenance.");
  }

  async function runNow() {
    running = true;
    await act(async () => {
      const r = await api.runMaintenance() as { compacted?: number; simplified?: { days?: number } };
      info = `Maintenance terminée : ${fmtInt(r.compacted ?? 0)} valeurs compactées, ${r.simplified?.days ?? 0} jours simplifiés.`;
    }, "");
    running = false;
  }

  const ratio = $derived(stats && stats.values.simplified_raw
    ? Math.round((1 - stats.values.simplified / stats.values.simplified_raw) * 100) : null);
</script>

<div class="stack">
  {#if error}<div class="notice err" role="alert">{error}</div>{/if}
  {#if info}<div class="notice">{info}</div>{/if}

  <form class="card stack" onsubmit={saveRetention}>
    <h2>Durées de conservation</h2>
    <div class="grid">
      <label>Détail complet modifiable (jours)
        <input type="number" min="7" max="365" bind:value={hotDays} />
      </label>
      <label>Simplification au-delà de (années)
        <input type="number" min="1" max="20" step="0.5" bind:value={simplifyYears} />
      </label>
    </div>
    <small>
      Avant {simplifyYears} ans, tous les points sont conservés (compactés sans perte après {hotDays} jours).
      Au-delà, seuls les points significatifs sont gardés : extrêmes du jour, crêtes, creux et ruptures de pente.
    </small>
    <div><button class="primary" type="submit">Enregistrer</button></div>
  </form>

  <section class="card">
    <h2>Tolérances de simplification</h2>
    <p class="muted">Écart maximal accepté entre la courbe simplifiée et la courbe d'origine. Vide = jamais simplifié.</p>
    <div class="table-wrap">
      <table>
        <tbody>
          {#each props.filter((p) => p.code !== "unknown") as p (p.id)}
            <tr>
              <td>{p.name}</td>
              <td class="r">
                <input type="number" step="0.1" min="0" style="width:6rem" value={p.simplify_tolerance ?? ""}
                       aria-label="Tolérance {p.name}"
                       onchange={(e) => {
                         const v = (e.currentTarget as HTMLInputElement).value;
                         act(() => api.saveTolerance(p.id, v === "" ? null : Number(v)), `Tolérance « ${p.name} » enregistrée.`);
                       }} />
                <span class="muted unit">{p.unit}</span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if ratio !== null}<small>Points supprimés par la simplification à ce jour : {ratio} %.</small>{/if}
  </section>

  <section class="card">
    <div class="row">
      <div>
        <h2 style="margin:0">Maintenance</h2>
        <small>Automatique chaque nuit. Dernière exécution : {stats?.last_maintenance ? fmtDate(stats.last_maintenance.run_at) : "jamais"}</small>
      </div>
      <span class="spacer"></span>
      <button onclick={runNow} disabled={running}>{running ? "En cours…" : "Lancer maintenant"}</button>
    </div>
  </section>
</div>

<style>
  .unit { display: inline-block; min-width: 1.5rem; text-align: left; }
</style>
