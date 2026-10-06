// Évaluation des règles d'alerte sur une suite de mesures, comme la base (evaluate_alerts) :
// sert au mode démo et aux tests. Dépassement : de la première mesure au-delà du seuil jusqu'au
// retour en deçà d'au moins un pas de mesure ; pic / creux : extrême précédé d'une montée d'au moins
// le seuil et suivi d'une baisse d'au moins la moitié (et de deux pas de mesure).

import type { AlertRule, Point } from "./types";

export const PEAK_DEFAULT: Record<string, number> = { temperature: 0.3, humidity: 3 };
export const RESOLUTION: Record<string, number> = { temperature: 0.1, humidity: 1 };
const HOLD = 2 * 3_600_000;
const EPS = 1e-6;

export interface EvalEvent {
  kind: AlertRule["kind"];
  level: AlertRule["level"];
  threshold: number | null;
  started_at: number;
  ended_at: number | null;
  value: number;
}

export function evaluateRule(points: Point[], rule: Omit<AlertRule, "series_id">, property: string): EvalEvent[] {
  const pts = points.filter((p) => p.quality !== "rejected");
  const res = RESOLUTION[property] ?? 0;
  const sign = rule.kind === "above" || rule.kind === "peak" ? 1 : -1;
  const out: EvalEvent[] = [];
  if (!rule.enabled) return out;

  if (rule.kind === "above" || rule.kind === "below") {
    if (rule.threshold == null) return out;
    const t = rule.threshold;
    let open: EvalEvent | null = null;
    for (const p of pts) {
      if (sign * (p.value - t) > 0) {
        if (!open) out.push(open = { kind: rule.kind, level: rule.level, threshold: t, started_at: p.ts, ended_at: null, value: p.value });
        else open.value = sign > 0 ? Math.max(open.value, p.value) : Math.min(open.value, p.value);
      } else if (open && sign * (t - p.value) >= res - EPS) {
        open.ended_at = p.ts;
        open = null;
      }
    }
    return out;
  }

  // Pics / creux : extrême de sa fenêtre (± 2 h), montée avant et baisse après suffisantes
  const t = rule.threshold ?? PEAK_DEFAULT[property] ?? 0.5;
  const after = Math.max(t / 2, 2 * res);
  let lastAt = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.ts - lastAt < HOLD) continue;
    let isExt = true, low = Infinity, drop = 0;
    for (let j = i - 1; j >= 0 && pts[j].ts >= p.ts - HOLD; j--) {
      if (sign * (pts[j].value - p.value) > EPS) { isExt = false; break; }
      low = Math.min(low, sign * pts[j].value);
    }
    if (!isExt) continue;
    for (let j = i + 1; j < pts.length && pts[j].ts <= p.ts + HOLD; j++) {
      if (sign * (pts[j].value - p.value) > -EPS) { if (sign * (pts[j].value - p.value) > EPS) { isExt = false; break; } continue; }
      drop = Math.max(drop, sign * (p.value - pts[j].value));
    }
    // fin de palier : la mesure suivante doit être plus basse
    if (!isExt || (i + 1 < pts.length && Math.abs(pts[i + 1].value - p.value) < EPS)) continue;
    if (sign * p.value - low >= t - EPS && drop >= after - EPS) {
      out.push({ kind: rule.kind, level: rule.level, threshold: t, started_at: p.ts, ended_at: p.ts, value: p.value });
      lastAt = p.ts;
    }
  }
  return out;
}
