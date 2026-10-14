// Volets repliables des pages (station, prévisions, courbes de chaque grandeur, alertes, mesures,
// capteurs…) : ouvert ou fermé, mémorisé sur l'appareil pour chaque emplacement (clé
// « place.<id>.<volet> » : l'humidité ouverte dehors et repliée dans une chambre ; une station aura
// ses propres volets), pas dans le compte (téléphone et ordinateur n'ont pas la même place).

const STORE = "mobalplus.panels";

export const panels = $state<Record<string, boolean>>({});
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}");
  if (saved && typeof saved === "object") {
    // (clés communes à tous les emplacements de la première version, sans identifiant : ignorées)
    for (const [k, v] of Object.entries(saved)) if (typeof v === "boolean" && /\.\d+\./.test(k)) panels[k] = v;
  }
} catch { /* stockage indisponible : valeurs par défaut */ }

/** Volet ouvert ? (`def` : état par défaut, tant que l'utilisateur ne l'a pas changé) */
export const isOpen = (key: string, def: boolean) => panels[key] ?? def;

export function setOpen(key: string, open: boolean) {
  panels[key] = open;
  try { localStorage.setItem(STORE, JSON.stringify(panels)); } catch { /* ignoré */ }
}

/** Ouvre un volet et l'amène à l'écran (raccourci depuis un autre volet) */
export function reveal(key: string, anchor: string) {
  setOpen(key, true);
  setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}
