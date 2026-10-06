<script lang="ts">
  // Historique des alertes : en cours et récentes d'abord ; les archivées sont masquées par défaut.
  // Glisser une alerte vers la gauche ou la droite l'archive (ou la restaure).
  import { api } from "../lib/api";
  import { alerts, describe, isCurrent, loadAlerts } from "../lib/alerts.svelte";
  import { canEdit } from "../lib/home.svelte";
  import type { AlertEvent } from "../lib/types";

  const DAY = 86_400_000;
  const PERIODS = [{ d: 7, label: "7 j" }, { d: 30, label: "30 j" }, { d: 365, label: "1 an" }];

  let days = $state(30);
  let showArchived = $state(false);
  let onlyWarnings = $state(false);
  let error = $state("");
  let info = $state("");

  $effect(() => { void days; loadAlerts(Date.now() - days * DAY); });

  const list = $derived(alerts.events
    .filter((e) => e.archived === showArchived)
    .filter((e) => !onlyWarnings || e.level === "warning"));
  const current = $derived(list.filter((e) => isCurrent(e) || showArchived));
  const past = $derived(showArchived ? [] : list.filter((e) => !isCurrent(e)));
  const archivedCount = $derived(alerts.events.filter((e) => e.archived).length);

  async function run(action: () => Promise<unknown>, done = "") {
    error = "";
    info = "";
    try {
      await action();
      info = done;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await loadAlerts(Date.now() - days * DAY);
  }
  function archive(ids: number[], archived: boolean) {
    // Mise à jour immédiate de l'affichage, puis enregistrement
    for (const e of alerts.events) if (ids.includes(e.id)) e.archived = archived;
    return run(() => api.archiveAlerts(ids, archived));
  }
  function remove(ids: number[]) {
    if (!confirm(ids.length > 1 ? `Effacer ces ${ids.length} alertes pour tous les membres de la maison ?`
                                : "Effacer cette alerte pour tous les membres de la maison ?")) return;
    return run(() => api.deleteAlerts(ids), ids.length > 1 ? `${ids.length} alertes effacées.` : "Alerte effacée.");
  }

  // Glisser pour archiver : suivi du doigt, au-delà de 90 px l'alerte part
  let drag = $state<{ id: number; x0: number; dx: number } | null>(null);
  function down(e: PointerEvent, ev: AlertEvent) {
    if ((e.target as HTMLElement).closest("button, a")) return;
    drag = { id: ev.id, x0: e.clientX, dx: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) { if (drag) drag.dx = e.clientX - drag.x0; }
  function up(ev: AlertEvent) {
    if (!drag) return;
    const far = Math.abs(drag.dx) > 90;
    drag = null;
    if (far) archive([ev.id], !ev.archived);
  }
</script>

<div class="stack">
  <div class="row head">
    <h1 style="margin:0">Alertes</h1>
    <span class="spacer"></span>
    <div class="seg" role="group" aria-label="Période">
      {#each PERIODS as p (p.d)}
        <button class:active={days === p.d} aria-pressed={days === p.d} onclick={() => (days = p.d)}>{p.label}</button>
      {/each}
    </div>
  </div>

  <div class="row filters">
    <label class="check"><input type="checkbox" bind:checked={onlyWarnings} /> Importantes seulement</label>
    <label class="check"><input type="checkbox" bind:checked={showArchived} /> Archivées ({archivedCount})</label>
    <span class="spacer"></span>
    {#if !showArchived && list.length}
      <button onclick={() => archive(list.map((e) => e.id), true)}>Tout archiver</button>
    {:else if showArchived && list.length}
      <button onclick={() => archive(list.map((e) => e.id), false)}>Tout restaurer</button>
      {#if canEdit()}<button class="danger" onclick={() => remove(list.map((e) => e.id))}>Tout effacer</button>{/if}
    {/if}
  </div>

  {#if error}<div class="notice err" role="alert">{error}</div>{/if}
  {#if info}<div class="notice" role="status">{info}</div>{/if}
  {#if alerts.error}
    <div class="notice warn">Alertes indisponibles : la base de données n'est peut-être pas encore à jour.</div>
  {/if}

  {#snippet item(e: AlertEvent)}
    {@const d = drag?.id === e.id ? drag.dx : 0}
    <li class="alert {e.level}" class:ongoing={e.ended_at === null && e.kind !== "peak" && e.kind !== "trough"}
        style="transform: translateX({d}px); opacity: {1 - Math.min(Math.abs(d) / 250, 0.6)}"
        onpointerdown={(p) => down(p, e)} onpointermove={move} onpointerup={() => up(e)} onpointercancel={() => (drag = null)}>
      <span class="icon" aria-label={e.level === "warning" ? "Importante" : "Info"}>
        {#if e.level === "warning"}
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3L2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
        {/if}
      </span>
      <div class="text">
        <a href="#/lieu/{e.place_id}"><strong>{e.place_name}</strong></a>
        {#if e.ended_at === null && e.kind !== "peak" && e.kind !== "trough"}<span class="badge">en cours</span>{/if}
        <div>{describe(e)}</div>
      </div>
      <div class="actions">
        <button class="link" onclick={() => archive([e.id], !e.archived)}>{e.archived ? "restaurer" : "archiver"}</button>
        {#if canEdit()}<button class="link danger" onclick={() => remove([e.id])}>effacer</button>{/if}
      </div>
    </li>
  {/snippet}

  {#if !alerts.loaded && !alerts.error}
    <p class="muted">Chargement…</p>
  {:else if !list.length}
    <div class="card muted">
      {showArchived ? "Aucune alerte archivée sur la période." : "Aucune alerte sur la période."}
      {#if !showArchived}Les seuils se règlent sur la page de chaque emplacement (rubrique « Alertes »).{/if}
    </div>
  {:else}
    {#if current.length}
      <section>
        <h2>{showArchived ? "Archivées" : "En cours et récentes"}</h2>
        <ul class="alerts">{#each current as e (e.id)}{@render item(e)}{/each}</ul>
      </section>
    {/if}
    {#if past.length}
      <section>
        <h2>Plus anciennes</h2>
        <ul class="alerts">{#each past as e (e.id)}{@render item(e)}{/each}</ul>
      </section>
    {/if}
    <small class="muted">Glisser une alerte vers la gauche ou la droite pour l'{showArchived ? "restaurer" : "archiver"}.
      L'archivage ne concerne que votre compte ; l'effacement (droits « gestion ») vaut pour toute la maison.</small>
  {/if}
</div>

<style>
  .head { flex-wrap: nowrap; }
  .filters { gap: 0.5rem 1rem; }
  .check { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.9rem; }
  .check input { min-height: 0; }
  .seg { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .seg button { border: none; border-radius: 0; min-height: 2.1rem; padding: 0.3rem 0.7rem; font-size: 0.9rem; color: var(--muted); }
  .seg button + button { border-left: 1px solid var(--border); }
  .seg button.active { background: var(--primary-soft); color: var(--text); font-weight: 600; }
  h2 { font-size: 1rem; margin: 0 0 0.5rem; color: var(--muted); }
  .alerts { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .alert { display: flex; align-items: flex-start; gap: 0.6rem; padding: 0.6rem 0.75rem; border-radius: var(--radius);
           background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--alert-c);
           touch-action: pan-y; user-select: none; transition: transform 0.15s, opacity 0.15s; --alert-c: var(--hum); }
  .alert.warning { --alert-c: var(--err); }
  .alert.ongoing { background: color-mix(in srgb, var(--alert-c) 7%, var(--surface)); }
  .icon { color: var(--alert-c); flex: none; padding-top: 0.1rem; }
  .icon svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .text { flex: 1; min-width: 0; font-size: 0.92rem; }
  .text a { color: inherit; }
  .actions { display: grid; justify-items: end; gap: 0.1rem; flex: none; }
  .actions .link { font-size: 0.8rem; }
  .danger { color: var(--err); }
</style>
