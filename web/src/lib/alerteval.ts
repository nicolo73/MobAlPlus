// Évaluation des règles d'alerte sur une suite de mesures, comme la base (evaluate_alerts) :
// sert au mode démo et aux tests. Comparaison (écart avec un autre emplacement) et pente
// (variation sur une heure) : dépassement de seuil sur la courbe dérivée. Dépassement : de la première mesure au-delà du seuil jusqu'au
// retour en deçà d'au moins un pas de mesure ; pic / creux : extrême précédé d'une montée d'au moins
// le seuil et suivi d'une baisse d'au moins la moitié (et de deux pas de mesure).

import type { AlertRule, Point } from "./types";

export const PEAK_DEFAULT: Record<string, number> = { temperature: 0.3, humidity: 3 };
export const RESOLUTION: Record<string, number> = { temperature: 0.1, humidity: 1 };
const HOLD = 2 * 3_600_000;
/** Refranchissement moins d'une heure après la fin d'une alerte : la même alerte est rouverte */
const REARM = 3_600_000;
const EPS = 1e-6;

export interface EvalEvent {
  kind: AlertRule["kind"];
  level: AlertRule["level"];
  threshold: number | null;
  started_at: number;
  ended_at: number | null;
  value: number;
}

const HOUR = 3_600_000;

/** Dernière valeur connue à l'instant t (mesures triées), avec son horodatage */
function asOf(pts: Point[], t: number): Point | null {
  let lo = 0, hi = pts.length - 1, out: Point | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].ts <= t) { out = pts[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return out;
}

/**
 * Courbe dérivée d'une règle de comparaison (écart avec la série de référence, dernières valeurs
 * de moins de 3 h) ou de pente (variation depuis la valeur d'il y a une heure), orientée « plus
 * grand = plus d'alerte » : comme alert_derived() dans la base.
 */
export function derivedPoints(pts: Point[], kind: "gap_above" | "gap_below" | "rise" | "fall", ref: Point[] = []): Point[] {
  const gap = kind === "gap_above" || kind === "gap_below";
  const times = [...new Set([...pts.map((p) => p.ts), ...(gap ? ref.map((p) => p.ts) : [])])].sort((a, b) => a - b);
  const out: Point[] = [];
  for (const t of times) {
    const a = asOf(pts, t);
    if (!a || t - a.ts > 3 * HOUR) continue;
    const b = gap ? asOf(ref, t) : asOf(pts, t - HOUR);
    if (!b || t - b.ts > (gap ? 3 : 4) * HOUR) continue;
    const d = kind === "gap_above" || kind === "rise" ? a.value - b.value : b.value - a.value;
    out.push({ ts: t, value: Math.round(d * 1000) / 1000, quality: "ok" });
  }
  return out;
}

/**
 * Alerte sur prévision (fc_above / fc_below) : valeur prévue au-delà du seuil dans les 24 heures
 * suivant `now` ; une alerte en cours, avec l'heure prévue du franchissement et l'extrême prévu.
 */
export function evaluateForecast(forecast: Point[], rule: Omit<AlertRule, "series_id">, now = Date.now()):
    (EvalEvent & { forecast_at: number })[] {
  if (!rule.enabled || rule.threshold == null || (rule.kind !== "fc_above" && rule.kind !== "fc_below")) return [];
  const sign = rule.kind === "fc_above" ? 1 : -1;
  const next = forecast.filter((p) => p.ts > now && p.ts <= now + 24 * HOUR);
  const hit = next.find((p) => sign * (p.value - rule.threshold!) > 0);
  if (!hit) return [];
  const extreme = next.reduce((m, p) => (sign * (p.value - m) > 0 ? p.value : m), next[0].value);
  return [{ kind: rule.kind, level: rule.level, threshold: rule.threshold, started_at: now, ended_at: null, value: extreme,
            forecast_at: hit.ts }];
}

export function evaluateRule(points: Point[], rule: Omit<AlertRule, "series_id">, property: string, now = Date.now(),
                             ref: Point[] = []): EvalEvent[] {
  let pts = points.filter((p) => p.quality !== "rejected");
  const res = RESOLUTION[property] ?? 0;
  const derived = rule.kind === "gap_above" || rule.kind === "gap_below" || rule.kind === "rise" || rule.kind === "fall";
  if (derived) pts = derivedPoints(pts, rule.kind as "rise", ref.filter((p) => p.quality !== "rejected"));
  const sign = rule.kind === "below" || rule.kind === "trough" ? -1 : 1;
  const out: EvalEvent[] = [];
  if (!rule.enabled) return out;

  // Capteur muet : silences de plus de « threshold » heures entre deux mesures, ou jusqu'à maintenant
  if (rule.kind === "silent") {
    const gap = (rule.threshold ?? 3) * 3_600_000;
    for (let i = 0; i < pts.length; i++) {
      const next = i + 1 < pts.length ? pts[i + 1].ts : now;
      if (next - pts[i].ts > gap)
        out.push({ kind: "silent", level: rule.level, threshold: rule.threshold, started_at: pts[i].ts,
                   ended_at: i + 1 < pts.length ? next : null, value: NaN });
    }
    return out;
  }

  if (rule.kind !== "peak" && rule.kind !== "trough") {
    if (rule.threshold == null) return out;
    const t = rule.threshold;
    let open: EvalEvent | null = null;
    for (const p of pts) {
      if (sign * (p.value - t) > 0) {
        const prev = out.at(-1);
        if (!open && prev?.ended_at != null && p.ts - prev.ended_at < REARM) { open = prev; open.ended_at = null; }
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
