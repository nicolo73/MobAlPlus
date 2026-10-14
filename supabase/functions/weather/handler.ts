// Collecte de la météo publique (Open-Meteo) des stations météo virtuelles, côté serveur : un appel
// par station toutes les 30 minutes, quel que soit le nombre d'utilisateurs ; les mesures sont
// enregistrées comme celles des capteurs (ingest_readings).
//  - plus de 80 jours à rattraper (création d'une station) : archives ERA5, données horaires ;
//  - puis l'API de prévision : heures passées (past_days) et conditions actuelles (au quart d'heure),
//    enregistrées comme mesures, et prévision horaire des 7 prochains jours (store_forecast), qui
//    prolonge la courbe dans le futur et sert aux alertes sur prévision ;
//  - normales saisonnières (runNormals), une fois par station, par tranches de 10 ans ;
//  - à la demande, une seule station et ses détails en direct (stationDetails).

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

export async function runWeather(db: Rpc, fetchJson: FetchJson, now = Date.now(), only?: string) {
  const { data, error } = await db.rpc("weather_targets");
  if (error) throw new Error(`weather_targets : ${error.message}`);
  const results: { station: string; received: number; inserted: number; forecast: number; error?: string }[] = [];
  for (const t of ((data ?? []) as { ma_id: string; lat: number; lon: number; since: string }[]).filter((x) => !only || x.ma_id === only)) {
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
// Minimums et maximums journaliers des archives ERA5 sur 1991 – 2020, moyennés par jour de l'année
// puis lissés (moyenne glissante de 3 semaines : 30 ans ne suffisent pas à effacer les écarts d'un
// jour à l'autre). Par tranches de 10 ans, une par passage : 30 ans d'un coup dépassent la limite
// par minute du service gratuit (une requête longue compte pour plusieurs appels). Les sommes
// partielles sont gardées en base entre deux passages.

export const NORMALS_FROM = 1991;
export const NORMALS_TO = 2020;
export const NORMALS_PERIOD = `${NORMALS_FROM}-${NORMALS_TO}`;
const CHUNK_YEARS = 10;
const TEMP_VARS = ["temperature_2m_min", "temperature_2m_max"];
const HUM_VARS = ["relative_humidity_2m_min", "relative_humidity_2m_max"];
/** Demi-largeur du lissage, en jours */
const SMOOTH = 10;

export interface NormalRow { md: number; min: (number | null)[]; max: (number | null)[] }
/** Sommes et nombres de valeurs par jour de l'année : [grandeur][min | max] */
export type Acc = { sum: number[]; n: number[] }[][];
/** Calcul en cours : position, prochaine année à lire, humidité disponible, sommes partielles */
export interface Progress { lat: number; lon: number; next: number; humidity: boolean; acc: Acc }

/** Jours d'une année bissextile, dans l'ordre : 101, 102… 229… 1231 (mois × 100 + jour) */
const MDS: number[] = [];
for (let t = Date.UTC(2000, 0, 1); t < Date.UTC(2001, 0, 1); t += DAY) {
  const d = new Date(t);
  MDS.push((d.getUTCMonth() + 1) * 100 + d.getUTCDate());
}
const SLOT = new Map(MDS.map((md, i) => [md, i]));

export const emptyAcc = (): Acc => [0, 1].map(() => [0, 1].map(() => ({ sum: Array(366).fill(0), n: Array(366).fill(0) })));

/** Ajoute une réponse journalière des archives aux sommes */
export function accumulate(acc: Acc, json: unknown): Acc {
  const d = (json as { daily?: Record<string, (number | null)[] | string[] | undefined> }).daily ?? {};
  const time = (d.time ?? []) as string[];
  const vars = [TEMP_VARS, HUM_VARS];
  time.forEach((t, i) => {
    const slot = SLOT.get(Number(t.slice(5, 7)) * 100 + Number(t.slice(8, 10)));
    if (slot === undefined) return;
    vars.forEach((pair, p) => pair.forEach((name, b) => {
      const v = (d[name] as (number | null)[] | undefined)?.[i];
      if (typeof v === "number" && Number.isFinite(v)) { acc[p][b].sum[slot] += v; acc[p][b].n[slot]++; }
    }));
  });
  return acc;
}

/** Sommes → normales par jour de l'année (366 lignes, valeurs à 0,1 près) */
export function normalsOf(acc: Acc): NormalRow[] {
  const smooth = (a: { sum: number[]; n: number[] }, slot: number) => {
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

/** Réponse journalière complète → normales (un seul appel, pour les tests) */
export const computeNormals = (json: unknown) => normalsOf(accumulate(emptyAcc(), json));

/**
 * Avance d'une tranche le calcul des normales d'une station qui n'en a pas encore (null : rien à
 * faire). `only` : cette station seulement (actualisation demandée depuis l'application).
 */
export async function runNormals(db: Rpc, fetchJson: FetchJson, only?: string) {
  const { data, error } = await db.rpc("normals_targets", only ? { p_ma_id: only } : {});
  if (error) throw new Error(`normals_targets : ${error.message}`);
  const t = ((data ?? []) as { ma_id: string; lat: number; lon: number; progress: Progress | null }[])[0];
  if (!t) return null;
  try {
    // Sommes déjà calculées, si la station n'a pas bougé depuis
    const saved = t.progress;
    const prog: Progress = saved && saved.lat === t.lat && saved.lon === t.lon && saved.acc?.length === 2
      ? saved : { lat: t.lat, lon: t.lon, next: NORMALS_FROM, humidity: true, acc: emptyAcc() };
    const from = prog.next, to = Math.min(NORMALS_TO, from + CHUNK_YEARS - 1);
    const url = (vars: string[]) => `${ARCHIVE}?latitude=${t.lat}&longitude=${t.lon}&timezone=auto`
      + `&daily=${vars.join(",")}&start_date=${from}-01-01&end_date=${to}-12-31`;
    let json: unknown;
    try {
      json = await fetchJson(url(prog.humidity ? [...TEMP_VARS, ...HUM_VARS] : TEMP_VARS));
    } catch (e) {
      // Variable refusée (humidité journalière absente des archives) : température seule
      if (!prog.humidity || !/\b400\b/.test(String(e))) throw e;
      prog.humidity = false;
      prog.acc[1] = emptyAcc()[1];
      json = await fetchJson(url(TEMP_VARS));
    }
    accumulate(prog.acc, json);
    prog.next = to + 1;
    if (prog.next <= NORMALS_TO) {
      const res = await db.rpc("save_normals_progress", { p_ma_id: t.ma_id, p_progress: prog });
      if (res.error) throw new Error(res.error.message);
      return { station: t.ma_id, normals: 0, done: `${NORMALS_FROM}–${to}` };
    }
    const rows = normalsOf(prog.acc);
    if (!rows.length) throw new Error("archives vides");
    const res = await db.rpc("store_normals", { p_ma_id: t.ma_id, p_rows: rows, p_period: NORMALS_PERIOD });
    if (res.error) throw new Error(res.error.message);
    return { station: t.ma_id, normals: res.data as number, done: NORMALS_PERIOD };
  } catch (e) {
    const message = `normales : ${e instanceof Error ? e.message : String(e)}`;
    await db.rpc("normals_error", { p_ma_id: t.ma_id, p_message: message });
    return { station: t.ma_id, normals: 0, error: message };
  }
}

// ── Détails en direct d'une station ────────────────────────────────────────────────────────────────
// Pour le diagnostic de la page de la station : point de grille et altitude retenus par
// Open-Meteo, conditions actuelles complètes, soleil du jour (non enregistrés en base).

const DETAIL_CURRENT = "temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,precipitation,"
  + "weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day";
const DETAIL_DAILY = "sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max";

export interface StationDetails {
  grid: { lat: number; lon: number; elevation: number | null } | null;
  timezone: string | null;
  current: Record<string, number | string | null>;
  units: Record<string, string>;
  today: Record<string, number | string | null>;
}

export async function stationDetails(fetchJson: FetchJson, lat: number, lon: number): Promise<StationDetails> {
  const j = await fetchJson(`${FORECAST}?latitude=${lat}&longitude=${lon}&timezone=auto`
    + `&current=${DETAIL_CURRENT}&daily=${DETAIL_DAILY}&forecast_days=1`) as {
      latitude?: number; longitude?: number; elevation?: number; timezone?: string;
      current?: Record<string, number | string | null>; current_units?: Record<string, string>;
      daily?: Record<string, (number | string | null)[]>;
    };
  return {
    grid: typeof j.latitude === "number" && typeof j.longitude === "number"
      ? { lat: j.latitude, lon: j.longitude, elevation: j.elevation ?? null } : null,
    timezone: j.timezone ?? null,
    current: j.current ?? {},
    units: j.current_units ?? {},
    today: Object.fromEntries(Object.entries(j.daily ?? {}).filter(([k]) => k !== "time").map(([k, v]) => [k, v?.[0] ?? null])),
  };
}
