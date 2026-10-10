// Stations météo de la maison courante : emplacements de type « weather » alimentés côté serveur
// par la collecte Open-Meteo (capteurs virtuels). L'application ne lit que la base : aucun appel
// au service météo depuis les navigateurs. Les stations ont aussi une prévision horaire (7 jours),
// tracée dans le prolongement de leur courbe, dans un style distinct.

import { api } from "./api";
import { cssVar } from "./colors";
import type { WeatherSeries } from "./weather-parse";
import type { Point } from "./types";
import type { ChartSeries } from "../components/TimeChart.svelte";

/** Horizon des prévisions affichables */
export const FORECAST_MS = 7 * 86_400_000;

/** Prévisions de séries (stations météo), des heures à venir */
export async function loadForecast(ids: number[]): Promise<Map<number, Point[]>> {
  if (!ids.length) return new Map();
  try { return await api.seriesForecast(ids, Date.now() - 3_600_000, Date.now() + FORECAST_MS); } catch { return new Map(); }
}

/**
 * Courbe de prévision qui prolonge une courbe mesurée (même couleur, style « prévision »), raccordée
 * à sa dernière mesure ; seulement les heures postérieures à cette mesure.
 */
export function forecastCurve(base: Pick<ChartSeries, "id" | "name" | "color">, observed: Point[], forecast: Point[] | undefined): ChartSeries[] {
  const last = observed.filter((p) => p.quality !== "rejected").at(-1);
  const after = (forecast ?? []).filter((p) => p.ts > (last?.ts ?? Date.now()));
  if (!after.length) return [];
  return [{ id: `${base.id}-prevision`, name: `${base.name} (prévision)`, color: base.color, forecast: true,
            points: last ? [last, ...after] : after }];
}

export interface Station { placeId: number; name: string; temperature: number | null; humidity: number | null }

export const homeWeather = $state({ stations: [] as Station[], loaded: false, homeId: null as number | null });

/** Station de comparaison (courbe « Météo » des graphiques) : la première, dans l'ordre des emplacements */
export const primaryStation = (): Station | null => homeWeather.stations[0] ?? null;

export async function loadWeatherStations(homeId: number | null) {
  if (homeId !== homeWeather.homeId) {
    homeWeather.stations = [];
    homeWeather.loaded = false;
    homeWeather.homeId = homeId;
  }
  if (homeId === null) return;
  try {
    const [places, series] = await Promise.all([api.places(), api.seriesList()]);
    if (homeWeather.homeId !== homeId) return;
    homeWeather.stations = places.filter((p) => p.kind === "weather").map((p) => ({
      placeId: p.id, name: p.name,
      temperature: series.find((s) => s.place_id === p.id && s.property === "temperature")?.id ?? null,
      humidity: series.find((s) => s.place_id === p.id && s.property === "humidity")?.id ?? null,
    })).filter((s) => s.temperature !== null || s.humidity !== null);
  } catch { /* on garde ce qu'on a */ }
  homeWeather.loaded = true;
}

/**
 * Courbe de météo publique d'une grandeur, à ajouter à un graphique (pointillés gris) ; aucune si la
 * station fait déjà partie des emplacements affichés (`shown`).
 */
export function weatherCurve(w: WeatherSeries | null, prop: string, shown: number[] = []): ChartSeries[] {
  const points = prop === "temperature" ? w?.temperature : prop === "humidity" ? w?.humidity : undefined;
  const band = prop === "temperature" ? w?.bands?.temperature : prop === "humidity" ? w?.bands?.humidity : undefined;
  const st = primaryStation();
  if (!st || shown.includes(st.placeId)) return [];
  const base = { id: `meteo-${prop}`, name: st.name, color: cssVar("--muted") };
  if (band?.length) return [{ ...base, dotted: true, points: [], band }];
  if (!points?.length) return [];
  const fc = prop === "temperature" ? w?.forecast?.temperature : prop === "humidity" ? w?.forecast?.humidity : undefined;
  return [{ ...base, dotted: true, points }, ...forecastCurve(base, points, fc)];
}

/** Mesures de la station de comparaison sur une période (null si désactivée ou sans station) */
export async function loadWeather(enabled: boolean, from: number, to: number, withForecast = false, band = false): Promise<WeatherSeries | null> {
  const st = primaryStation();
  if (!enabled || !st) return null;
  const ids = [st.temperature, st.humidity].filter((x): x is number => x !== null);
  try {
    if (band) {
      // Temps long : bandes min – max journalières, pas de prévision (heures à venir, invisibles à cette échelle)
      const b = await api.seriesDaily(ids, from, to);
      return { temperature: [], humidity: [], bands: { temperature: st.temperature ? b.get(st.temperature) ?? [] : [],
                                                       humidity: st.humidity ? b.get(st.humidity) ?? [] : [] } };
    }
    const [data, fc] = await Promise.all([api.seriesData(ids, from, to), withForecast ? loadForecast(ids) : new Map<number, Point[]>()]);
    const get = (m: Map<number, Point[]>, id: number | null) => (id ? m.get(id) ?? [] : []);
    return { temperature: get(data, st.temperature), humidity: get(data, st.humidity),
             forecast: { temperature: get(fc, st.temperature), humidity: get(fc, st.humidity) } };
  } catch { return null; }
}
