// Envoi des notifications d'alertes (logique testable sans Deno ni réseau).

export interface Pending {
  event_id: number;
  kind: "above" | "below" | "peak" | "trough" | "silent" | "gap_above" | "gap_below" | "rise" | "fall" | "fc_above" | "fc_below";
  level: "info" | "warning";
  value: number | null;
  threshold: number | null;
  started_at: string;
  place_id: number;
  place_name: string;
  property: string;
  unit: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Comparaison : emplacement de référence */
  ref_place_name?: string | null;
  /** Alerte sur prévision : heure prévue du franchissement */
  forecast_at?: string | null;
}

export interface Db {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): { delete(): { eq(col: string, v: string): PromiseLike<unknown> } };
}

/** Envoi d'un message ; renvoie le code HTTP du service de notification */
export type Send = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<number>;

const fmt = (v: number | null, unit: string) =>
  v == null ? "–" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: unit === "%" ? 0 : 1 })}${unit === "%" ? " %" : ` ${unit}`}`;

const PROP: Record<string, string> = { temperature: "température", humidity: "humidité" };

/** Titre et texte d'une notification */
const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit" });

export function message(p: Pending): { title: string; body: string } {
  const what = PROP[p.property] ?? p.property;
  const icon = p.level === "warning" ? "⚠️" : "ℹ️";
  const body =
    p.kind === "above" ? `${what} ${fmt(p.value, p.unit)} : au-dessus de ${fmt(p.threshold, p.unit)}`
    : p.kind === "below" ? `${what} ${fmt(p.value, p.unit)} : en dessous de ${fmt(p.threshold, p.unit)}`
    : p.kind === "silent" ? `capteur muet depuis ${new Date(p.started_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} (piles ? portée ?)`
    : p.kind === "gap_above" ? `${what} plus élevée qu'à ${p.ref_place_name ?? "la référence"} (écart ${fmt(p.value, p.unit)})`
    : p.kind === "gap_below" ? `${what} plus basse qu'à ${p.ref_place_name ?? "la référence"} (écart ${fmt(p.value, p.unit)})`
    : p.kind === "fc_above" ? `prévision : ${what} au-dessus de ${fmt(p.threshold, p.unit)}${p.forecast_at ? ` dès ${when(p.forecast_at)}` : ""} (jusqu'à ${fmt(p.value, p.unit)})`
    : p.kind === "fc_below" ? `prévision : ${what} en dessous de ${fmt(p.threshold, p.unit)}${p.forecast_at ? ` dès ${when(p.forecast_at)}` : ""} (jusqu'à ${fmt(p.value, p.unit)})`
    : p.kind === "rise" ? `${what} en hausse rapide : +${fmt(p.value, p.unit)} en une heure`
    : p.kind === "fall" ? `${what} en baisse rapide : −${fmt(p.value, p.unit)} en une heure`
    : p.kind === "peak" ? `pic de ${what} passé (${fmt(p.value, p.unit)}), en baisse`
    : `creux de ${what} passé (${fmt(p.value, p.unit)}), en hausse`;
  return { title: `${icon} ${p.place_name}`, body: body.charAt(0).toUpperCase() + body.slice(1) };
}

export async function runNotify(db: Db, send: Send) {
  await db.rpc("expire_notifications");
  const { data, error } = await db.rpc("pending_notifications");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Pending[];
  let sent = 0, failed = 0;
  const gone = new Set<string>();
  for (const p of rows) {
    if (gone.has(p.endpoint)) continue;
    const m = message(p);
    const payload = JSON.stringify({ ...m, tag: `alerte-${p.event_id}`, url: `#/lieu/${p.place_id}`, level: p.level });
    try {
      const status = await send({ endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } }, payload);
      if (status === 404 || status === 410) gone.add(p.endpoint);  // abonnement expiré
      else if (status >= 400) failed++;
      else sent++;
    } catch {
      failed++;
    }
  }
  for (const endpoint of gone) await db.from("push_subscription").delete().eq("endpoint", endpoint);
  const ids = [...new Set(rows.map((r) => r.event_id))];
  if (ids.length) await db.rpc("mark_notified", { p_ids: ids });
  return { events: ids.length, sent, failed, expired: gone.size };
}
