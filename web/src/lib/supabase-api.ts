import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Api, Channel, CollectResult, Device, Place, Property, Role, Stats } from "./types";

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

  async role(): Promise<Role | null> {
    return (check(await this.sb.rpc("my_role")) as Role | null) ?? null;
  }

  async currentValues() {
    return check(await this.sb.rpc("current_values")) ?? [];
  }

  async stats() {
    return check(await this.sb.rpc("admin_stats")) as Stats;
  }

  async devices(): Promise<Device[]> {
    const rows = check(await this.sb.from("device")
      .select("id, ma_id, name, ma_name, model, active, added_at, retired_at, " +
              "device_channel(id, channel_no, label, observed_property(code, name, unit), " +
              "deployment(valid, series(place_id)))")
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
    return check(await this.sb.from("place").select("id, code, name, parent_id, kind, exposure").order("name")) as Place[];
  }

  async properties() {
    return check(await this.sb.from("observed_property").select("*").order("id")) as Property[];
  }

  async addDevice(maId: string, name: string) {
    check(await this.sb.from("device").insert({ ma_id: maId.trim().toUpperCase(), name: name || null }));
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
    else check(await this.sb.from("place").insert(fields));
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
