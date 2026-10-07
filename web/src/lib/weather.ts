// Météo publique (Open-Meteo, gratuit, sans clé) à la position de la maison : température et
// humidité extérieures, actuelles et passées, interrogées directement par le navigateur.
//  - 3 derniers mois : API de prévision (past_days), données récentes ;
//  - au-delà : API d'archives (réanalyse ERA5, disponible avec quelques jours de retard).
// Résultats gardés en mémoire pendant la session (par heure arrondie).

import { api } from "./api";
import { merge, parseHourly, type WeatherSeries } from "./weather-parse";

export type { WeatherSeries };
export interface Location { lat: number; lon: number; label: string | null }
export interface CurrentWeather { ts: number; temperature: number | null; humidity: number | null }

const DAY = 86_400_000;
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const GEOCODING = "https://geocoding-api.open-meteo.com/v1/search";
/** Les archives couvrent jusqu'à ~5 jours avant aujourd'hui ; la prévision, 92 jours en arrière */
const RECENT_DAYS = 85;

export const WEATHER_PROPS = ["temperature", "humidity"] as const;
export const WEATHER_NAME = "Météo (Open-Meteo)";

const cache = new Map<string, Promise<WeatherSeries>>();
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const coords = (l: Location) => `latitude=${l.lat.toFixed(4)}&longitude=${l.lon.toFixed(4)}`;

async function getJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Météo indisponible (${res.status})`);
  return res.json();
}

/** Température et humidité horaires entre `from` et `to` */
export function weatherSeries(loc: Location, from: number, to: number, now = Date.now()): Promise<WeatherSeries> {
  // Bornes arrondies à l'heure : un même affichage réutilise la réponse
  const f = Math.floor(from / 3_600_000) * 3_600_000, t = Math.ceil(Math.min(to, now) / 3_600_000) * 3_600_000;
  const key = `${coords(loc)}|${f}|${t}`;
  if (!cache.has(key)) {
    cache.set(key, (api.demo ? Promise.resolve(demoSeries(loc, f, t)) : fetchSeries(loc, f, t, now))
      .catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key)!;
}

async function fetchSeries(loc: Location, from: number, to: number, now: number): Promise<WeatherSeries> {
  const vars = "hourly=temperature_2m,relative_humidity_2m&timezone=UTC";
  const parts: Promise<WeatherSeries>[] = [];
  const recentFrom = now - RECENT_DAYS * DAY;
  if (to > recentFrom) {
    const past = Math.min(92, Math.ceil((now - Math.max(from, recentFrom)) / DAY) + 1);
    parts.push(getJson(`${FORECAST}?${coords(loc)}&${vars}&past_days=${past}&forecast_days=1`).then(parseHourly));
  }
  if (from < recentFrom) {
    const end = Math.min(to, recentFrom + 2 * DAY, now - 5 * DAY);
    parts.push(getJson(`${ARCHIVE}?${coords(loc)}&${vars}&start_date=${day(from)}&end_date=${day(end)}`).then(parseHourly));
  }
  return merge(await Promise.all(parts), from, to);
}

/** Conditions actuelles */
export async function currentWeather(loc: Location): Promise<CurrentWeather> {
  if (api.demo) {
    const s = demoSeries(loc, Date.now() - 3_600_000, Date.now());
    return { ts: Date.now() - 15 * 60_000, temperature: s.temperature.at(-1)?.value ?? null, humidity: s.humidity.at(-1)?.value ?? null };
  }
  const j = await getJson(`${FORECAST}?${coords(loc)}&current=temperature_2m,relative_humidity_2m&timezone=UTC`) as {
    current?: { time: string; temperature_2m?: number; relative_humidity_2m?: number };
  };
  const c = j.current;
  return { ts: c ? Date.parse(`${c.time}Z`) : Date.now(), temperature: c?.temperature_2m ?? null, humidity: c?.relative_humidity_2m ?? null };
}

/** Recherche d'une commune (géocodage Open-Meteo) */
export async function searchPlace(name: string): Promise<(Location & { detail: string })[]> {
  if (api.demo) return [{ lat: 48.8566, lon: 2.3522, label: "Paris", detail: "Île-de-France, France" }];
  const j = await getJson(`${GEOCODING}?name=${encodeURIComponent(name)}&count=6&language=fr&format=json`) as {
    results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string; postcodes?: string[] }[];
  };
  return (j.results ?? []).map((r) => ({
    lat: r.latitude, lon: r.longitude, label: r.name,
    detail: [r.postcodes?.[0], r.admin1, r.country].filter(Boolean).join(", "),
  }));
}

/** Mode démo : météo fictive, voisine des capteurs extérieurs (heures pleines) */
function demoSeries(_loc: Location, from: number, to: number): WeatherSeries {
  const out: WeatherSeries = { temperature: [], humidity: [] };
  for (let t = Math.ceil(from / 3_600_000) * 3_600_000; t <= to; t += 3_600_000) {
    const d = Math.sin((2 * Math.PI * (t % DAY)) / DAY - 2.35);
    const s = Math.sin((2 * Math.PI * t) / (365 * DAY) - 1.4);
    out.temperature.push({ ts: t, value: Math.round((11.8 + 4.6 * d + 7 * s + Math.sin(t / 2.9e8) * 1.5) * 10) / 10, quality: "ok" });
    out.humidity.push({ ts: t, value: Math.round(80 - 14 * d), quality: "ok" });
  }
  return out;
}
