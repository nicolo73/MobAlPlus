// Routage par fragment d'URL (#/admin...) : aucune configuration côté hébergeur.

export const routes = {
  "/": "Maintenant",
  "/courbes": "Courbes",
  "/admin": "Tableau de bord",
  "/admin/capteurs": "Capteurs",
  "/admin/emplacements": "Emplacements",
  "/admin/maintenance": "Maintenance",
} as const;

export type Route = keyof typeof routes;

const read = (): Route => {
  const path = location.hash.replace(/^#/, "") || "/";
  return (path in routes ? path : "/") as Route;
};

export const router = $state({ route: read() });

addEventListener("hashchange", () => {
  router.route = read();
  scrollTo(0, 0);
});
