// Mode démo : données fictives en mémoire, pour essayer l'application sans projet Supabase.

import type { Api, CollectResult, CurrentValue, Device, Place, Property, Stats } from "./types";

const PROPS: Property[] = [
  { id: 1, code: "temperature", name: "Température", unit: "°C", simplify_tolerance: 0.2 },
  { id: 2, code: "humidity", name: "Humidité relative", unit: "%", simplify_tolerance: 2 },
  { id: 3, code: "rain", name: "Pluie", unit: "mm", simplify_tolerance: null },
];

const PLACE_DEFS: [string, string, Place["exposure"], number, number][] = [
  // code, nom, exposition, température type, humidité type
  ["salon", "Salon", "indoor", 21.4, 55],
  ["exterieur", "Extérieur", "outdoor", 12.8, 82],
  ["ch-enfants", "Chambre enfants", "indoor", 20.1, 58],
  ["bureau", "Bureau", "indoor", 22.3, 51],
  ["cave", "Cave", "indoor", 14.2, 71],
  ["garage", "Garage", "indoor", 16.5, 64],
  ["veranda", "Véranda", "indoor", 18.9, 60],
  ["jardin-butte", "Jardin Est (butte)", "outdoor", 12.1, 85],
  ["congel", "Congélateur", "appliance", -19.4, 64],
];

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

const places: Place[] = PLACE_DEFS.map(([code, name, exposure], i) => ({
  id: i + 1, code, name, exposure, parent_id: null, kind: exposure === "outdoor" ? "outdoor" : "room",
}));

let devices: Device[] = PLACE_DEFS.map(([code, name], i): Device | null => {
  const station = code === "salon";
  const ma_id = (station ? "07" : "03") + "DEMO" + String(i).padStart(6, "0");
  const ch = (no: number, property: string, place: number) => {
    const p = PROPS.find((x) => x.code === property)!;
    return { id: (i + 1) * 10 + no, channel_no: no, label: `${p.name}${station ? (no > 2 ? " extérieure" : " intérieure") : ""}`,
             property, property_name: p.name, unit: p.unit, place_id: place, since: iso(400 * 86_400_000) };
  };
  if (code === "exterieur") return null;
  return {
    id: i + 1, ma_id, name: `Capteur ${name.toLowerCase()}`, ma_name: `${String(i + 1).padStart(2, "0")}-${name} Mesures`,
    model: null, active: true, added_at: iso(400 * 86_400_000), retired_at: null,
    channels: station
      ? [ch(1, "temperature", 1), ch(2, "humidity", 1), ch(3, "temperature", 2), ch(4, "humidity", 2)]
      : [ch(1, "temperature", i + 1), ch(2, "humidity", i + 1)],
  };
}).filter((d): d is Device => d !== null);

const settings: Record<string, unknown> = { hot_days: 90, simplify_after_days: 1095, timezone: "Europe/Paris", db_quota_mb: 500 };
const delay = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));

export class DemoApi implements Api {
  readonly demo = true;
  private signedIn = true;
  private listeners: (() => void)[] = [];

  async session() { return this.signedIn ? { email: "demo@mobalplus" } : null; }
  onAuthChange(cb: () => void) { this.listeners.push(cb); }
  async signIn() { this.signedIn = true; this.listeners.forEach((l) => l()); }
  async signInWithGoogle() { return this.signIn(); }
  async signOut() { this.signedIn = false; this.listeners.forEach((l) => l()); }
  async role() { return "admin" as const; }

  async currentValues(): Promise<CurrentValue[]> {
    const out: CurrentValue[] = [];
    for (const d of devices.filter((x) => x.active)) {
      for (const c of d.channels) {
        const place = places.find((p) => p.id === c.place_id);
        if (!place) continue;
        const def = PLACE_DEFS.find((x) => x[0] === place.code)!;
        const base = c.property === "temperature" ? def[3] : def[4];
        const stale = place.code === "garage";
        out.push({
          series_id: c.id, series_name: `${place.name} – ${c.property_name}`, place_id: place.id, place_name: place.name,
          property: c.property, unit: c.unit, ts: iso(stale ? 7 * 3600_000 : (3 + (c.id % 6)) * 60_000),
          value: Math.round((base + Math.sin(c.id) * 0.4) * 10) / 10, ma_id: d.ma_id, device_name: d.name,
        });
      }
    }
    return delay(out.sort((a, b) => a.place_name.localeCompare(b.place_name)));
  }

  async stats(): Promise<Stats> {
    const ch = devices.reduce((n, d) => n + d.channels.length, 0);
    return delay({
      db_size_bytes: 118 * 1024 * 1024,
      tables: { reading: 41 * 1024 * 1024, reading_day: 63 * 1024 * 1024, correction: 24_576, annotation: 16_384 },
      counts: { devices: devices.length, active_devices: devices.filter((d) => d.active).length, channels: ch,
                places: places.length, series: ch, active_deployments: ch, corrections: 12, annotations: 3 },
      values: { recent: 498_000, compacted: 5_870_000, simplified: 0, simplified_raw: 0 },
      devices: devices.map((d, i) => ({
        ma_id: d.ma_id, name: d.name, active: d.active, channels: d.channels.length,
        values: 380_000 + i * 21_000, first_ts: iso(1100 * 86_400_000),
        last_ts: iso(d.name?.includes("garage") ? 7 * 3600_000 : 5 * 60_000), last_run: iso(4 * 60_000),
        status: d.name?.includes("garage") ? "NO_DATA" : "OK",
        message: d.name?.includes("garage") ? "0 mesures reçues, 0 valeurs insérées" : "2 mesures reçues, 4 valeurs insérées",
      })),
      last_maintenance: { run_at: iso(9 * 3600_000), details: { compacted: 41_230, simplified: { days: 0 } } },
      settings,
    });
  }

  async devices() { return delay(structuredClone(devices)); }
  async places() { return delay(structuredClone(places)); }
  async properties() { return delay(structuredClone(PROPS)); }

  async addDevice(maId: string, name: string) {
    const id = Math.max(...devices.map((d) => d.id)) + 1;
    devices.push({ id, ma_id: maId.toUpperCase(), name: name || null, ma_name: null, model: null, active: true,
                   added_at: new Date().toISOString(), retired_at: null, channels: [] });
  }
  async renameDevice(id: number, name: string) { devices = devices.map((d) => (d.id === id ? { ...d, name } : d)); }
  async retireDevice(id: number) {
    devices = devices.map((d) => d.id === id
      ? { ...d, active: false, retired_at: new Date().toISOString(), channels: d.channels.map((c) => ({ ...c, place_id: null, since: null })) }
      : d);
  }
  async reactivateDevice(id: number) { devices = devices.map((d) => (d.id === id ? { ...d, active: true, retired_at: null } : d)); }
  async assignChannel(channelId: number, placeId: number | null, from: Date) {
    devices = devices.map((d) => ({ ...d, channels: d.channels.map((c) =>
      c.id === channelId ? { ...c, place_id: placeId, since: placeId ? from.toISOString() : null } : c) }));
  }
  async savePlace(place: Omit<Place, "id"> & { id?: number }) {
    if (place.id) {
      const i = places.findIndex((p) => p.id === place.id);
      places[i] = { ...places[i], ...place } as Place;
    } else {
      places.push({ ...place, id: Math.max(...places.map((p) => p.id)) + 1 });
    }
  }
  async deletePlace(id: number) {
    const i = places.findIndex((p) => p.id === id);
    if (devices.some((d) => d.channels.some((c) => c.place_id === id))) {
      throw new Error("Cet emplacement a des mesures associées : il ne peut pas être supprimé");
    }
    places.splice(i, 1);
  }
  async saveSetting(key: string, value: unknown) { settings[key] = value; }
  async saveTolerance(propertyId: number, tolerance: number | null) {
    PROPS.find((p) => p.id === propertyId)!.simplify_tolerance = tolerance;
  }
  async collectNow(maIds?: string[]): Promise<CollectResult[]> {
    await delay(null);
    return devices.filter((d) => d.active && (!maIds || maIds.includes(d.ma_id)))
      .map((d) => ({ ma_id: d.ma_id, status: "OK", received: 1, inserted: d.channels.length }));
  }
  async runMaintenance() { return delay({ compacted: 0, simplified: { days: 0, points_before: 0, points_after: 0 } }); }
}
