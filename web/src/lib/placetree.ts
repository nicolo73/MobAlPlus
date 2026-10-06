// Emplacements imbriqués (emplacement parent / sous-emplacements) et courbes moyennes d'un groupe.

import { GAP } from "./curve.ts";
import type { Place, Point, SeriesInfo } from "./types";

export interface PlaceNode {
  id: number;
  name: string;
  depth: number;
  /** Séries propres de l'emplacement (capteurs qui y sont affectés) */
  series: SeriesInfo[];
  /** Couleur choisie (numéro de palette), null = automatique */
  color: number | null;
  /** Couleur personnalisée (#rrggbb), prioritaire */
  custom: string | null;
  /** Emplacements mesurés de la branche (lui compris) : de quoi calculer une moyenne */
  measured: number[];
  children: PlaceNode[];
}

/** Ordre des emplacements de même parent : ordre choisi, puis nom */
export const placeOrder = (a: Place, b: Place) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, "fr");
export const sortPlaces = (places: Place[]) => [...places].sort(placeOrder);

/** Vrai si `id` est `ancestor` ou l'un de ses sous-emplacements */
export function isWithin(places: Place[], id: number | null, ancestor: number): boolean {
  const parent = new Map(places.map((p) => [p.id, p.parent_id]));
  const seen = new Set<number>();
  for (let cur = id; cur !== null && cur !== undefined && !seen.has(cur); cur = parent.get(cur) ?? null) {
    if (cur === ancestor) return true;
    seen.add(cur);
  }
  return false;
}

/** Arbre des emplacements, dans l'ordre choisi à chaque niveau */
export function placeTree(places: Place[], series: SeriesInfo[]): PlaceNode[] {
  const byPlace = new Map<number, SeriesInfo[]>();
  for (const s of series) byPlace.set(s.place_id, [...(byPlace.get(s.place_id) ?? []), s]);
  const ids = new Set(places.map((p) => p.id));
  // Série d'un emplacement inconnu de la liste (ne devrait pas arriver) : emplacement racine
  const all = [...places];
  for (const s of series) if (!ids.has(s.place_id)) { ids.add(s.place_id); all.push({ id: s.place_id, code: "", name: s.place_name, parent_id: null, kind: null, exposure: s.exposure }); }

  const build = (parent: number | null, depth: number, seen: Set<number>): PlaceNode[] =>
    all.filter((p) => (parent === null ? p.parent_id === null || !ids.has(p.parent_id) : p.parent_id === parent) && !seen.has(p.id))
      .sort(placeOrder)
      .map((p) => {
        const children = build(p.id, depth + 1, new Set([...seen, p.id]));
        const own = byPlace.get(p.id) ?? [];
        return { id: p.id, name: p.name, depth, series: own, children, color: p.color_slot ?? null, custom: p.color ?? null,
                 measured: [...(own.length ? [p.id] : []), ...children.flatMap((c) => c.measured)] };
      });
  return build(null, 0, new Set());
}

/** Tous les nœuds, en profondeur d'abord */
export function flatten(nodes: PlaceNode[]): PlaceNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

/**
 * Moyenne de plusieurs courbes : à chaque instant où l'une d'elles change, moyenne des dernières
 * valeurs connues (une courbe muette depuis plus de `gap`, ou pas encore commencée, est ignorée).
 */
export function averagePoints(lists: Point[][], gap = GAP): Point[] {
  const clean = lists.map((l) => l.filter((p) => p.quality !== "rejected"));
  const times = [...new Set(clean.flatMap((l) => l.map((p) => p.ts)))].sort((a, b) => a - b);
  const idx = clean.map(() => -1);
  const out: Point[] = [];
  for (const t of times) {
    let sum = 0, n = 0;
    clean.forEach((l, k) => {
      while (idx[k] + 1 < l.length && l[idx[k] + 1].ts <= t) idx[k]++;
      const p = l[idx[k]];
      if (p && t - p.ts <= gap) { sum += p.value; n++; }
    });
    if (n) out.push({ ts: t, value: Math.round((sum / n) * 100) / 100, quality: "ok" });
  }
  return out;
}
