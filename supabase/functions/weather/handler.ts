// Collecte de la météo publique (Open-Meteo) des stations météo virtuelles, côté serveur : un appel
// par station toutes les 30 minutes, quel que soit le nombre d'utilisateurs ; les mesures sont
// enregistrées comme celles des capteurs (ingest_readings).
//  - plus de 80 jours à rattraper (création d'une station) : archives ERA5, données horaires ;
//  - puis l'API de prévision : heures passées (past_days) et conditions actuelles (au quart d'heure).

export interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}
export type FetchJson = (url: string) => Promise<unknown>;

const DAY = 86_400_000;
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const VARS = "temperature_2m,relative_humidity_2m";
export const HEADERS = ["Température", "Humidité"];

interface Row { ts: string; v: (number | null)[] }

const utc = (t: string) => Date.parse(t.endsWith("Z") ? t : `${t}Z`);
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Données horaires (et actuelles) d'une réponse Open-Meteo → lignes {ts, v: [température, humidité]} */
export function rowsOf(json: unknown): Row[] {
  const j = json as {
    hourly?: { time?: string[]; temperature_2m?: (number | null)[]; relative_humidity_2m?: (number | null)[] };
    current?: { time?: string; temperature_2m?: number | null; relative_humidity_2m?: number | null };
  };
  const out: Row[] = [];
  const h = j.hourly;
  h?.time?.forEach((t, i) => {
    const v = [h.temperature_2m?.[i] ?? null, h.relative_humidity_2m?.[i] ?? null];
    if (v.some((x) => x !== null)) out.push({ ts: new Date(utc(t)).toISOString(), v });
  });
  const c = j.current;
  if (c?.time && (c.temperature_2m != null || c.relative_humidity_2m != null)) {
    out.push({ ts: new Date(utc(c.time)).toISOString(), v: [c.temperature_2m ?? null, c.relative_humidity_2m ?? null] });
  }
  return out;
}

export async function runWeather(db: Rpc, fetchJson: FetchJson, now = Date.now()) {
  const { data, error } = await db.rpc("weather_targets");
  if (error) throw new Error(`weather_targets : ${error.message}`);
  const results: { station: string; received: number; inserted: number; error?: string }[] = [];
  for (const t of (data ?? []) as { ma_id: string; lat: number; lon: number; since: string }[]) {
    try {
      const since = Date.parse(t.since);
      const pos = `latitude=${t.lat}&longitude=${t.lon}&timezone=UTC`;
      const rows: Row[] = [];
      const recentFrom = now - 80 * DAY;
      if (since < recentFrom) {
        rows.push(...rowsOf(await fetchJson(
          `${ARCHIVE}?${pos}&hourly=${VARS}&start_date=${day(since)}&end_date=${day(Math.min(recentFrom + DAY, now - 5 * DAY))}`)));
      }
      const past = Math.min(92, Math.max(1, Math.ceil((now - Math.max(since, recentFrom)) / DAY) + 1));
      rows.push(...rowsOf(await fetchJson(`${FORECAST}?${pos}&hourly=${VARS}&current=${VARS}&past_days=${past}&forecast_days=1`)));
      // Mesures passées seulement (pas de prévision), plus récentes que la dernière enregistrée
      const fresh = rows.filter((r) => { const ts = Date.parse(r.ts); return ts <= now && ts > since - 3_600_000; });
      const res = await db.rpc("ingest_readings", {
        p_ma_id: t.ma_id, p_device_name: null, p_headers: HEADERS, p_rows: fresh,
        p_run_at: new Date(now).toISOString(), p_synced_until: new Date(now).toISOString(),
      });
      if (res.error) throw new Error(res.error.message);
      const r = res.data as { received: number; inserted: number };
      results.push({ station: t.ma_id, received: r.received, inserted: r.inserted });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.rpc("record_sync_error", { p_ma_id: t.ma_id, p_message: message });
      results.push({ station: t.ma_id, received: 0, inserted: 0, error: message });
    }
  }
  return results;
}
