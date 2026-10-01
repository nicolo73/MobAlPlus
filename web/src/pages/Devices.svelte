<script lang="ts">
  import { api } from "../lib/api";
  import { fmtDate, toLocalInput } from "../lib/format";
  import type { Channel, Device, Place } from "../lib/types";

  let devices = $state<Device[] | null>(null);
  let places = $state<Place[]>([]);
  let error = $state("");
  let info = $state("");
  let showRetired = $state(false);

  // Ajout
  let newId = $state("");
  let newName = $state("");
  let adding = $state(false);
  const idValid = $derived(/^[0-9A-F]{12}$/i.test(newId.trim()));

  // Affectation en cours d'édition
  let editing = $state<{ channel: Channel; placeId: number | null; from: string } | null>(null);
  let renaming = $state<{ id: number; name: string } | null>(null);

  async function load() {
    try {
      [devices, places] = await Promise.all([api.devices(), api.places()]);
      error = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  load();

  async function run(action: () => Promise<unknown>, success?: string) {
    error = "";
    info = "";
    try {
      await action();
      if (success) info = success;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    adding = true;
    const id = newId.trim().toUpperCase();
    await run(async () => {
      await api.addDevice(id, newName.trim());
      // Première collecte : détecte le nom et les canaux du capteur sur le site Mobile Alerts
      const [res] = await api.collectNow([id]);
      if (res?.status === "ERROR") throw new Error(`Capteur ajouté, mais la collecte a échoué : ${res.error}`);
    }, `Capteur ${id} ajouté. Affectez maintenant ses canaux à un emplacement.`);
    newId = "";
    newName = "";
    adding = false;
  }

  function startAssign(channel: Channel) {
    editing = { channel, placeId: channel.place_id, from: toLocalInput(new Date()) };
  }

  async function saveAssign() {
    if (!editing) return;
    const { channel, placeId, from } = editing;
    await run(() => api.assignChannel(channel.id, placeId, new Date(from)), "Affectation enregistrée.");
    editing = null;
  }

  const placeName = (id: number | null) => places.find((p) => p.id === id)?.name ?? "non affecté";
  const visible = $derived((devices ?? []).filter((d) => showRetired || d.active));
</script>

<div class="stack">
  <form class="card" onsubmit={add}>
    <h2>Ajouter un capteur</h2>
    <div class="row add">
      <label>Identifiant Mobile Alerts
        <input bind:value={newId} placeholder="12 caractères, ex. 0301A2B3C4D5" maxlength="12"
               autocapitalize="characters" spellcheck="false" />
      </label>
      <label>Nom (facultatif) <input bind:value={newName} placeholder="ex. Thermo-hygro bureau" /></label>
      <button class="primary" type="submit" disabled={!idValid || adding}>{adding ? "Ajout…" : "Ajouter"}</button>
    </div>
    <small>L'identifiant figure au dos du capteur et dans l'application Mobile Alerts. Les canaux
      (température, humidité…) sont détectés automatiquement à la première collecte.</small>
  </form>

  {#if error}<div class="notice err" role="alert">{error}</div>{/if}
  {#if info}<div class="notice">{info}</div>{/if}

  <div class="row">
    <h2 style="margin:0">Capteurs</h2>
    <span class="spacer"></span>
    <label class="check"><input type="checkbox" bind:checked={showRetired} /> afficher les capteurs retirés</label>
  </div>

  {#if devices === null}
    <p class="muted">Chargement…</p>
  {:else}
    {#each visible as d (d.id)}
      <article class="card" class:retired={!d.active}>
        <div class="row head">
          {#if renaming?.id === d.id}
            <input bind:value={renaming.name} aria-label="Nom du capteur" />
            <button class="primary" onclick={() => run(() => api.renameDevice(d.id, renaming!.name)).then(() => (renaming = null))}>OK</button>
            <button onclick={() => (renaming = null)}>Annuler</button>
          {:else}
            <h3 style="margin:0">{d.name ?? d.ma_name ?? d.ma_id}</h3>
            <button class="link" onclick={() => (renaming = { id: d.id, name: d.name ?? "" })}>renommer</button>
          {/if}
          <span class="spacer"></span>
          {#if d.active}
            <button class="danger" onclick={() => confirm(`Retirer le capteur ${d.ma_id} ? Il ne sera plus collecté ; son historique est conservé.`)
                && run(() => api.retireDevice(d.id), "Capteur retiré.")}>Retirer</button>
          {:else}
            <span class="badge">retiré le {fmtDate(d.retired_at)}</span>
            <button onclick={() => run(() => api.reactivateDevice(d.id), "Capteur réactivé.")}>Réactiver</button>
          {/if}
        </div>
        <small class="num">{d.ma_id}{#if d.ma_name && d.ma_name !== d.name} · « {d.ma_name} » sur Mobile Alerts{/if}</small>

        {#if d.channels.length === 0}
          <p class="muted" style="margin-top:0.75rem">Canaux pas encore détectés : ils apparaîtront après la prochaine collecte.</p>
        {:else}
          <div class="table-wrap">
            <table>
              <thead><tr><th>Canal</th><th>Grandeur</th><th>Emplacement</th><th></th></tr></thead>
              <tbody>
                {#each d.channels as c (c.id)}
                  <tr>
                    <td class="num">{c.channel_no}<br /><small>{c.label ?? ""}</small></td>
                    <td>{c.property_name}</td>
                    <td>
                      {#if editing?.channel.id === c.id}
                        <div class="stack assign">
                          <select bind:value={editing.placeId} aria-label="Emplacement">
                            <option value={null}>— non affecté —</option>
                            {#each places as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
                          </select>
                          <label>à partir du
                            <input type="datetime-local" bind:value={editing.from} />
                          </label>
                          <div class="row">
                            <button class="primary" onclick={saveAssign}>Enregistrer</button>
                            <button onclick={() => (editing = null)}>Annuler</button>
                          </div>
                          <small>Les mesures antérieures restent attachées à l'emplacement précédent.</small>
                        </div>
                      {:else}
                        {placeName(c.place_id)}
                        {#if c.since}<br /><small>depuis le {new Date(c.since).toLocaleDateString("fr-FR")}</small>{/if}
                      {/if}
                    </td>
                    <td class="r">
                      {#if d.active && editing?.channel.id !== c.id}
                        <button class="link" onclick={() => startAssign(c)}>{c.place_id ? "déplacer" : "affecter"}</button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </article>
    {/each}
  {/if}
</div>

<style>
  .add { align-items: end; margin-bottom: 0.5rem; }
  .add label { flex: 1 1 14rem; }
  .add input { width: 100%; }
  .head { margin-bottom: 0.15rem; }
  .retired { opacity: 0.7; }
  .check { display: flex; align-items: center; gap: 0.4rem; color: var(--muted); }
  .check input { min-height: 0; }
  .assign { gap: 0.5rem; min-width: 13rem; }
  table { margin-top: 0.75rem; }
</style>
