// Lecture des réponses Open-Meteo (sans dépendance : testable sous Node).

import type { Point } from "./types";

export interface WeatherSeries { temperature: Point[]; humidity: Point[] }

/** Réponse horaire d'Open-Meteo (heures UTC sans fuseau) → points */
export function parseHourly(json: unknown): WeatherSeries {
  const h = (json as { hourly?: { time?: string[]; temperature_2m?: (number | null)[]; relative_humidity_2m?: (number | null)[] } }).hourly;
  const out: WeatherSeries = { temperature: [], humidity: [] };
  if (!h?.time) return out;
  h.time.forEach((t, i) => {
    const ts = Date.parse(t.endsWith("Z") ? t : `${t}Z`);
    const temp = h.temperature_2m?.[i], hum = h.relative_humidity_2m?.[i];
    if (temp != null) out.temperature.push({ ts, value: temp, quality: "ok" });
    if (hum != null) out.humidity.push({ ts, value: hum, quality: "ok" });
  });
  return out;
}

/** Fusion de plusieurs réponses (les dernières l'emportent sur les mêmes heures), triée */
export function merge(parts: WeatherSeries[], from: number, to: number): WeatherSeries {
  const join = (key: keyof WeatherSeries) => {
    const m = new Map<number, Point>();
    for (const p of parts) for (const x of p[key]) m.set(x.ts, x);
    return [...m.values()].filter((x) => x.ts >= from && x.ts <= to).sort((a, b) => a.ts - b.ts);
  };
  return { temperature: join("temperature"), humidity: join("humidity") };
}

