// Alertes de la maison courante, partagées par l'en-tête (cloche), la page Maintenant et la page
// Alertes. Rechargées toutes les 2 minutes tant que l'application est visible.

import { api } from "./api";
import { fmtValue } from "./format";
import type { AlertEvent } from "./types";

const DAY = 86_400_000;
/** Un pic / creux reste « à voir » pendant ce délai */
export const RECENT = 6 * 3_600_000;

export const alerts = $state({ events: [] as AlertEvent[], loaded: false, error: "" });

export async function loadAlerts(since = Date.now() - 30 * DAY) {
  try {
    alerts.events = await api.alertEvents({ since });
    alerts.loaded = true;
    alerts.error = "";
  } catch (e) {
    // Base pas encore mise à jour (tables absentes) : pas d'alerte, sans bloquer l'application
    alerts.error = e instanceof Error ? e.message : String(e);
  }
}

/** Alerte à voir : non archivée, en cours, ou récente */
export const isCurrent = (e: AlertEvent, now = Date.now()) =>
  !e.archived && (e.ended_at === null || now - e.started_at < RECENT);

export const currentAlerts = () => alerts.events.filter((e) => isCurrent(e));

/** Écart ou variation : toujours signé (« +1,2 °C ») */
const signed = (x: number | null, unit: string) => (x == null ? "–" : `${x >= 0 ? "+" : "−"}${fmtValue(Math.abs(x), unit)}`);

/** Texte court : « > 26 °C », « pic 22,8 °C », « > Salon », « ↓ 1,5 °C/h » */
export function shortText(e: AlertEvent): string {
  const v = (x: number | null) => fmtValue(x, e.unit);
  switch (e.kind) {
    case "gap_above": return `> ${e.ref_place_name ?? "référence"}`;
    case "gap_below": return `< ${e.ref_place_name ?? "référence"}`;
    case "fc_above": return `prévu > ${v(e.threshold)}`;
    case "fc_below": return `prévu < ${v(e.threshold)}`;
    case "rise": return `↑ ${v(e.threshold)}/h`;
    case "fall": return `↓ ${v(e.threshold)}/h`;
    case "above": return `> ${v(e.threshold)}`;
    case "below": return `< ${v(e.threshold)}`;
    case "peak": return `pic ${v(e.value)}`;
    case "silent": return "capteur muet";
    default: return `creux ${v(e.value)}`;
  }
}

const time = (t: number) => {
  const d = new Date(t), today = new Date();
  const hm = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return hm;
  return `${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} ${hm}`;
};

/** Description complète d'une alerte */
export function describe(e: AlertEvent): string {
  const v = (x: number | null) => fmtValue(x, e.unit);
  const what = e.property === "temperature" ? "Température" : e.property === "humidity" ? "Humidité" : e.property;
  if (e.kind === "silent") {
    return e.ended_at === null
      ? `Capteur muet : aucune mesure depuis ${time(e.started_at)} (piles, portée de la passerelle ?)`
      : `Capteur muet de ${time(e.started_at)} à ${time(e.ended_at)}`;
  }
  const period = e.ended_at === null ? `depuis ${time(e.started_at)}` : `de ${time(e.started_at)} à ${time(e.ended_at)}`;
  if (e.kind === "gap_above" || e.kind === "gap_below") {
    const ref = e.ref_place_name ?? "l'emplacement de référence";
    const side = e.kind === "gap_above" ? "plus élevée qu'à" : "plus basse qu'à";
    const by = e.threshold ? ` de plus de ${v(e.threshold)}` : "";
    return `${what} ${side} ${ref}${by} ${period} (écart max ${v(e.value)})`;
  }
  if (e.kind === "fc_above" || e.kind === "fc_below") {
    const side = e.kind === "fc_above" ? "au-dessus de" : "en dessous de";
    const at = e.forecast_at ? ` à partir de ${time(e.forecast_at)}` : "";
    const ext = `${e.kind === "fc_above" ? "max" : "min"} prévu ${v(e.value)}`;
    return e.ended_at === null
      ? `Prévision : ${what.toLowerCase()} ${side} ${v(e.threshold)}${at} (${ext})`
      : `Prévision : ${what.toLowerCase()} ${side} ${v(e.threshold)} annoncée de ${time(e.started_at)} à ${time(e.ended_at)} (${ext})`;
  }
  if (e.kind === "rise" || e.kind === "fall") {
    const dir = e.kind === "rise" ? "Montée" : "Baisse";
    return `${dir} rapide de la ${what.toLowerCase()} : plus de ${v(e.threshold)} par heure ${period} (max ${signed(e.kind === "rise" ? e.value : e.value == null ? null : -e.value, e.unit)}/h)`;
  }
  if (e.kind === "peak" || e.kind === "trough") {
    return `${what} : ${e.kind === "peak" ? "pic" : "creux"} à ${v(e.value)} (${time(e.started_at)})`;
  }
  const side = e.kind === "above" ? "au-dessus de" : "en dessous de";
  const extreme = `${e.kind === "above" ? "max" : "min"} ${v(e.value)}`;
  return e.ended_at === null
    ? `${what} ${side} ${v(e.threshold)} depuis ${time(e.started_at)} (${extreme})`
    : `${what} ${side} ${v(e.threshold)} de ${time(e.started_at)} à ${time(e.ended_at)} (${extreme})`;
}
