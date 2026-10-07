// Recherche d'une commune (géocodage Open-Meteo), au moment de créer une station météo.
// Les mesures météo, elles, sont collectées côté serveur (Edge Function « weather »).

import { api } from "./api";

export interface Location { lat: number; lon: number; label: string | null }

const GEOCODING = "https://geocoding-api.open-meteo.com/v1/search";

export async function searchPlace(name: string): Promise<(Location & { detail: string })[]> {
  if (api.demo) return [{ lat: 43.6045, lon: 1.444, label: "Toulouse", detail: "Occitanie, France" }];
  const res = await fetch(`${GEOCODING}?name=${encodeURIComponent(name)}&count=6&language=fr&format=json`);
  if (!res.ok) throw new Error(`Recherche indisponible (${res.status})`);
  const j = await res.json() as {
    results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string; postcodes?: string[] }[];
  };
  return (j.results ?? []).map((r) => ({
    lat: r.latitude, lon: r.longitude, label: r.name,
    detail: [r.postcodes?.[0], r.admin1, r.country].filter(Boolean).join(", "),
  }));
}
