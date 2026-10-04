export type Role = "admin" | "viewer";

export interface CurrentValue {
  series_id: number;
  series_name: string;
  place_id: number;
  place_name: string;
  property: string;
  unit: string;
  ts: string | null;
  value: number | null;
  ma_id: string;
  device_name: string | null;
}

export interface Place {
  id: number;
  code: string;
  name: string;
  parent_id: number | null;
  kind: string | null;
  exposure: "indoor" | "outdoor" | "appliance" | null;
}

export interface Channel {
  id: number;
  channel_no: number;
  label: string | null;
  property: string;
  property_name: string;
  unit: string;
  /** Affectation en cours */
  place_id: number | null;
  since: string | null;
}

export interface Device {
  id: number;
  ma_id: string;
  name: string | null;
  ma_name: string | null;
  model: string | null;
  active: boolean;
  added_at: string;
  retired_at: string | null;
  channels: Channel[];
}

export interface DeviceStats {
  ma_id: string;
  name: string | null;
  active: boolean;
  channels: number | null;
  values: number | null;
  first_ts: string | null;
  last_ts: string | null;
  last_run: string | null;
  status: "OK" | "NO_DATA" | "ERROR" | null;
  message: string | null;
}

export interface Stats {
  db_size_bytes: number;
  tables: Record<string, number>;
  counts: {
    devices: number; active_devices: number; channels: number; places: number; series: number;
    active_deployments: number; corrections: number; annotations: number;
  };
  values: { recent: number; compacted: number; simplified: number; simplified_raw: number };
  devices: DeviceStats[];
  last_maintenance: { run_at: string; details: Record<string, unknown> } | null;
  settings: Record<string, unknown>;
}

export interface Property {
  id: number;
  code: string;
  name: string;
  unit: string;
  simplify_tolerance: number | null;
}

export interface CollectResult {
  ma_id: string;
  status: "OK" | "ERROR" | "SKIPPED";
  received?: number;
  inserted?: number;
  error?: string;
}

export interface SeriesInfo {
  id: number;
  name: string;
  place_id: number;
  place_name: string;
  exposure: Place["exposure"];
  property: string;
  property_name: string;
  unit: string;
}

export interface Point {
  ts: number;          // millisecondes
  value: number;
  quality: "ok" | "corrected" | "rejected";
}

export interface Observation extends Point {
  series_id: number;
}

export interface SeriesStats {
  n: number;
  vmin: number | null;
  tmin: string | null;
  vmax: number | null;
  tmax: string | null;
  vavg: number | null;
  first_ts: string | null;
  last_ts: string | null;
}

export interface PlaceDeployment {
  series_id: number;
  property: string;
  property_name: string;
  ma_id: string;
  device_name: string | null;
  channel_no: number;
  from: string | null;
  to: string | null;
}

export interface Api {
  readonly demo: boolean;
  session(): Promise<{ email: string } | null>;
  onAuthChange(cb: () => void): void;
  signIn(email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  role(): Promise<Role | null>;

  currentValues(): Promise<CurrentValue[]>;
  seriesList(): Promise<SeriesInfo[]>;
  /** Points d'affichage (tous, ou min / max réels par intervalle au-delà de maxPoints) */
  seriesData(ids: number[], from: number, to: number, maxPoints?: number): Promise<Map<number, Point[]>>;
  seriesStats(id: number, from: number, to: number): Promise<SeriesStats>;
  /** Mesures détaillées antérieures à « before », les plus récentes d'abord */
  observations(ids: number[], from: number, before: number, limit: number): Promise<Observation[]>;
  placeDeployments(placeId: number): Promise<PlaceDeployment[]>;
  stats(): Promise<Stats>;
  devices(): Promise<Device[]>;
  places(): Promise<Place[]>;
  properties(): Promise<Property[]>;

  addDevice(maId: string, name: string): Promise<void>;
  renameDevice(id: number, name: string): Promise<void>;
  retireDevice(id: number): Promise<void>;
  reactivateDevice(id: number): Promise<void>;
  assignChannel(channelId: number, placeId: number | null, from: Date): Promise<void>;
  savePlace(place: Omit<Place, "id"> & { id?: number }): Promise<void>;
  deletePlace(id: number): Promise<void>;
  saveSetting(key: string, value: unknown): Promise<void>;
  saveTolerance(propertyId: number, tolerance: number | null): Promise<void>;
  collectNow(maIds?: string[]): Promise<CollectResult[]>;
  runMaintenance(): Promise<Record<string, unknown>>;
}
