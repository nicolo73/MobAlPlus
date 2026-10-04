<script lang="ts">
  import { api } from "./lib/api";
  import { router, routes, type Route } from "./lib/router.svelte";
  import type { Role } from "./lib/types";
  import Login from "./pages/Login.svelte";
  import Now from "./pages/Now.svelte";
  import Charts from "./pages/Charts.svelte";
  import Dashboard from "./pages/Dashboard.svelte";
  import Devices from "./pages/Devices.svelte";
  import Places from "./pages/Places.svelte";
  import Maintenance from "./pages/Maintenance.svelte";

  let session = $state<{ email: string } | null | undefined>(undefined);
  let role = $state<Role | null>(null);
  let roleError = $state("");

  async function refreshSession() {
    session = await api.session();
    roleError = "";
    try {
      role = session ? await api.role() : null;
    } catch (e) {
      role = null;
      roleError = e instanceof Error ? e.message : String(e);
    }
  }
  refreshSession();
  api.onAuthChange(refreshSession);

  const isAdminRoute = $derived(router.route.startsWith("/admin"));
  const main: { href: Route; label: string; icon: string }[] = [
    { href: "/", label: "Maintenant", icon: "M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 8v4l3 2" },
    { href: "/courbes", label: "Courbes", icon: "M3 17l5-6 4 3 5-7 4 4" },
    { href: "/admin", label: "Admin", icon: "M4 6h16M4 12h16M4 18h10" },
  ];
  const adminTabs: Route[] = ["/admin", "/admin/capteurs", "/admin/emplacements", "/admin/maintenance"];
</script>

{#if session === undefined}
  <div class="loading">Chargement…</div>
{:else if session === null}
  <Login />
{:else}
  <div class="shell">
    <header>
      <a class="brand" href="#/">
        <img src="/icon.svg" alt="" width="28" height="28" />
        <span>MobAlPlus</span>
      </a>
      {#if api.demo}<span class="badge warn" title="Aucun projet Supabase configuré : données fictives">Démo</span>{/if}
      <span class="spacer"></span>
      <span class="user muted">{session.email}</span>
      <button class="link" onclick={() => api.signOut()}>Déconnexion</button>
    </header>

    <nav class="main-nav" aria-label="Navigation principale">
      {#each main as item (item.href)}
        {@const active = item.href === "/admin" ? isAdminRoute : router.route === item.href}
        <a href={"#" + item.href} class:active aria-current={active ? "page" : undefined}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={item.icon} /></svg>
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>

    <main>
      {#if roleError}
        <div class="notice err" style="margin-bottom:1rem">Impossible de lire les droits du compte : {roleError}</div>
      {:else if role === null}
        <div class="notice warn" style="margin-bottom:1rem">
          Le compte <strong>{session.email}</strong> est connecté mais n'est pas encore autorisé :
          un administrateur doit l'ajouter (table <code>app_user</code>).
        </div>
      {/if}
      {#if isAdminRoute}
        {#if role !== "admin"}
          <div class="card notice warn">L'administration est réservée aux comptes administrateurs.</div>
        {:else}
          <nav class="tabs" aria-label="Administration">
            {#each adminTabs as tab (tab)}
              <a href={"#" + tab} class:active={router.route === tab}>{routes[tab]}</a>
            {/each}
          </nav>
          {#if router.route === "/admin"}<Dashboard />
          {:else if router.route === "/admin/capteurs"}<Devices />
          {:else if router.route === "/admin/emplacements"}<Places />
          {:else}<Maintenance />{/if}
        {/if}
      {:else if router.route === "/courbes"}
        <Charts />
      {:else}
        <Now />
      {/if}
    </main>
  </div>
{/if}

<style>
  .loading { display: grid; place-items: center; min-height: 100dvh; color: var(--muted); }
  .shell {
    min-height: 100dvh;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr auto;
    grid-template-areas: "header" "main" "nav";
  }
  header {
    grid-area: header;
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.6rem 1rem; padding-top: max(0.6rem, env(safe-area-inset-top));
    background: var(--surface); border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 10;
  }
  .brand { display: flex; align-items: center; gap: 0.5rem; font-weight: 700; color: var(--text); text-decoration: none; }
  .user { font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40vw; }
  @media (max-width: 600px) { .user { display: none; } }
  main { grid-area: main; padding: 1rem; width: 100%; max-width: 72rem; margin: 0 auto; min-width: 0; }

  .main-nav {
    grid-area: nav;
    display: flex; justify-content: space-around;
    background: var(--surface); border-top: 1px solid var(--border);
    position: sticky; bottom: 0; z-index: 10;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .main-nav a {
    flex: 1; display: grid; justify-items: center; gap: 0.15rem;
    padding: 0.5rem 0.25rem; font-size: 0.75rem; color: var(--muted); text-decoration: none;
  }
  .main-nav a.active { color: var(--primary); font-weight: 600; }
  .main-nav svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

  .tabs { display: flex; gap: 0.25rem; overflow-x: auto; margin-bottom: 1rem; border-bottom: 1px solid var(--border); }
  .tabs a {
    padding: 0.55rem 0.8rem; white-space: nowrap; text-decoration: none; color: var(--muted);
    border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .tabs a.active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 600; }

  @media (min-width: 900px) {
    .shell {
      grid-template-columns: 13rem minmax(0, 1fr);
      grid-template-rows: auto 1fr;
      grid-template-areas: "header header" "nav main";
    }
    .main-nav {
      flex-direction: column; justify-content: flex-start; gap: 0.25rem;
      border-top: none; border-right: 1px solid var(--border);
      position: sticky; top: 3.3rem; height: calc(100dvh - 3.3rem); padding: 1rem 0.6rem;
    }
    .main-nav a {
      flex: none; display: flex; align-items: center; gap: 0.6rem;
      padding: 0.6rem 0.75rem; border-radius: 8px; font-size: 0.95rem;
    }
    .main-nav a.active { background: var(--primary-soft); }
    main { padding: 1.5rem 2rem; }
  }
</style>
