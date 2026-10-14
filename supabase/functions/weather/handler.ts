// Collecte de la météo publique (Open-Meteo) des stations météo virtuelles, côté serveur : un appel
// par station toutes les 30 minutes, quel que soit le nombre d'utilisateurs ; les mesures sont
// enregistrées comme celles des capteurs (ingest_readings).
//  - plus de 80 jours à rattraper (création d'une station) : archives ERA5, données horaires ;
//  - puis l'API de prévision : heures passées (past_days) et conditions actuelles (au quart d'heure),
//    enregistrées comme mesures, et prévision horaire des 7 prochains jours (store_forecast), qui
//    prolonge la courbe dans le futur et sert aux alertes sur prévision ;
//  - normales saisonnières (runNormals), une fois par station.

export interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}
export type FetchJson = (url: string) => Promise<unknown>;

const DAY = 86_400_000;
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const VARS = "temperature_2m,relative_humidity_2m";
const FORECAST_DAYS = 7;
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
  const results: { station: string; received: number; inserted: number; forecast: number; error?: string }[] = [];
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
      const recent = rowsOf(await fetchJson(
        `${FORECAST}?${pos}&hourly=${VARS}&current=${VARS}&past_days=${past}&forecast_days=${FORECAST_DAYS}`));
      rows.push(...recent);
      // Mesures passées seulement (pas de prévision), plus récentes que la dernière enregistrée
      const fresh = rows.filter((r) => { const ts = Date.parse(r.ts); return ts <= now && ts > since - 3_600_000; });
      const res = await db.rpc("ingest_readings", {
        p_ma_id: t.ma_id, p_device_name: null, p_headers: HEADERS, p_rows: fresh,
        p_run_at: new Date(now).toISOString(), p_synced_until: new Date(now).toISOString(),
      });
      if (res.error) throw new Error(res.error.message);
      const r = res.data as { received: number; inserted: number };
      // Heures à venir : prévision (remplace la précédente)
      const future = recent.filter((x) => Date.parse(x.ts) > now);
      let forecast = 0;
      if (future.length) {
        const fc = await db.rpc("store_forecast", { p_ma_id: t.ma_id, p_rows: future, p_issued_at: new Date(now).toISOString() });
        if (fc.error) throw new Error(`prévision : ${fc.error.message}`);
        forecast = fc.data as number;
      }
      results.push({ station: t.ma_id, received: r.received, inserted: r.inserted, forecast });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.rpc("record_sync_error", { p_ma_id: t.ma_id, p_message: message });
      results.push({ station: t.ma_id, received: 0, inserted: 0, forecast: 0, error: message });
    }
  }
  return results;
}

// ── Normales saisonnières ──────────────────────────────────────────────────────────────────────────
// Une station à la fois (requête lourde : 30 ans de données journalières), tant que ses normales ne
// sont pas calculées ; minimums et maximums journaliers des archives ERA5 sur 1991 – 2020, moyennés
// par jour de l'année puis lissés (moyenne glissante de 3 semaines : 30 ans ne suffisent pas à
// effacer les écarts d'un jour à l'autre).

export const NORMALS_PERIOD = "1991-2020";
const NORMAL_VARS = "temperature_2m_min,temperature_2m_max,relative_humidity_2m_min,relative_humidity_2m_max";
/** Demi-largeur du lissage, en jours */
const SMOOTH = 10;

export interface NormalRow { md: number; min: (number | null)[]; max: (number | null)[] }

/** Jours d'une année bissextile, dans l'ordre : 101, 102… 229… 1231 (mois × 100 + jour) */
const MDS: number[] = [];
for (let t = Date.UTC(2000, 0, 1); t < Date.UTC(2001, 0, 1); t += DAY) {
  const d = new Date(t);
  MDS.push((d.getUTCMonth() + 1) * 100 + d.getUTCDate());
}
const SLOT = new Map(MDS.map((md, i) => [md, i]));

/** Réponse journalière des archives → normales par jour de l'année (366 lignes, valeurs à 0,1 près) */
export function computeNormals(json: unknown): NormalRow[] {
  const d = (json as { daily?: Record<string, (number | null)[] | string[] | undefined> }).daily ?? {};
  const time = (d.time ?? []) as string[];
  const vars = [["temperature_2m_min", "temperature_2m_max"], ["relative_humidity_2m_min", "relative_humidity_2m_max"]];
  // Sommes et nombres de valeurs par jour de l'année, pour chaque grandeur et chaque borne (min, max)
  const acc = vars.map(() => [0, 1].map(() => ({ sum: new Float64Array(366), n: new Uint16Array(366) })));
  time.forEach((t, i) => {
    const slot = SLOT.get(Number(t.slice(5, 7)) * 100 + Number(t.slice(8, 10)));
    if (slot === undefined) return;
    vars.forEach((pair, p) => pair.forEach((name, b) => {
      const v = (d[name] as (number | null)[] | undefined)?.[i];
      if (typeof v === "number" && Number.isFinite(v)) { acc[p][b].sum[slot] += v; acc[p][b].n[slot]++; }
    }));
  });
  const smooth = (a: { sum: Float64Array; n: Uint16Array }, slot: number) => {
    let s = 0, n = 0;
    for (let k = -SMOOTH; k <= SMOOTH; k++) { const j = (slot + k + 366) % 366; s += a.sum[j]; n += a.n[j]; }
    return n ? Math.round((s / n) * 10) / 10 : null;
  };
  return MDS.map((md, slot) => ({
    md,
    min: acc.map((pair) => smooth(pair[0], slot)),
    max: acc.map((pair) => smooth(pair[1], slot)),
  })).filter((r) => r.min.some((v) => v !== null));
}

/** Calcule les normales d'une station qui n'en a pas encore (null : rien à faire) */
export async function runNormals(db: Rpc, fetchJson: FetchJson) {
  const { data, error } = await db.rpc("normals_targets");
  if (error) throw new Error(`normals_targets : ${error.message}`);
  const t = ((data ?? []) as { ma_id: string; lat: number; lon: number }[])[0];
  if (!t) return null;
  try {
    const [from, to] = NORMALS_PERIOD.split("-");
    const rows = computeNormals(await fetchJson(`${ARCHIVE}?latitude=${t.lat}&longitude=${t.lon}&timezone=auto`
      + `&daily=${NORMAL_VARS}&start_date=${from}-01-01&end_date=${to}-12-31`));
    if (!rows.length) throw new Error("archives vides");
    const res = await db.rpc("store_normals", { p_ma_id: t.ma_id, p_rows: rows, p_period: NORMALS_PERIOD });
    if (res.error) throw new Error(res.error.message);
    return { station: t.ma_id, normals: res.data as number };
  } catch (e) {
    return { station: t.ma_id, normals: 0, error: `normales : ${e instanceof Error ? e.message : String(e)}` };
  }
}
