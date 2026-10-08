// Mode démo : données fictives en mémoire, pour essayer l'application sans projet Supabase.

import { isWithin, sortPlaces } from "./placetree";
import type {
  Api, CollectResult, Context, CurrentValue, Device, HomeRole, Member, Observation, Place, PlaceDeployment, Point,
  Property, SeriesInfo, SeriesStats, Stats, ExportOptions, ImportMode, ImportPreview, ImportResult, ImportRows,
  AlertEvent, AlertLevel, AlertRule,
} from "./types";
import { evaluateForecast, evaluateRule } from "./alerteval";

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
// Emplacements parents, sans capteur propre : Jardin (Extérieur, Jardin Est), Maison > Étage, RDC
places.push({ id: 10, code: "jardin", name: "Jardin", exposure: "outdoor", parent_id: null, kind: "zone" },
            { id: 11, code: "etage", name: "Étage", exposure: "indoor", parent_id: 13, kind: "zone" },
            { id: 12, code: "rdc", name: "RDC", exposure: "indoor", parent_id: 13, kind: "zone" },
            { id: 13, code: "maison", name: "Maison", exposure: "indoor", parent_id: null, kind: "zone" });
for (const [child, parent] of [[2, 10], [8, 10], [3, 11], [4, 11], [1, 12], [6, 12], [7, 12]]) places[child - 1].parent_id = parent;

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

// Troisième sous-emplacement du Jardin : abri de jardin
const EXTRA_DEFS: typeof PLACE_DEFS = [["abri", "Abri de jardin", "outdoor", 12.4, 84], ["meteo-demo1", "Météo · Paris", "outdoor", 12.5, 80]];
places.push({ id: 14, code: "abri", name: "Abri de jardin", exposure: "outdoor", parent_id: 10, kind: "room" });
const defOf = (code: string | undefined) =>
  PLACE_DEFS.find((x) => x[0] === code) ?? EXTRA_DEFS.find((x) => x[0] === code) ?? PLACE_DEFS[0];
devices.push({
  id: 20, ma_id: "03DEMO000020", name: "Capteur abri de jardin", ma_name: "20-Abri Mesures", model: null, active: true,
  added_at: iso(400 * 86_400_000), retired_at: null,
  channels: [
    { id: 201, channel_no: 1, label: "Température", property: "temperature", property_name: "Température", unit: "°C", place_id: 14, since: iso(400 * 86_400_000) },
    { id: 202, channel_no: 2, label: "Humidité relative", property: "humidity", property_name: "Humidité relative", unit: "%", place_id: 14, since: iso(400 * 86_400_000) },
  ],
});

// Station météo publique (capteur virtuel Open-Meteo), en tête de liste
places.push({ id: 15, code: "meteo-demo1", name: "Météo · Paris", exposure: "outdoor", parent_id: null, kind: "weather", sort_order: -1 });
const weatherDevice = (id: number, place: number, label: string): Device => ({
  id, ma_id: `METEO-DEMO${id}`, name: `Météo · ${label}`, ma_name: null, model: "Open-Meteo", vendor: "open_meteo", active: true,
  added_at: iso(366 * 86_400_000), retired_at: null,
  channels: [
    { id: id * 10 + 1, channel_no: 1, label: "Température", property: "temperature", property_name: "Température", unit: "°C", place_id: place, since: iso(366 * 86_400_000) },
    { id: id * 10 + 2, channel_no: 2, label: "Humidité", property: "humidity", property_name: "Humidité relative", unit: "%", place_id: place, since: iso(366 * 86_400_000) },
  ],
});
devices.push(weatherDevice(21, 15, "Paris"));

const STEP = 7 * 60_000;           // une mesure toutes les 7 minutes
const HISTORY = 400 * 86_400_000;  // historique fictif disponible

/** Valeur fictive mais plausible : cycle jour / nuit, saisons, lente dérive, résolution du capteur */
function synth(seriesId: number, t: number): number {
  const d = devices.flatMap((x) => x.channels).find((c) => c.id === seriesId);
  const place = places.find((p) => p.id === d?.place_id);
  const def = defOf(place?.code);
  const temp = d?.property !== "humidity";
  const day = 86_400_000;
  const outdoor = def[2] === "outdoor";
  const daily = Math.sin((2 * Math.PI * (t % day)) / day - 2.2) * (outdoor ? 4 : def[2] === "appliance" ? 0.6 : 1.2);
  const season = Math.sin((2 * Math.PI * t) / (365 * day) - 1.4) * (outdoor ? 7 : def[2] === "appliance" ? 0 : 2.5);
  const drift = Math.sin(t / (3.7 * day) + seriesId) * (outdoor ? 2.5 : 0.6);
  if (temp) return Math.round((def[3] + daily + season + drift) * 10) / 10;
  return Math.round(Math.min(99, Math.max(20, def[4] - daily * 3 - drift * 2)));
}

function series(): SeriesInfo[] {
  return devices.filter((d) => d.active).flatMap((d) => d.channels.filter((c) => c.place_id).map((c) => {
    const place = places.find((p) => p.id === c.place_id)!;
    return {
      id: c.id, name: `${place.name} – ${c.property_name}`, place_id: place.id, place_name: place.name,
      exposure: place.exposure, property: c.property, property_name: c.property_name, unit: c.unit,
    };
  }));
}

/** Le capteur du garage s'est tu il y a 7 heures (piles), et a eu un silence d'une demi-journée il y a 4 jours */
function silent(id: number, t: number) {
  const code = places.find((p) => p.id === devices.flatMap((d) => d.channels).find((c) => c.id === id)?.place_id)?.code;
  return code === "garage" && (t > now - 7 * 3_600_000 || (t > now - 4.5 * 86_400_000 && t < now - 4 * 86_400_000));
}

function rawPoints(id: number, from: number, to: number): Point[] {
  const out: Point[] = [];
  const start = Math.max(from, now - HISTORY);
  for (let t = Math.ceil(start / STEP) * STEP; t < Math.min(to, now); t += STEP) {
    if (silent(id, t)) continue;
    out.push({ ts: t, value: synth(id, t), quality: "ok" });
  }
  return out;
}

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
  async signUp() { await this.signIn(); return "ok" as const; }

  private homes = [{ id: 1, name: "Maison démo", role: "owner" as HomeRole }];
  private memberList: Member[] = [
    { id: 1, home_id: 1, email: "demo@mobalplus", user_id: "demo", role: "owner", created_at: iso(30 * 86_400_000) },
    { id: 2, home_id: 1, email: "famille@exemple.fr", user_id: null, role: "viewer", created_at: iso(86_400_000) },
  ];

  async context(): Promise<Context> {
    return delay({ email: "demo@mobalplus", platform_admin: true, homes: structuredClone(this.homes) });
  }
  setHome() { /* une seule maison en démo */ }
  async createHome(name: string) {
    const id = Math.max(...this.homes.map((h) => h.id)) + 1;
    this.homes.push({ id, name, role: "owner" });
    this.memberList.push({ id: Math.max(...this.memberList.map((m) => m.id)) + 1, home_id: id, email: "demo@mobalplus",
                           user_id: "demo", role: "owner", created_at: new Date().toISOString() });
    return id;
  }
  async renameHome(id: number, name: string) { this.homes = this.homes.map((h) => (h.id === id ? { ...h, name } : h)); }
  async members(homeId: number) { return delay(this.memberList.filter((m) => m.home_id === homeId)); }
  async addMember(homeId: number, email: string, role: HomeRole) {
    if (this.memberList.some((m) => m.home_id === homeId && m.email === email.toLowerCase())) {
      throw new Error("Cette adresse est déjà membre de la maison.");
    }
    this.memberList.push({ id: Math.max(...this.memberList.map((m) => m.id)) + 1, home_id: homeId,
                           email: email.toLowerCase(), user_id: null, role, created_at: new Date().toISOString() });
  }
  private checkOwner(next: Member[], homeId: number) {
    if (!next.some((m) => m.home_id === homeId && m.role === "owner")) throw new Error("Une maison doit garder au moins un propriétaire");
  }
  async setMemberRole(id: number, role: HomeRole) {
    const next = this.memberList.map((m) => (m.id === id ? { ...m, role } : m));
    this.checkOwner(next, this.memberList.find((m) => m.id === id)!.home_id);
    this.memberList = next;
  }
  async removeMember(id: number) {
    const next = this.memberList.filter((m) => m.id !== id);
    this.checkOwner(next, this.memberList.find((m) => m.id === id)!.home_id);
    this.memberList = next;
  }

  async currentValues(): Promise<CurrentValue[]> {
    const out: CurrentValue[] = [];
    for (const d of devices.filter((x) => x.active)) {
      for (const c of d.channels) {
        const place = places.find((p) => p.id === c.place_id);
        if (!place) continue;
        const def = defOf(place.code);
        const base = c.property === "temperature" ? def[3] : def[4];
        const stale = place.code === "garage";
        out.push({
          series_id: c.id, series_name: `${place.name} – ${c.property_name}`, place_id: place.id, place_name: place.name,
          property: c.property, unit: c.unit, ts: iso(stale ? 7 * 3600_000 : (3 + (c.id % 6)) * 60_000),
          value: synth(c.id, now - (stale ? 7 * 3600_000 : 0)), ma_id: d.ma_id, device_name: d.name,
        });
      }
    }
    return delay(out.sort((a, b) => a.place_name.localeCompare(b.place_name)));
  }

  async seriesList() { return delay(series()); }

  /** Prévision fictive des stations météo : valeur fictive à venir, légèrement décalée, à l'heure */
  async seriesForecast(ids: number[], from: number, to: number) {
    const out = new Map<number, Point[]>();
    const meteo = new Set(devices.filter((d) => d.vendor === "open_meteo" && d.active).flatMap((d) => d.channels.map((c) => c.id)));
    for (const id of ids.filter((x) => meteo.has(x))) {
      const pts: Point[] = [];
      const start = Math.max(from, Math.ceil(now / 3_600_000) * 3_600_000);
      for (let t = start; t <= Math.min(to, now + 7 * 86_400_000); t += 3_600_000) {
        const v = synth(id, t) + Math.sin(t / 9e6) * (id % 2 ? 0.8 : 3);
        pts.push({ ts: t, value: Math.round(v * (id % 2 ? 10 : 1)) / (id % 2 ? 10 : 1), quality: "ok" });
      }
      out.set(id, pts);
    }
    return delay(out);
  }

  async seriesData(ids: number[], from: number, to: number, maxPoints = 1000) {
    const out = new Map<number, Point[]>();
    for (const id of ids) {
      const pts = rawPoints(id, from, to);
      if (pts.length <= maxPoints) { out.set(id, pts); continue; }
      // Même principe que la base : minimum et maximum réels de chaque intervalle
      const buckets = Math.max(1, Math.floor(maxPoints / 2));
      const size = (to - from) / buckets;
      const kept: Point[] = [];
      let i = 0;
      for (let b = 0; b < buckets; b++) {
        const end = from + (b + 1) * size;
        let lo: Point | null = null, hi: Point | null = null;
        for (; i < pts.length && pts[i].ts < end; i++) {
          if (!lo || pts[i].value < lo.value) lo = pts[i];
          if (!hi || pts[i].value > hi.value) hi = pts[i];
        }
        if (lo && hi) kept.push(...(lo === hi ? [lo] : lo.ts < hi.ts ? [lo, hi] : [hi, lo]));
      }
      out.set(id, kept);
    }
    return delay(out);
  }

  async seriesStats(id: number, from: number, to: number): Promise<SeriesStats> {
    const pts = rawPoints(id, from, to);
    if (!pts.length) return { n: 0, vmin: null, tmin: null, vmax: null, tmax: null, vavg: null, first_ts: null, last_ts: null };
    const lo = pts.reduce((a, b) => (b.value < a.value ? b : a));
    const hi = pts.reduce((a, b) => (b.value > a.value ? b : a));
    const isoT = (t: number) => new Date(t).toISOString();
    return delay({
      n: pts.length, vmin: lo.value, tmin: isoT(lo.ts), vmax: hi.value, tmax: isoT(hi.ts),
      vavg: pts.reduce((n, p) => n + p.value, 0) / pts.length, first_ts: isoT(pts[0].ts), last_ts: isoT(pts.at(-1)!.ts),
    });
  }

  async observations(ids: number[], from: number, before: number, limit: number): Promise<Observation[]> {
    return delay(ids.flatMap((id) => rawPoints(id, Math.max(from, before - limit * STEP), before)
      .reverse().slice(0, limit).map((p) => ({ ...p, series_id: id }))));
  }

  async placeDeployments(placeId: number): Promise<PlaceDeployment[]> {
    return delay(devices.flatMap((d) => d.channels.filter((c) => c.place_id === placeId).map((c) => ({
      series_id: c.id, property: c.property, property_name: c.property_name, ma_id: d.ma_id,
      device_name: d.name, channel_no: c.channel_no, from: c.since, to: null,
    }))));
  }

  async seriesBounds(ids: number[]) {
    return delay({ first: ids.length ? now - HISTORY : null, last: ids.length ? now : null });
  }

  async exportCsv(ids: number[], from: number, to: number, opts: ExportOptions) {
    const info = series();
    const fmt = (t: number) => opts.tz === "UTC" ? new Date(t).toISOString().slice(0, 19) + "Z"
      : new Date(t + 2 * 3600_000).toISOString().slice(0, 19) + "+02:00";   // démo : décalage d'été fixe
    const lines: [number, string][] = [];
    for (const id of ids) {
      const s = info.find((x) => x.id === id);
      if (!s) continue;
      const dev = devices.find((d) => d.channels.some((c) => c.id === id))!;
      for (const p of rawPoints(id, from, to)) {
        lines.push([p.ts, [fmt(p.ts), s.place_name, s.property, String(p.value).replace(".", opts.decimal), s.unit, p.quality,
                           dev.ma_id, String(dev.channels.find((c) => c.id === id)!.channel_no)].join(opts.sep)]);
      }
    }
    lines.sort((a, b) => a[0] - b[0]);
    return delay(lines.slice(0, opts.limit ?? undefined).map((l) => l[1]).join("\n"));
  }

  /** Démo : les valeurs déjà présentes dans la série fictive sont « identiques » ou « en conflit » */
  async importPreview(_kind: "series" | "channel", rows: ImportRows, tolerance: number): Promise<ImportPreview> {
    const groups = new Map<number, ImportPreview["groups"][number]>();
    for (const r of rows) {
      const key = r.s ?? r.c!;
      if (!groups.has(key)) groups.set(key, { key, new: 0, identical: 0, conflict: 0, unassigned: 0, samples: [] });
      const g = groups.get(key)!;
      const t = Date.parse(r.t);
      const near = Math.round(t / STEP) * STEP;
      if (Math.abs(near - t) > tolerance * 1000 || near > now || near < now - HISTORY) { g.new++; continue; }
      const ev = synth(key, near);
      if (Math.abs(ev - r.v) < 0.0005) g.identical++;
      else {
        g.conflict++;
        if (g.samples.length < 5) g.samples.push({ t: r.t, v: r.v, et: new Date(near).toISOString(), ev });
      }
    }
    return delay({ groups: [...groups.values()], tz_sampled: 0, tz_shifted: 0 });
  }

  async importValues(kind: "series" | "channel", rows: ImportRows, tolerance: number, mode: ImportMode): Promise<ImportResult> {
    const p = await this.importPreview(kind, rows, tolerance);
    const sum = (k: "new" | "identical" | "conflict") => p.groups.reduce((n, g) => n + g[k], 0);
    return { received: rows.length, inserted: sum("new") + (mode === "replace" ? sum("conflict") : 0),
             identical: sum("identical"), conflicts: mode === "keep" ? sum("conflict") : 0,
             replaced: mode === "replace" ? sum("conflict") : 0, skipped: 0, extended: 0, rejected: 0 };
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
  async places() { return delay(sortPlaces(structuredClone(places))); }
  async setPlaceColor(id: number, color: number | string | null) {
    const p = places.find((x) => x.id === id)!;
    p.color_slot = typeof color === "number" ? color : null;
    p.color = typeof color === "string" ? color : null;
    await delay(null);
  }
  private checkParent(parentId: number | null) {
    if (parentId === null) return;
    const occupied = devices.some((d) => d.active && d.channels.some((c) => c.place_id === parentId));
    if (occupied) throw new Error(`« ${places.find((p) => p.id === parentId)?.name} » a un capteur affecté : il ne peut pas contenir de sous-emplacement (déplacez d'abord son capteur, Admin › Capteurs)`);
  }
  async reorderPlaces(parentId: number | null, ids: number[]) {
    if (ids.some((id) => places.find((p) => p.id === id)?.parent_id !== parentId)) this.checkParent(parentId);
    if (parentId !== null && ids.some((id) => isWithin(places, parentId, id)))
      throw new Error("Un emplacement ne peut pas être placé dans l'un de ses sous-emplacements");
    ids.forEach((id, i) => { const p = places.find((x) => x.id === id)!; p.parent_id = parentId; p.sort_order = i + 1; });
    await delay(null);
  }
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
    const parent = places.find((p) => p.id === placeId && places.some((c) => c.parent_id === p.id));
    if (parent) throw new Error(`« ${parent.name} » contient des sous-emplacements : affectez le capteur à l'un d'eux (un emplacement parent fait la moyenne de ses sous-emplacements)`);
    devices = devices.map((d) => ({ ...d, channels: d.channels.map((c) =>
      c.id === channelId ? { ...c, place_id: placeId, since: placeId ? from.toISOString() : null } : c) }));
  }
  async savePlace(place: Omit<Place, "id"> & { id?: number }) {
    if (place.parent_id !== (places.find((p) => p.id === place.id)?.parent_id ?? null)) this.checkParent(place.parent_id);
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

  // Alertes de démonstration : règles en mémoire, alertes recalculées sur les données fictives
  private rules: AlertRule[] = [
    { series_id: 41, kind: "above", level: "info", threshold: 22, enabled: true },
    { series_id: 41, kind: "above", level: "warning", threshold: 22.8, enabled: true },
    { series_id: 41, kind: "peak", level: "warning", threshold: null, enabled: true },
    { series_id: 13, kind: "below", level: "warning", threshold: 4, enabled: true },
    { series_id: 13, kind: "trough", level: "info", threshold: null, enabled: true },
    { series_id: 91, kind: "above", level: "warning", threshold: -18.5, enabled: true },
    { series_id: 71, kind: "above", level: "warning", threshold: 16, enabled: true },
    { series_id: 61, kind: "silent", level: "warning", threshold: 3, enabled: true },
    { series_id: 72, kind: "above", level: "info", threshold: 55, enabled: true },
    { series_id: 13, kind: "gap_above", level: "info", threshold: 3, enabled: true, ref_series_id: 211 },
    { series_id: 13, kind: "fall", level: "info", threshold: 1.1, enabled: true },
    { series_id: 211, kind: "fc_below", level: "info", threshold: 7, enabled: true },
  ];
  private archived = new Set<number>();
  private deleted = new Set<number>();

  async addWeatherStation(label: string, _lat: number, _lon: number) {
    const placeId = Math.max(...places.map((p) => p.id)) + 1;
    const code = `meteo-demo${placeId}`;
    EXTRA_DEFS.push([code, `Météo · ${label}`, "outdoor", 13, 78]);
    places.push({ id: placeId, code, name: `Météo · ${label}`, exposure: "outdoor", parent_id: null, kind: "weather",
                  sort_order: Math.max(...places.filter((p) => p.parent_id === null).map((p) => p.sort_order ?? 0)) + 1 });
    devices.push(weatherDevice(Math.max(...devices.map((d) => d.id)) + 1, placeId, label));
    return delay(placeId);
  }
  async collectWeather() { await delay(null); }
  async placeIssues() {
    const out: { place_id: number; place_name: string; channels: number }[] = [];
    for (const p of places) {
      if (!places.some((c) => c.parent_id === p.id)) continue;
      const n = devices.filter((d) => d.active).flatMap((d) => d.channels).filter((c) => c.place_id === p.id).length;
      if (n) out.push({ place_id: p.id, place_name: p.name, channels: n });
    }
    return delay(out);
  }
  async alertRules(seriesIds: number[]) { return delay(this.rules.filter((r) => seriesIds.includes(r.series_id))); }
  async saveAlertRules(seriesId: number, rules: Omit<AlertRule, "series_id">[]) {
    this.rules = [...this.rules.filter((r) => r.series_id !== seriesId), ...rules.map((r) => ({ ...r, series_id: seriesId }))];
    await delay(null);
  }
  async alertEvents({ since, seriesIds }: { since: number; seriesIds?: number[] }) {
    const info = series();
    const out: AlertEvent[] = [];
    for (const r of this.rules) {
      if (seriesIds && !seriesIds.includes(r.series_id)) continue;
      const s = info.find((x) => x.id === r.series_id);
      if (!s) continue;
      // Identifiant stable : série, règle, début
      if (r.kind === "fc_above" || r.kind === "fc_below") {
        const fc = (await this.seriesForecast([r.series_id], now, now + 86_400_000)).get(r.series_id) ?? [];
        evaluateForecast(fc, r, now).forEach((e) => {
          const id = r.series_id * 1e7 + 9e6 + (r.kind === "fc_below" ? 2e5 : 0) + (r.level === "warning" ? 5e5 : 0);
          if (this.deleted.has(id)) return;
          out.push({ ...e, id, series_id: r.series_id, place_id: s.place_id, place_name: s.place_name,
                     property: s.property, unit: s.unit, archived: this.archived.has(id) });
        });
        continue;
      }
      const ref = r.ref_series_id ? info.find((x) => x.id === r.ref_series_id) : null;
      const pts = (id: number) => rawPoints(id, now - 15 * 86_400_000, now);
      evaluateRule(pts(r.series_id), r, s.property, now, ref ? pts(ref.id) : []).forEach((e) => {
        const id = r.series_id * 1e7 + ["above", "below", "peak", "trough", "silent", "gap_above", "gap_below", "rise", "fall"].indexOf(r.kind) * 1e6
          + (r.level === "warning" ? 5e5 : 0) + Math.round((now - e.started_at) / 60_000) % 5e5;
        if (this.deleted.has(id) || (e.ended_at !== null && e.started_at < since)) return;
        out.push({ ...e, value: Number.isNaN(e.value) ? null : e.value, id, series_id: r.series_id, place_id: s.place_id, place_name: s.place_name,
                   property: s.property, unit: s.unit, archived: this.archived.has(id),
                   ref_series_id: ref?.id ?? null, ref_place_name: ref?.place_name ?? null });
      });
    }
    return delay(out.sort((a, b) => b.started_at - a.started_at));
  }
  async archiveAlerts(ids: number[], archived: boolean) {
    ids.forEach((id) => (archived ? this.archived.add(id) : this.archived.delete(id)));
    await delay(null);
  }
  async deleteAlerts(ids: number[]) { ids.forEach((id) => this.deleted.add(id)); await delay(null); }
  async savePushSubscription(_sub: PushSubscriptionJSON, _level: AlertLevel) { await delay(null); }
  async deletePushSubscription(_endpoint: string) { await delay(null); }
}
