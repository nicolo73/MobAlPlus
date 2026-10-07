// Préparation des points d'une courbe selon le rendu choisi.
//  - « step » (escalier) et « smooth » (lissé) : toutes les mesures ;
//  - « simple » (simplifié) : une seule valeur par palier de valeurs identiques, placée au milieu
//    du palier. Le capteur arrondit au dixième : sans cela, une montée lente dessine des marches
//    même lissée. Les valeurs restent des mesures réelles, seul l'instant est celui du milieu.

import type { Point } from "./types";

export type CurveMode = "step" | "smooth" | "simple";
export type XY = [number, number | null];

/** Coupure de la courbe sur les longues absences de mesure (capteur hors service) */
export const GAP = 48 * 3_600_000;

export function curveData(points: Point[], mode: CurveMode, gap = GAP): XY[] {
  const out: XY[] = [];
  let segment: Point[] = [];
  const flush = () => {
    if (!segment.length) return;
    if (out.length) out.push([out[out.length - 1][0] + 1, null]);
    out.push(...(mode === "simple" ? plateaus(segment) : segment.map((p): XY => [p.ts, p.value])));
    segment = [];
  };
  for (const p of points) {
    if (p.quality === "rejected") continue;
    if (segment.length && p.ts - segment[segment.length - 1].ts > gap) flush();
    segment.push(p);
  }
  flush();
  return out;
}

/** Premier point, milieu de chaque palier, dernier point */
function plateaus(seg: Point[]): XY[] {
  const out: XY[] = [[seg[0].ts, seg[0].value]];
  const push = (ts: number, v: number) => { if (ts > out[out.length - 1][0]) out.push([ts, v]); };
  let start = 0;
  for (let i = 1; i <= seg.length; i++) {
    if (i < seg.length && Math.abs(seg[i].value - seg[start].value) < 1e-9) continue;
    // Le palier dure jusqu'à la mesure suivante (valeur différente), ou jusqu'à la dernière mesure
    const end = i < seg.length ? seg[i].ts : seg[seg.length - 1].ts;
    push(Math.round((seg[start].ts + end) / 2), seg[start].value);
    start = i;
  }
  const last = seg[seg.length - 1];
  push(last.ts, last.value);
  return out;
}

/**
 * Valeur d'une courbe tracée à l'instant `t` (infobulle) : dernière mesure (escalier) ou
 * interpolation entre les points voisins (lissé, simplifié). null hors de la courbe ou dans une coupure.
 */
export function valueAt(data: XY[], t: number, interpolate: boolean, tail = 30 * 60_000): number | null {
  let lo = 0, hi = data.length - 1, i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid][0] <= t) { i = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (i < 0) return null;
  const [x0, y0] = data[i];
  if (y0 === null) return null;
  const next = data[i + 1];
  if (!next || next[1] === null) return t - x0 <= tail ? y0 : null;  // après la dernière mesure
  if (!interpolate || next[0] === x0) return y0;
  return y0 + ((next[1] - y0) * (t - x0)) / (next[0] - x0);
}
