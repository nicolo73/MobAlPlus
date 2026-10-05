// Routage par fragment d'URL (#/admin..., #/lieu/12, #/donnees?lieu=3) : aucune configuration côté hébergeur.

export const routes = {
  "/": "Maintenant",
  "/courbes": "Courbes",
  "/donnees": "Données",
  "/a-propos": "À propos",
  "/options": "Options",
  "/lieu": "Emplacement",
  "/admin": "Tableau de bord",
  "/admin/capteurs": "Capteurs",
  "/admin/emplacements": "Emplacements",
  "/admin/partage": "Partage",
  "/admin/maintenance": "Maintenance",
} as const;

export type Route = keyof typeof routes;

const read = (): { route: Route; param: string | null; query: URLSearchParams } => {
  const [path, qs] = (location.hash.replace(/^#/, "") || "/").split("?");
  const query = new URLSearchParams(qs ?? "");
  const m = path.match(/^\/lieu\/([^/]+)$/);
  if (m) return { route: "/lieu", param: decodeURIComponent(m[1]), query };
  return { route: (path in routes ? path : "/") as Route, param: null, query };
};

export const router = $state(read());

addEventListener("hashchange", () => {
  const next = read();
  router.route = next.route;
  router.param = next.param;
  router.query = next.query;
  scrollTo(0, 0);
});
