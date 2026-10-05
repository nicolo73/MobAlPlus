import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Api, Channel, CollectResult, Context, Device, HomeRole, Member, Observation, Place, PlaceDeployment, Point,
  Property, SeriesInfo, SeriesStats, Stats,
} from "./types";

/** Bornes d'un tstzrange renvoyé par PostgREST, ex. ["2026-02-01 00:00:00+00",) */
export function parseRange(range: string): [string | null, string | null] {
  const m = range.match(/^[[(]"?([^",]*)"?,"?([^")\]]*)"?[\])]$/);
  if (!m) return [null, null];
  const iso = (s: string) => (s && !s.endsWith("infinity") ? new Date(s.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString() : null);
  return [iso(m[1]), iso(m[2])];
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

interface DeviceRow {
  id: number; ma_id: string; name: string | null; ma_name: string | null; model: string | null;
  active: boolean; added_at: string; retired_at: string | null;
  device_channel: {
    id: number; channel_no: number; label: string | null;
    observed_property: { code: string; name: string; unit: string };
    deployment: { valid: string; series: { place_id: number } }[];
  }[];
}

export class SupabaseApi implements Api {
  readonly demo = false;
  private sb: SupabaseClient;
  private homeId: number | null = null;

  constructor(url: string, key: string) {
    this.sb = createClient(url, key);
  }

  async session() {
    const { data } = await this.sb.auth.getSession();
    return data.session ? { email: data.session.user.email ?? "" } : null;
  }

  onAuthChange(cb: () => void) {
    // Rappel différé : appeler Supabase directement dans ce callback peut bloquer le client
    this.sb.auth.onAuthStateChange(() => setTimeout(cb, 0));
  }

  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === "Invalid login credentials" ? "Identifiants incorrects" : error.message);
  }

  async signInWithGoogle() {
    const { error } = await this.sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) throw new Error(error.message);
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  async signUp(email: string, password: string): Promise<"ok" | "confirm"> {
    const { data, error } = await this.sb.auth.signUp({
      email, password, options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) throw new Error(error.message);
    return data.session ? "ok" : "confirm";
  }

  async context(): Promise<Context> {
    await this.sb.rpc("claim_invitations");
    return check(await this.sb.rpc("my_context")) as Context;
  }

  setHome(homeId: number | null) {
    this.homeId = homeId;
  }

  async createHome(name: string) {
    return check(await this.sb.rpc("create_home", { p_name: name })) as number;
  }

  async renameHome(id: number, name: string) {
    check(await this.sb.from("home").update({ name }).eq("id", id));
  }

  async members(homeId: number) {
    return check(await this.sb.from("home_member").select("id, home_id, email, user_id, role, created_at")
      .eq("home_id", homeId).order("email")) as Member[];
  }

  async addMember(homeId: number, email: string, role: HomeRole) {
    const { data } = await this.sb.auth.getSession();
    check(await this.sb.from("home_member").insert({
      home_id: homeId, email: email.trim().toLowerCase(), role, invited_by: data.session?.user.email ?? null,
    }));
  }

  async setMemberRole(id: number, role: HomeRole) {
    check(await this.sb.from("home_member").update({ role }).eq("id", id));
  }

  async removeMember(id: number) {
    check(await this.sb.from("home_member").delete().eq("id", id));
  }

  async currentValues() {
    return check(await this.sb.rpc("current_values", { p_home: this.homeId })) ?? [];
  }

  async seriesList(): Promise<SeriesInfo[]> {
    const rows = check(await this.sb.from("series")
      .select("id, name, place_id, place!inner(name, exposure, home_id), observed_property(code, name, unit)")
      .eq("place.home_id", this.homeId ?? -1)
      .order("id")) as unknown as {
        id: number; name: string; place_id: number; place: { name: string; exposure: Place["exposure"] };
        observed_property: { code: string; name: string; unit: string };
      }[];
    return rows.map((r) => ({
      id: r.id, name: r.name, place_id: r.place_id, place_name: r.place.name, exposure: r.place.exposure,
      property: r.observed_property.code, property_name: r.observed_property.name, unit: r.observed_property.unit,
    }));
  }

  async seriesData(ids: number[], from: number, to: number, maxPoints = 1000) {
    // Un appel par série : l'API Supabase plafonne chaque réponse (1000 lignes par défaut)
    const lists = await Promise.all(ids.map(async (id) => {
      const rows = check(await this.sb.rpc("series_data", {
        p_series: id, p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString(),
        p_max_points: Math.min(maxPoints, 1000),
      })) as { ts: string; value: number; quality: Point["quality"] }[];
      return [id, rows.map((r) => ({ ts: Date.parse(r.ts), value: r.value, quality: r.quality }))] as const;
    }));
    return new Map<number, Point[]>(lists);
  }

  async seriesStats(id: number, from: number, to: number) {
    const rows = check(await this.sb.rpc("series_stats", {
      p_series: id, p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString(),
    })) as SeriesStats[];
    return rows[0];
  }

  async observations(ids: number[], from: number, before: number, limit: number): Promise<Observation[]> {
    const lists = await Promise.all(ids.map(async (id) => {
      const rows = check(await this.sb.rpc("series_observations", {
        p_series: id, p_from: new Date(from).toISOString(), p_to: new Date(before).toISOString(),
      }).order("ts", { ascending: false }).limit(limit)) as { ts: string; value: number; quality: Point["quality"] }[];
      return rows.map((r) => ({ series_id: id, ts: Date.parse(r.ts), value: r.value, quality: r.quality }));
    }));
    return lists.flat();
  }

  async placeDeployments(placeId: number): Promise<PlaceDeployment[]> {
    const rows = check(await this.sb.from("series")
      .select("id, observed_property(code, name), deployment(valid, device_channel(channel_no, device(ma_id, name, ma_name)))")
      .eq("place_id", placeId)) as unknown as {
        id: number; observed_property: { code: string; name: string };
        deployment: { valid: string; device_channel: { channel_no: number; device: { ma_id: string; name: string | null; ma_name: string | null } } }[];
      }[];
    return rows.flatMap((s) => s.deployment.map((d) => {
      const [from, to] = parseRange(d.valid);
      return {
        series_id: s.id, property: s.observed_property.code, property_name: s.observed_property.name,
        ma_id: d.device_channel.device.ma_id, device_name: d.device_channel.device.name ?? d.device_channel.device.ma_name,
        channel_no: d.device_channel.channel_no, from, to,
      };
    })).sort((a, b) => (b.from ?? "").localeCompare(a.from ?? ""));
  }

  async stats() {
    return check(await this.sb.rpc("admin_stats")) as Stats;
  }

  async devices(): Promise<Device[]> {
    const rows = check(await this.sb.from("device")
      .select("id, ma_id, name, ma_name, model, active, added_at, retired_at, " +
              "device_channel(id, channel_no, label, observed_property(code, name, unit), " +
              "deployment(valid, series(place_id)))")
      .eq("home_id", this.homeId ?? -1)
      .order("ma_id")) as unknown as DeviceRow[];
    return rows.map((d) => ({
      ...d,
      channels: d.device_channel
        .sort((a, b) => a.channel_no - b.channel_no)
        .map((c): Channel => {
          const open = c.deployment.map((dep) => ({ dep, range: parseRange(dep.valid) }))
            .find((x) => x.range[1] === null);
          return {
            id: c.id, channel_no: c.channel_no, label: c.label,
            property: c.observed_property.code, property_name: c.observed_property.name,
            unit: c.observed_property.unit,
            place_id: open?.dep.series.place_id ?? null, since: open?.range[0] ?? null,
          };
        }),
    }));
  }

  async places() {
    return check(await this.sb.from("place").select("id, code, name, parent_id, kind, exposure")
      .eq("home_id", this.homeId ?? -1).order("name")) as Place[];
  }

  async properties() {
    return check(await this.sb.from("observed_property").select("*").order("id")) as Property[];
  }

  async addDevice(maId: string, name: string) {
    const res = await this.sb.from("device").insert({ ma_id: maId.trim().toUpperCase(), name: name || null, home_id: this.homeId });
    if (res.error?.code === "23505") throw new Error("Ce capteur est déjà déclaré (peut-être dans une autre maison).");
    check(res);
  }

  async renameDevice(id: number, name: string) {
    check(await this.sb.from("device").update({ name: name || null }).eq("id", id));
  }

  async retireDevice(id: number) {
    check(await this.sb.rpc("retire_device", { p_device: id }));
  }

  async reactivateDevice(id: number) {
    check(await this.sb.from("device").update({ active: true, retired_at: null }).eq("id", id));
  }

  async assignChannel(channelId: number, placeId: number | null, from: Date) {
    check(await this.sb.rpc("assign_channel", { p_channel: channelId, p_place: placeId, p_from: from.toISOString() }));
  }

  async savePlace(place: Omit<Place, "id"> & { id?: number }) {
    const { id, ...fields } = place;
    if (id) check(await this.sb.from("place").update(fields).eq("id", id));
    else check(await this.sb.from("place").insert({ ...fields, home_id: this.homeId }));
  }

  async deletePlace(id: number) {
    check(await this.sb.from("place").delete().eq("id", id));
  }

  async saveSetting(key: string, value: unknown) {
    check(await this.sb.from("app_setting").update({ value }).eq("key", key));
  }

  async saveTolerance(propertyId: number, tolerance: number | null) {
    check(await this.sb.from("observed_property").update({ simplify_tolerance: tolerance }).eq("id", propertyId));
  }

  async collectNow(maIds?: string[]): Promise<CollectResult[]> {
    const { data, error } = await this.sb.functions.invoke("collect", { body: maIds ? { devices: maIds } : {} });
    if (error) throw new Error(error.message);
    return (data as { results: CollectResult[] }).results;
  }

  async runMaintenance() {
    return check(await this.sb.rpc("admin_run_maintenance")) as Record<string, unknown>;
  }
}
