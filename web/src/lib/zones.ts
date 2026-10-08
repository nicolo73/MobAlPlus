// Mise en évidence des valeurs d'après les seuils d'alerte haut / bas de leur série (les alertes de
// pic, creux, comparaison ou pente ne comptent pas) :
//  - zone : au-delà du seuil « important » haut (hot2), entre info et important haut (hot1), normale,
//    sous le seuil info bas (cold1), sous le seuil important bas (cold2) ;
//  - ton de la flèche de tendance : aggravation (on monte près ou au-delà du seuil haut, on baisse
//    près ou en deçà du seuil bas), ou retour vers la normale (pic ou creux passé dans la zone à risque).

import type { AlertRule } from "./types";
import type { Trend } from "./trend";

export type Zone = "hot2" | "hot1" | "cold1" | "cold2";
export type Tone = "worse-hot" | "worse-cold" | "better";

/** Marge « proche du seuil », par grandeur */
const NEAR: Record<string, number> = { temperature: 1, humidity: 5 };

interface Limits { hiInfo: number | null; hiWarn: number | null; loInfo: number | null; loWarn: number | null }

function limits(rules: AlertRule[]): Limits {
  const th = (kind: "above" | "below", level: "info" | "warning") =>
    rules.find((r) => r.kind === kind && r.level === level && r.enabled && r.threshold != null)?.threshold ?? null;
  return { hiInfo: th("above", "info"), hiWarn: th("above", "warning"), loInfo: th("below", "info"), loWarn: th("below", "warning") };
}

/** Zone d'une valeur ; null : entre les seuils (ou aucun seuil) */
export function zoneOf(value: number | null, rules: AlertRule[]): Zone | null {
  if (value === null) return null;
  const l = limits(rules);
  if (l.hiWarn !== null && value > l.hiWarn) return "hot2";
  if (l.hiInfo !== null && value > l.hiInfo) return "hot1";
  if (l.loWarn !== null && value < l.loWarn) return "cold2";
  if (l.loInfo !== null && value < l.loInfo) return "cold1";
  return null;
}

/** Ton de la flèche de tendance ; null : rien de particulier */
export function trendTone(value: number | null, trend: Trend | null, rules: AlertRule[], property: string): Tone | null {
  if (value === null || !trend) return null;
  const l = limits(rules);
  const near = NEAR[property] ?? 1;
  // Premier seuil rencontré en montant (ou en descendant)
  const hi = [l.hiInfo, l.hiWarn].filter((x): x is number => x !== null);
  const lo = [l.loInfo, l.loWarn].filter((x): x is number => x !== null);
  const nearHigh = hi.length > 0 && value >= Math.min(...hi) - near;
  const nearLow = lo.length > 0 && value <= Math.max(...lo) + near;
  if (trend.reversal) {
    // Pic passé : on redescend ; creux passé : on remonte
    if (trend.reversal.kind === "peak") return nearHigh ? "better" : nearLow ? "worse-cold" : null;
    return nearLow ? "better" : nearHigh ? "worse-hot" : null;
  }
  if (trend.level > 0 && nearHigh) return "worse-hot";
  if (trend.level < 0 && nearLow) return "worse-cold";
  return null;
}

/** Règles de chaque série */
export function rulesBySeries(rules: AlertRule[]): Map<number, AlertRule[]> {
  const m = new Map<number, AlertRule[]>();
  for (const r of rules) m.set(r.series_id, [...(m.get(r.series_id) ?? []), r]);
  return m;
}
