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

/** Texte court : « > 26 °C », « pic 22,8 °C » */
export function shortText(e: AlertEvent): string {
  const v = (x: number | null) => fmtValue(x, e.unit);
  switch (e.kind) {
    case "above": return `> ${v(e.threshold)}`;
    case "below": return `< ${v(e.threshold)}`;
    case "peak": return `pic ${v(e.value)}`;
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
  if (e.kind === "peak" || e.kind === "trough") {
    return `${what} : ${e.kind === "peak" ? "pic" : "creux"} à ${v(e.value)} (${time(e.started_at)})`;
  }
  const side = e.kind === "above" ? "au-dessus de" : "en dessous de";
  const extreme = `${e.kind === "above" ? "max" : "min"} ${v(e.value)}`;
  return e.ended_at === null
    ? `${what} ${side} ${v(e.threshold)} depuis ${time(e.started_at)} (${extreme})`
    : `${what} ${side} ${v(e.threshold)} de ${time(e.started_at)} à ${time(e.ended_at)} (${extreme})`;
}
