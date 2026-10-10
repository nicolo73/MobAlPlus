// Pages de synthèse (tableaux de bord) d'une maison : chacune a son nom, ses courbes choisies
// (emplacements, moyennes de groupes, couleurs) et la durée affichée. La page « Courbes » sert à les
// régler. Mémorisées sur l'appareil ; il en reste toujours au moins une.

import type { Slots } from "./chartsel.ts";

const DAY = 86_400_000;
export interface Dashboard { id: string; name: string; slots: Slots; width: number }

const KEY = (homeId: number | null) => `mobalplus.dashboards.${homeId}`;
/** Ancien réglage unique de la page Courbes : repris comme première synthèse */
const OLD_KEY = (homeId: number | null) => `mobalplus.charts.${homeId}`;

function read(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}

function valid(d: unknown): d is Dashboard {
  const x = d as Dashboard;
  return !!x && typeof x.id === "string" && typeof x.name === "string" && typeof x.slots === "object" && x.slots !== null;
}

export function listDashboards(homeId: number | null): Dashboard[] {
  const saved = read(KEY(homeId));
  if (Array.isArray(saved)) {
    const list = saved.filter(valid).map((d) => ({ ...d, width: d.width > 0 ? d.width : DAY }));
    if (list.length) return list;
  }
  const old = read(OLD_KEY(homeId)) as { slots?: Slots; width?: number } | null;
  return [{ id: "principale", name: "Synthèse", slots: old?.slots ?? {}, width: old?.width && old.width > 0 ? old.width : DAY }];
}

export function saveDashboards(homeId: number | null, list: Dashboard[]) {
  try { localStorage.setItem(KEY(homeId), JSON.stringify(list)); } catch { /* stockage indisponible */ }
}

/** Synthèse demandée, sinon la première */
export function getDashboard(homeId: number | null, id: string | null | undefined): Dashboard {
  const list = listDashboards(homeId);
  return list.find((d) => d.id === id) ?? list[0];
}

export function updateDashboard(homeId: number | null, id: string, patch: Partial<Omit<Dashboard, "id">>) {
  const list = listDashboards(homeId);
  saveDashboards(homeId, list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
}

/** Nouvelle synthèse (sans courbe : à régler) ; renvoie son identifiant */
export function addDashboard(homeId: number | null, name?: string): string {
  const list = listDashboards(homeId);
  const id = Date.now().toString(36);
  let n = list.length + 1;
  while (list.some((d) => d.name === `Synthèse ${n}`)) n++;
  saveDashboards(homeId, [...list, { id, name: name ?? `Synthèse ${n}`, slots: {}, width: DAY }]);
  return id;
}

/** Supprime une synthèse (refusé pour la dernière) ; renvoie la synthèse à afficher ensuite */
export function removeDashboard(homeId: number | null, id: string): string {
  const list = listDashboards(homeId);
  if (list.length <= 1) return list[0].id;
  const i = list.findIndex((d) => d.id === id);
  const next = list.filter((d) => d.id !== id);
  saveDashboards(homeId, next);
  return next[Math.max(0, i - 1)].id;
}
