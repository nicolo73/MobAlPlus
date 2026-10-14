// Normales saisonnières des stations météo : pour chaque jour de l'année (mois × 100 + jour), minimum
// et maximum « normaux » (moyennes 1991 – 2020, calculées par le serveur). Elles se répètent d'une
// année à l'autre : on les déplie sur les jours de la période affichée.

import type { DayBand } from "./longview";

const DAY = 86_400_000;

export interface NormalDay { md: number; min: number; max: number }

/** Clé « mois × 100 + jour » d'un instant (heure locale) */
export const mdOf = (t: number) => { const d = new Date(t); return (d.getMonth() + 1) * 100 + d.getDate(); };

/** Normale du jour d'un instant (null si inconnue) */
export function normalAt(days: NormalDay[] | undefined, t: number): NormalDay | null {
  if (!days?.length) return null;
  const md = mdOf(t);
  return days.find((d) => d.md === md) ?? null;
}

/** Bandes journalières (à midi, heure locale) des normales sur une période, un jour de marge de chaque côté */
export function normalBands(days: NormalDay[] | undefined, from: number, to: number): DayBand[] {
  if (!days?.length || !(to > from)) return [];
  const byMd = new Map(days.map((d) => [d.md, d]));
  const out: DayBand[] = [];
  const d = new Date(from - DAY);
  d.setHours(12, 0, 0, 0);
  for (; d.getTime() <= to + DAY && out.length < 20_000; d.setDate(d.getDate() + 1)) {
    const n = byMd.get((d.getMonth() + 1) * 100 + d.getDate());
    if (n) out.push({ ts: d.getTime(), min: n.min, max: n.max, avg: (n.min + n.max) / 2 });
  }
  return out;
}
