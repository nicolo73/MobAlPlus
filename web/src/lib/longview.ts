// Courbes sur le temps long : au-delà d'une semaine, les oscillations jour / nuit rendent une courbe
// illisible. On trace alors, par jour, une bande entre le minimum et le maximum (calculés par la base),
// avec des repères verticaux à la semaine, au mois ou à l'année, et seulement les interruptions de
// mesure assez longues pour la période affichée.

import type { Window } from "./period";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Minimum, maximum et moyenne d'un jour ; `ts` : midi (heure locale) du jour */
export interface DayBand { ts: number; min: number; max: number; avg: number }

/**
 * Passage progressif de la courbe détaillée à la bande min – max, selon la largeur visible (en jours,
 * réglable dans Options) :
 * - jusqu'à `bandFrom` : courbe seule ;
 * - de `bandFrom` à `bandFull` : courbe (interactive), bande en fond de plus en plus visible ;
 * - de `bandFull` à `rawUntil` : bande (interactive), courbe en fond de plus en plus effacée ;
 * - au-delà de `rawUntil` : bande seule.
 * Ce qui est en fond n'est pas interactif (ni infobulle ni mise en évidence).
 */
export interface LongView { bandFrom: number; bandFull: number; rawUntil: number }
export const LONGVIEW_DEFAULTS: LongView = { bandFrom: 3, bandFull: 7, rawUntil: 30 };

/** Seuils cohérents (croissants, positifs) */
export function normLongView(o: Partial<LongView> | undefined): LongView {
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : d);
  const bandFrom = n(o?.bandFrom, LONGVIEW_DEFAULTS.bandFrom);
  const bandFull = Math.max(bandFrom, n(o?.bandFull, LONGVIEW_DEFAULTS.bandFull));
  const rawUntil = Math.max(bandFull, n(o?.rawUntil, LONGVIEW_DEFAULTS.rawUntil));
  return { bandFrom, bandFull, rawUntil };
}

const widthDays = ([s, e]: Window) => (e - s) / DAY;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Données utiles pour une fenêtre : mesures détaillées et / ou bandes journalières */
export function needs(w: Window, o: LongView): { raw: boolean; band: boolean } {
  const d = widthDays(w);
  return { raw: d <= o.rawUntil, band: d > o.bandFrom };
}

/** La bande est la représentation principale (interactive) */
export const bandMain = (w: Window, o: LongView) => widthDays(w) > o.bandFull;

/** Clé des données à charger : un changement impose un rechargement */
export function viewKey(w: Window, o: LongView): string {
  const n = needs(w, o);
  return `${n.raw ? "r" : ""}${n.band ? "b" : ""}`;
}

/**
 * Présence de la représentation de fond, de 0 (absente) à 1 : la bande avant `bandFull`,
 * la courbe détaillée après
 */
export function ghostLevel(w: Window, o: LongView): number {
  const d = widthDays(w);
  if (d <= o.bandFull) return o.bandFull > o.bandFrom ? clamp01((d - o.bandFrom) / (o.bandFull - o.bandFrom)) : 0;
  return o.rawUntil > o.bandFull ? clamp01(1 - (d - o.bandFull) / (o.rawUntil - o.bandFull)) : 0;
}

/** Repères à la journée jusqu'à cette largeur */
const DAY_SCALE_UNTIL = 8 * DAY;

/** Midi (heure locale) d'un jour « AAAA-MM-JJ » */
export function dayNoon(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

/** Bande moyenne de plusieurs courbes (groupe) : moyenne des minimums et des maximums de chaque jour */
export function averageBands(lists: DayBand[][]): DayBand[] {
  const days = new Map<number, DayBand[]>();
  for (const l of lists) for (const b of l) days.set(b.ts, [...(days.get(b.ts) ?? []), b]);
  const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
  return [...days.entries()].sort(([a], [b]) => a - b).map(([ts, bs]) => ({
    ts, min: mean(bs.map((b) => b.min)), max: mean(bs.map((b) => b.max)), avg: mean(bs.map((b) => b.avg)),
  }));
}

/** Au-delà de cette largeur visible : une bande par semaine (moyennes des minimums et des maximums) */
export const WEEKLY_FROM = 100 * DAY;

/**
 * Bandes hebdomadaires : moyenne des minimums et des maximums journaliers de chaque semaine (du
 * lundi au dimanche), placée au jeudi midi ; comme les « normales » des sites météo, sans le
 * zigzag d'un jour à l'autre sur une année.
 */
export function weeklyBands(bands: DayBand[]): DayBand[] {
  const weeks = new Map<number, DayBand[]>();
  for (const b of bands) {
    const d = new Date(b.ts);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);   // jeudi de la semaine
    d.setHours(12, 0, 0, 0);
    weeks.set(d.getTime(), [...(weeks.get(d.getTime()) ?? []), b]);
  }
  const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
  return [...weeks.entries()].sort(([a], [b]) => a - b).map(([ts, bs]) => ({
    ts, min: mean(bs.map((b) => b.min)), max: mean(bs.map((b) => b.max)), avg: mean(bs.map((b) => b.avg)),
  }));
}

/**
 * Durée sans mesure au-delà de laquelle on coupe la courbe ou on grise une période :
 * - jamais moins que `silence` (seuil « capteur muet », 3 h par défaut) ;
 * - au moins 2,5 intervalles de réduction : la base ne renvoie qu'environ `maxPoints` points (un
 *   minimum et un maximum par intervalle), deux points gardés peuvent donc être éloignés sans
 *   qu'aucune mesure ne manque ;
 * - au moins 1/40 de la fenêtre visible : sur un mois, une coupure de quelques heures ne se voit pas.
 */
export function gapThreshold(silence: number, loaded: Window, window: Window, maxPoints = 1000): number {
  const bucket = (loaded[1] - loaded[0]) / Math.max(1, maxPoints / 2);
  return Math.max(silence, 2.5 * bucket, (window[1] - window[0]) / 40);
}

export type Scale = "day" | "week" | "month" | "year";

/** Repères verticaux adaptés à la fenêtre visible */
export function scaleOf([s, e]: Window): Scale {
  const w = e - s;
  return w <= DAY_SCALE_UNTIL ? "day" : w <= 62 * DAY ? "week" : w <= 730 * DAY ? "month" : "year";
}

/** Instants des repères (minuit local) : chaque jour, chaque lundi, chaque 1er du mois ou chaque 1er janvier */
export function gridLines(from: number, to: number, scale: Scale): number[] {
  const out: number[] = [];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  if (scale === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (scale === "month") d.setDate(1);
  if (scale === "year") d.setMonth(0, 1);
  const next = () => {
    if (scale === "day") d.setDate(d.getDate() + 1);
    else if (scale === "week") d.setDate(d.getDate() + 7);
    else if (scale === "month") d.setMonth(d.getMonth() + 1);
    else d.setFullYear(d.getFullYear() + 1);
  };
  while (d.getTime() <= from) next();
  for (; d.getTime() < to && out.length < 500; next()) out.push(d.getTime());
  return out;
}
