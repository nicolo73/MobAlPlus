// Courbes choisies dans la page Courbes (emplacements, moyennes de groupes, couleurs, largeur de la
// période), mémorisées par maison et reprises telles quelles par la page Synthèse.

import { slotColor } from "./colors";
import { averagePoints, type PlaceNode } from "./placetree";
import type { Point, SeriesInfo } from "./types";

const DAY = 86_400_000;
const store = (homeId: number | null) => `mobalplus.charts.${homeId}`;

/** Clé d'une courbe : identifiant de l'emplacement (ses mesures), ou son opposé (moyenne de sa branche) */
export type Slots = Record<number, number>;

export function readSelection(homeId: number | null): { slots: Slots; width: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(store(homeId)) ?? "{}");
    return { slots: saved.slots ?? {}, width: saved.width > 0 ? saved.width : DAY };
  } catch {
    return { slots: {}, width: DAY };
  }
}

export function saveSelection(homeId: number | null, slots: Slots, width: number) {
  try { localStorage.setItem(store(homeId), JSON.stringify({ slots, width })); } catch { /* stockage indisponible */ }
}

export const isParent = (n: PlaceNode) => n.children.length > 0;
export const hasAvg = (n: PlaceNode) => isParent(n) && n.measured.length > 0;

export function validKey(byId: Map<number, PlaceNode>, k: number): boolean {
  const n = byId.get(Math.abs(k));
  return !!n && (k > 0 ? n.series.length > 0 && !isParent(n) : hasAvg(n));
}

export interface Selected { key: number; node: PlaceNode; avg: boolean; name: string; places: number[] }

/**
 * Courbes sélectionnées, dans l'ordre de l'arborescence. `short` : nom court d'une moyenne
 * (« Maison (3) » au lieu de « Maison (moyenne de 3) »).
 */
export function selectedCurves(nodes: PlaceNode[], slots: Slots, short = false): Selected[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return Object.keys(slots).map(Number).filter((k) => validKey(byId, k)).map((key) => {
    const node = byId.get(Math.abs(key))!;
    const avg = key < 0;
    const n = node.measured.length;
    const name = avg && n > 1 ? (short ? `${node.name} (${n})` : `${node.name} (moyenne de ${n})`) : node.name;
    return { key, node, avg, name, places: avg ? node.measured : [node.id] };
  }).sort((a, b) => nodes.indexOf(a.node) - nodes.indexOf(b.node) || b.key - a.key);
}

/** Première visite : les premiers emplacements mesurés (4 au plus, pour garder des courbes lisibles) */
export function defaultSlots(nodes: PlaceNode[]): Slots {
  const out: Slots = {};
  nodes.filter((n) => n.series.length && !isParent(n)).slice(0, 4).forEach((n, i) => (out[n.id] = n.color ?? i));
  return out;
}

/** Numéro de palette d'une courbe : celui choisi pour l'emplacement, sinon l'attribution automatique */
export const slotOf = (byId: Map<number, PlaceNode>, slots: Slots, key: number) => byId.get(Math.abs(key))?.color ?? slots[key] ?? 0;

/** Couleur d'une courbe : personnalisée, sinon celle de la palette */
export const colorOf = (byId: Map<number, PlaceNode>, slots: Slots, key: number, dark: boolean) =>
  byId.get(Math.abs(key))?.custom ?? slotColor(slotOf(byId, slots, key), dark);

/** Séries à charger pour les courbes choisies et les grandeurs affichées */
export function seriesIds(selected: Selected[], seriesByPlace: Map<number, SeriesInfo[]>, visible: string[]): number[] {
  return [...new Set(selected.flatMap((c) => c.places.flatMap((id) => seriesByPlace.get(id) ?? []))
    .filter((s) => visible.includes(s.property)).map((s) => s.id))];
}

/** Points d'une courbe pour une grandeur : mesures de l'emplacement, ou moyenne de la branche */
export function curvePoints(c: Selected, prop: string, seriesByPlace: Map<number, SeriesInfo[]>, data: Map<number, Point[]>): Point[] | null {
  const lists = c.places.flatMap((id) => (seriesByPlace.get(id) ?? []).filter((s) => s.property === prop))
    .map((s) => data.get(s.id) ?? []);
  if (!lists.length) return null;
  return c.avg ? averagePoints(lists) : lists[0];
}

export function groupByPlace(series: SeriesInfo[]): Map<number, SeriesInfo[]> {
  const m = new Map<number, SeriesInfo[]>();
  for (const s of series) m.set(s.place_id, [...(m.get(s.place_id) ?? []), s]);
  return m;
}
