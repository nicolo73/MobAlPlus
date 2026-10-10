<script lang="ts">
  import { api } from "./lib/api";
  import { router, routes, type Route } from "./lib/router.svelte";
  import { canEdit, ctx, isOwner, loadContext, resetContext, selectHome } from "./lib/home.svelte";
  import Login from "./pages/Login.svelte";
  import Now from "./pages/Now.svelte";
  import Charts from "./pages/Charts.svelte";
  import Summary from "./pages/Summary.svelte";
  import { listDashboards } from "./lib/dashboards";
  import Dashboard from "./pages/Dashboard.svelte";
  import Devices from "./pages/Devices.svelte";
  import Places from "./pages/Places.svelte";
  import Maintenance from "./pages/Maintenance.svelte";
  import Place from "./pages/PlaceRoute.svelte";
  import Sharing from "./pages/Sharing.svelte";
  import Welcome from "./pages/Welcome.svelte";
  import Data from "./pages/Data.svelte";
  import About from "./pages/About.svelte";
  import Options from "./pages/Options.svelte";
  import Help from "./pages/Help.svelte";
  import Alerts from "./pages/Alerts.svelte";
  import { currentAlerts, loadAlerts } from "./lib/alerts.svelte";
  import { loadWeatherStations } from "./lib/weather-state.svelte";
  import "./lib/display.svelte"; // applique taille du texte et densité dès le démarrage
  import { hasUnseenNews } from "./lib/content";

  let unseen = $state(hasUnseenNews());

  let session = $state<{ email: string } | null | undefined>(undefined);
  let ctxError = $state("");

  async function refreshSession() {
    const next = await api.session();
    ctxError = "";
    if (!next) {
      resetContext();
      session = null;
      return;
    }
    try {
      await loadContext();
    } catch (e) {
      ctxError = e instanceof Error ? e.message : String(e);
    }
    session = next;
  }
  refreshSession();
  api.onAuthChange(refreshSession);

  // Alertes de la maison courante : rechargées au changement de maison et toutes les 2 minutes
  const bell = $derived(currentAlerts());
  const bellWarn = $derived(bell.some((e) => e.level === "warning"));
  // Connexion (et non chaque renouvellement de session, qui remplace l'objet session)
  const loggedIn = $derived(!!session);
  $effect(() => {
    if (!loggedIn || ctx.homeId === null) return;
    loadAlerts();
    loadWeatherStations(ctx.homeId);
    const t = setInterval(() => document.visibilityState === "visible" && router.route !== "/alertes" && loadAlerts(), 120_000);
    return () => clearInterval(t);
  });

  // Téléphone (barre de navigation en bas) : menu Données masqué (page ouverte depuis Admin)
  const narrowQuery = matchMedia("(max-width: 899px)");
  let narrow = $state(narrowQuery.matches);
  narrowQuery.addEventListener("change", () => (narrow = narrowQuery.matches));

  const isAdminRoute = $derived(router.route.startsWith("/admin"));
  const main: { href: Route; label: string; icon: string; wide?: boolean }[] = [
    { href: "/", label: "Maintenant", icon: "M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 8v4l3 2" },
    { href: "/synthese", label: "Synthèse", icon: "M4 4h16v9H4zM4 13l4-4 3 2 4-4 5 4M4 17h7M4 20h5M15 17h5M15 20h3" },
    { href: "/donnees", label: "Données", icon: "M12 4v11m0 0l-4-4m4 4l4-4M5 20h14", wide: true },
    { href: "/admin", label: "Admin", icon: "M4 6h16M4 12h16M4 18h10" },
    { href: "/aide", label: "Aide", icon: "M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" },
  ];
  /** Onglets d'administration accessibles au compte, selon ses droits dans la maison courante */
  const adminTabs = $derived(([
    ["/admin", ctx.platformAdmin],
    ["/admin/capteurs", canEdit()],
    ["/admin/emplacements", canEdit()],
    ["/admin/partage", isOwner()],
    ["/admin/maintenance", ctx.platformAdmin],
  ] as [Route, boolean][]).filter(([, ok]) => ok).map(([r]) => r));
  // « Admin » ouvre le premier onglet accessible
  const adminRoute = $derived(adminTabs.includes(router.route) ? router.route : adminTabs[0]);
  /** Rubrique Admin : sur téléphone, elle donne aussi accès à la page Données (lecture comprise) */
  const showAdmin = $derived(adminTabs.length > 0 || narrow);
  const adminActive = $derived(isAdminRoute || (narrow && router.route === "/donnees"));

  // Téléphone : glisser horizontalement passe de Maintenant aux synthèses, puis d'une synthèse à la suivante
  function swipeTarget(dir: "left" | "right"): string | null {
    const ids = listDashboards(ctx.homeId).map((d) => d.id);
    if (router.route === "/") return dir === "left" ? `/synthese/${encodeURIComponent(ids[0])}` : null;
    if (router.route !== "/synthese") return null;
    const i = Math.max(0, ids.indexOf(router.param ?? ids[0]));
    const j = dir === "left" ? i + 1 : i - 1;
    return j < 0 ? "/" : j < ids.length ? `/synthese/${encodeURIComponent(ids[j])}` : null;
  }
  let touch: { x: number; y: number; t: number } | null = null;
  function onTouchStart(e: TouchEvent) {
    const target = e.target as HTMLElement;
    // Pas depuis une courbe (curseur), un champ ou une zone qui défile horizontalement
    touch = !narrow || e.touches.length !== 1 || (router.route !== "/" && router.route !== "/synthese")
      || target.closest(".box, input, select, textarea, .table-wrap, .tabs, [data-noswipe]")
      ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }
  function onTouchEnd(e: TouchEvent) {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
    const fast = Date.now() - touch.t < 700;
    touch = null;
    if (!fast || Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
    const to = swipeTarget(dx < 0 ? "left" : "right");
    if (to) location.hash = "#" + to;
  }
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
      {#if ctx.homes.length > 1}
        <select class="home" aria-label="Maison" value={ctx.homeId}
                onchange={(e) => selectHome(Number((e.currentTarget as HTMLSelectElement).value))}>
          {#each ctx.homes as h (h.id)}<option value={h.id}>{h.name}</option>{/each}
        </select>
      {:else if ctx.homes.length === 1}
        <span class="home-name">{ctx.homes[0].name}</span>
      {/if}
      <span class="spacer"></span>
      <span class="user muted">{session.email}</span>
      <a href="#/alertes" class="about" class:active={router.route === "/alertes"}
         aria-label={bell.length ? `Alertes (${bell.length})` : "Alertes"} title="Alertes">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 21h4" /></svg>
        {#if bell.length}<span class="count" class:warn={bellWarn}>{bell.length > 9 ? "9+" : bell.length}</span>{/if}
      </a>
      <a href="#/options" class="about" class:active={router.route === "/options"} aria-label="Options d'affichage"
         title="Options d'affichage">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
      </a>
      <a href="#/a-propos" class="about" class:active={router.route === "/a-propos"}
         aria-label={unseen ? "À propos (nouveautés)" : "À propos"} title="À propos, aide et nouveautés">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
        {#if unseen}<span class="news-dot" aria-hidden="true"></span>{/if}
      </a>
      <button class="link" onclick={() => api.signOut()}>Déconnexion</button>
    </header>

    <nav class="main-nav" aria-label="Navigation principale">
      {#each main.filter((m) => (m.href !== "/admin" || showAdmin) && !(m.wide && narrow)) as item (item.href)}
        {@const active = item.href === "/admin" ? adminActive
          : item.href === "/" ? router.route === "/" || router.route === "/lieu"
          : item.href === "/synthese" ? router.route === "/synthese" || router.route === "/courbes" : router.route === item.href}
        <a href={"#" + item.href} class:active aria-current={active ? "page" : undefined}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={item.icon} /></svg>
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>

    <main ontouchstart={onTouchStart} ontouchend={onTouchEnd}>
      {#if ctxError}
        <div class="notice err" style="margin-bottom:1rem">Impossible de lire les droits du compte : {ctxError}</div>
      {:else if !ctx.homes.length}
        <Welcome />
      {:else}
        {#key ctx.homeId}
          {#if isAdminRoute || adminActive}
            <nav class="tabs" aria-label="Administration">
              {#each adminTabs as tab (tab)}
                <a href={"#" + tab} class:active={isAdminRoute && adminRoute === tab}>{routes[tab]}</a>
              {/each}
              {#if narrow}<a href="#/donnees" class:active={router.route === "/donnees"}>Données</a>{/if}
            </nav>
          {/if}
          {#if isAdminRoute}
            {#if !adminRoute}
              <div class="card notice warn">Vous consultez cette maison en lecture : rien à administrer.
                {#if narrow}Export des mesures : onglet <a href="#/donnees">Données</a>.{/if}</div>
            {:else}
              {#if adminRoute === "/admin"}<Dashboard />
              {:else if adminRoute === "/admin/capteurs"}<Devices />
              {:else if adminRoute === "/admin/emplacements"}<Places />
              {:else if adminRoute === "/admin/partage"}<Sharing />
              {:else}<Maintenance />{/if}
            {/if}
          {:else if router.route === "/courbes"}
            {#key router.query.get("d")}<Charts />{/key}
          {:else if router.route === "/synthese"}
            {#key router.param}<Summary dashboardId={router.param} />{/key}
          {:else if router.route === "/alertes"}
            <Alerts />
          {:else if router.route === "/aide"}
            <Help />
          {:else if router.route === "/options"}
            <Options />
          {:else if router.route === "/a-propos"}
            <About onseen={() => (unseen = false)} />
          {:else if router.route === "/donnees"}
            {#key router.query.toString()}<Data />{/key}
          {:else if router.route === "/lieu" && router.param}
            {#key `${router.param}?${router.query}`}<Place placeId={Number(router.param)} />{/key}
          {:else}
            <Now />
          {/if}
        {/key}
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
    /* Rien ne doit élargir la page (sinon le téléphone dézoome, surtout après une rotation) */
    overflow-x: clip;
  }
  header {
    grid-area: header;
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.6rem 1rem; padding-top: max(0.6rem, env(safe-area-inset-top));
    background: var(--surface); border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 10;
  }
  .brand { display: flex; align-items: center; gap: 0.5rem; font-weight: 700; color: var(--text); text-decoration: none; }
  .home { min-height: 2rem; padding: 0.2rem 0.5rem; font-size: 0.9rem; max-width: 45vw; min-width: 0; flex: 0 1 auto; }
  @media (max-width: 600px) { .brand span { display: none; } }
  .home-name { font-size: 0.9rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .about { position: relative; display: inline-flex; color: var(--muted); padding: 0.25rem; border-radius: 6px; }
  .about.active, .about:hover { color: var(--primary); }
  .about svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .news-dot { position: absolute; top: 2px; right: 2px; width: 8px; height: 8px; border-radius: 50%;
              background: var(--primary); box-shadow: 0 0 0 2px var(--surface); }
  .count { position: absolute; top: -4px; right: -6px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
           background: var(--hum); color: #fff; font-size: 0.65rem; font-weight: 700; line-height: 16px; text-align: center;
           box-shadow: 0 0 0 2px var(--surface); }
  .count.warn { background: var(--err); }
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
