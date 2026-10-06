// Tendance d'une grandeur : flèche plus ou moins inclinée selon la pente récente, et inversion
// (on vient de passer un pic ou un creux), cas important : fermer la fenêtre, etc.
//
// - pente : droite des moindres carrés sur la dernière fenêtre (1 h par défaut), en tenant compte
//   de la valeur en cours au début de la fenêtre (le capteur n'enregistre qu'aux changements) ;
// - inclinaison : pente rapportée à l'amplitude des dernières 24 h (une même pente compte plus
//   un jour calme qu'un jour de grand écart), avec une amplitude minimale par grandeur ;
// - inversion : maximum (ou minimum) récent, dépassé d'au moins le seuil de part et d'autre.

import type { Point } from "./types";

export interface TrendOptions {
  /** Fenêtre de calcul de la pente, en minutes */
  windowMin: number;
  /** Multiplicateur des seuils d'inclinaison (< 1 : flèches plus sensibles) */
  sensitivity: number;
  /** Écart minimal de part et d'autre d'un pic pour parler d'inversion, par grandeur */
  reversal: Record<string, number>;
  /** Durée pendant laquelle une inversion reste signalée, en minutes */
  holdMin: number;
}

export const TREND_DEFAULTS: TrendOptions = {
  windowMin: 60, sensitivity: 1, reversal: { temperature: 0.3, humidity: 3 }, holdMin: 120,
};

/** Amplitude journalière minimale prise en compte (évite des flèches nerveuses un jour très calme) */
const MIN_AMPLITUDE: Record<string, number> = { temperature: 1, humidity: 5 };
const DEFAULT_REVERSAL = 0.5;
/** Seuils d'inclinaison : part de l'amplitude journalière par heure */
const LEVELS = [0.03, 0.07, 0.12];
const H = 3_600_000;

export interface Trend {
  /** -3 (forte baisse) … 0 (stable) … +3 (forte hausse) */
  level: number;
  /** Pente, en unité par heure */
  slope: number;
  reversal?: { kind: "peak" | "trough"; ts: number; value: number };
}

export function computeTrend(points: Point[], property: string, opts: TrendOptions = TREND_DEFAULTS): Trend | null {
  const pts = points.filter((p) => p.quality !== "rejected").sort((a, b) => a.ts - b.ts);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const t0 = last.ts - opts.windowMin * 60_000;

  // Pente : points de la fenêtre, plus la valeur en cours à son début
  const win = pts.filter((p) => p.ts >= t0);
  const before = pts.filter((p) => p.ts < t0).at(-1);
  const xy = [...(before ? [[t0, before.value]] : []), ...win.map((p) => [p.ts, p.value])];
  let slope = 0;
  if (xy.length >= 2) {
    const n = xy.length;
    const mx = xy.reduce((s, [x]) => s + x, 0) / n, my = xy.reduce((s, [, y]) => s + y, 0) / n;
    let num = 0, den = 0;
    for (const [x, y] of xy) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
    slope = den ? (num / den) * H : 0;
  }

  // Inclinaison relative à l'amplitude des dernières 24 h
  const day = pts.filter((p) => p.ts >= last.ts - 24 * H);
  let min = Infinity, max = -Infinity;
  for (const p of day) { min = Math.min(min, p.value); max = Math.max(max, p.value); }
  const amplitude = Math.max(max - min, MIN_AMPLITUDE[property] ?? 1);
  const r = Math.abs(slope) / amplitude;
  const steps = LEVELS.filter((t) => r >= t * opts.sensitivity).length;
  const level = Math.sign(slope) * steps;

  return { level, slope, reversal: findReversal(pts, opts.reversal[property] ?? DEFAULT_REVERSAL, opts.holdMin * 60_000) };
}

/** Pic ou creux passé depuis moins de `hold`, avec un écart d'au moins `threshold` de part et d'autre */
function findReversal(pts: Point[], threshold: number, hold: number): Trend["reversal"] {
  const last = pts[pts.length - 1];
  const recent = pts.filter((p) => p.ts >= last.ts - hold);
  const eps = 1e-9;
  let found: Trend["reversal"];
  for (const kind of ["peak", "trough"] as const) {
    const sign = kind === "peak" ? 1 : -1;
    // Extrême le plus récent (fin du palier : c'est là que la tendance s'inverse)
    let ext: Point | undefined;
    for (const p of recent) if (!ext || sign * (p.value - ext.value) >= -eps) ext = p;
    if (!ext || ext === last) continue;
    const after = sign * (ext.value - last.value);
    // Écart avant le pic, sur une durée comparable
    const prior = pts.filter((p) => p.ts >= ext!.ts - hold && p.ts <= ext!.ts);
    const lowest = prior.reduce((m, p) => Math.min(m, sign * p.value), Infinity);
    const beforeGap = sign * ext.value - lowest;
    if (after >= threshold - eps && beforeGap >= threshold - eps && (!found || ext.ts > found.ts))
      found = { kind, ts: ext.ts, value: ext.value };
  }
  return found;
}
