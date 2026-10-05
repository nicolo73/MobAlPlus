// Routage par fragment d'URL (#/admin..., #/lieu/12) : aucune configuration côté hébergeur.

export const routes = {
  "/": "Maintenant",
  "/courbes": "Courbes",
  "/lieu": "Emplacement",
  "/admin": "Tableau de bord",
  "/admin/capteurs": "Capteurs",
  "/admin/emplacements": "Emplacements",
  "/admin/partage": "Partage",
  "/admin/maintenance": "Maintenance",
} as const;

export type Route = keyof typeof routes;

const read = (): { route: Route; param: string | null } => {
  const path = location.hash.replace(/^#/, "").split("?")[0] || "/";
  const m = path.match(/^\/lieu\/([^/]+)$/);
  if (m) return { route: "/lieu", param: decodeURIComponent(m[1]) };
  return { route: (path in routes ? path : "/") as Route, param: null };
};

export const router = $state(read());

addEventListener("hashchange", () => {
  const next = read();
  router.route = next.route;
  router.param = next.param;
  scrollTo(0, 0);
});
