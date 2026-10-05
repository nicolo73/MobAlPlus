<script lang="ts">
  import { api } from "../lib/api";
  import { fmtDate } from "../lib/format";
  import { ctx, currentHome, loadContext, selectHome } from "../lib/home.svelte";
  import type { HomeRole, Member } from "../lib/types";
  import InviteSend from "../components/InviteSend.svelte";

  const ROLES: Record<HomeRole, { label: string; help: string; rights: string }> = {
    owner: { label: "Propriétaire", help: "tout, y compris le partage", rights: "comme propriétaire" },
    editor: { label: "Gestion", help: "capteurs, emplacements, corrections", rights: "en gestion" },
    viewer: { label: "Lecture", help: "consulte les valeurs et les courbes", rights: "en lecture" },
  };

  let members = $state<Member[] | null>(null);
  let email = $state("");
  let role = $state<HomeRole>("viewer");
  let homeName = $state(currentHome()?.name ?? "");
  let newHome = $state("");
  let error = $state("");
  let info = $state("");
  /** Invitation à transmettre (après un ajout, ou depuis la liste des membres) */
  let sendTo = $state<{ email: string; role: HomeRole } | null>(null);

  const homeId = ctx.homeId!;
  const emailValid = $derived(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()));
  const owners = $derived((members ?? []).filter((m) => m.role === "owner").length);

  async function load() {
    try {
      members = await api.members(homeId);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  load();

  async function run(action: () => Promise<unknown>, success: string) {
    error = "";
    info = "";
    try {
      await action();
      info = success;
      await load();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      error = /duplicate key|23505/.test(msg) ? "Cette adresse est déjà membre de la maison." : msg;
      return false;
    }
  }

  async function invite(e: SubmitEvent) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    const ok = await run(() => api.addMember(homeId, address, role),
      `${address} a accès à « ${currentHome()?.name} » (${ROLES[role].label.toLowerCase()}). ` +
      "Prévenez cette personne avec le message ci-dessous.");
    if (ok) sendTo = { email: address, role };
    email = "";
  }

  async function rename(e: SubmitEvent) {
    e.preventDefault();
    await run(async () => { await api.renameHome(homeId, homeName.trim()); await loadContext(); }, "Maison renommée.");
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    await run(async () => {
      const id = await api.createHome(newHome.trim());
      await loadContext();
      selectHome(id);
    }, `Maison « ${newHome.trim()} » créée : elle est maintenant sélectionnée.`);
    newHome = "";
  }

  const shareLink = location.origin + location.pathname;
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareLink);
      info = "Adresse de l'application copiée.";
    } catch {
      info = shareLink;
    }
  }
</script>

<div class="stack">
  {#if error}<div class="notice err" role="alert">{error}</div>{/if}
  {#if info}<div class="notice" role="status">{info}</div>{/if}

  <form class="card stack" onsubmit={invite}>
    <h2 style="margin:0">Partager « {currentHome()?.name} »</h2>
    <p class="muted" style="margin:0">La personne invitée se connecte avec cette adresse e-mail (compte Google ou
      création de compte) et voit aussitôt la maison. Elle n'a pas besoin de capteurs.</p>
    <div class="row add">
      <label>Adresse e-mail
        <input type="email" bind:value={email} placeholder="prenom@exemple.fr" autocomplete="off" />
      </label>
      <label>Droits
        <select bind:value={role}>
          {#each Object.entries(ROLES) as [value, r] (value)}<option {value}>{r.label} : {r.help}</option>{/each}
        </select>
      </label>
      <button class="primary" type="submit" disabled={!emailValid}>Inviter</button>
    </div>
    <div class="row">
      <small class="muted">Adresse à lui transmettre : <span class="num">{shareLink}</span></small>
      <button type="button" class="link" onclick={copyLink}>copier</button>
    </div>
  </form>

  {#if sendTo}
    {#key sendTo}
      <InviteSend email={sendTo.email} home={currentHome()?.name ?? ""} rights={ROLES[sendTo.role].rights}
                  link={shareLink} onclose={() => (sendTo = null)} />
    {/key}
  {/if}

  <section class="card">
    <h2>Membres</h2>
    {#if members === null}
      <p class="muted">Chargement…</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Compte</th><th>Droits</th><th class="hide-sm">Depuis</th><th></th></tr></thead>
          <tbody>
            {#each members as m (m.id)}
              {@const lastOwner = m.role === "owner" && owners <= 1}
              <tr>
                <td>
                  {m.email}
                  {#if m.email === ctx.email}<span class="badge">vous</span>{/if}
                  <br /><small class="muted">{m.user_id ? "compte actif" : "invitation en attente de première connexion"}</small>
                  {#if !m.user_id}
                    <button class="link" onclick={() => { sendTo = { email: m.email, role: m.role }; scrollTo({ top: 0, behavior: "smooth" }); }}>
                      envoyer l'invitation</button>
                  {/if}
                </td>
                <td>
                  <select value={m.role} disabled={lastOwner} aria-label="Droits de {m.email}"
                          title={lastOwner ? "Une maison doit garder au moins un propriétaire" : ""}
                          onchange={(e) => run(() => api.setMemberRole(m.id, (e.currentTarget as HTMLSelectElement).value as HomeRole),
                                               `Droits de ${m.email} modifiés.`)}>
                    {#each Object.entries(ROLES) as [value, r] (value)}<option {value}>{r.label}</option>{/each}
                  </select>
                </td>
                <td class="hide-sm">{fmtDate(m.created_at)}</td>
                <td class="r">
                  {#if !lastOwner}
                    <button class="link danger" onclick={() => confirm(`Retirer l'accès de ${m.email} ?`)
                      && run(() => api.removeMember(m.id), `${m.email} n'a plus accès à la maison.`)}>retirer</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <form class="card stack" onsubmit={rename}>
    <h2 style="margin:0">Maison</h2>
    <div class="row add">
      <label>Nom <input bind:value={homeName} required /></label>
      <button type="submit" disabled={!homeName.trim() || homeName.trim() === currentHome()?.name}>Renommer</button>
    </div>
  </form>

  {#if ctx.platformAdmin}
    <form class="card stack" onsubmit={create}>
      <h2 style="margin:0">Nouvelle maison</h2>
      <p class="muted" style="margin:0">Réservé à l'administrateur de la plateforme. Vous en devenez propriétaire ;
        ses capteurs utilisent pour l'instant le compte Mobile Alerts configuré dans le collecteur.</p>
      <div class="row add">
        <label>Nom <input bind:value={newHome} placeholder="ex. Chalet" /></label>
        <button type="submit" disabled={!newHome.trim()}>Créer</button>
      </div>
    </form>
  {/if}
</div>

<style>
  .add { align-items: end; }
  .add label { flex: 1 1 14rem; }
  .add input, .add select { width: 100%; }
  .danger { color: var(--err); }
  @media (max-width: 600px) { .hide-sm { display: none; } }
</style>
