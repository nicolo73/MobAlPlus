// Compte connecté et maison courante, partagés par toutes les pages.

import { api } from "./api";
import type { HomeInfo } from "./types";

const STORE = "mobalplus.home";

export const ctx = $state({
  loaded: false,
  email: null as string | null,
  platformAdmin: false,
  homes: [] as HomeInfo[],
  homeId: null as number | null,
});

export const currentHome = (): HomeInfo | null => ctx.homes.find((h) => h.id === ctx.homeId) ?? null;
export const canEdit = () => ctx.platformAdmin || ["owner", "editor"].includes(currentHome()?.role ?? "");
export const isOwner = () => ctx.platformAdmin || currentHome()?.role === "owner";

export function selectHome(id: number | null) {
  ctx.homeId = id;
  api.setHome(id);
  try { if (id !== null) localStorage.setItem(STORE, String(id)); } catch { /* stockage indisponible */ }
}

export async function loadContext() {
  const c = await api.context();
  ctx.email = c.email;
  ctx.platformAdmin = c.platform_admin;
  ctx.homes = c.homes;
  let saved: number | null = null;
  try { saved = Number(localStorage.getItem(STORE)) || null; } catch { /* stockage indisponible */ }
  const keep = c.homes.find((h) => h.id === (ctx.homeId ?? saved));
  selectHome(keep?.id ?? c.homes[0]?.id ?? null);
  ctx.loaded = true;
}

export function resetContext() {
  ctx.loaded = false;
  ctx.homes = [];
  ctx.platformAdmin = false;
  selectHome(null);
}
