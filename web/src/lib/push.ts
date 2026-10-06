// Notifications des alertes sur cet appareil (Web Push). La clé publique VAPID est fournie à la
// construction (VITE_VAPID_PUBLIC_KEY) ; sans elle, les notifications ne sont pas proposées.

import { api } from "./api";
import type { AlertLevel } from "./types";

const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
const LEVEL = "mobalplus.push-level";

export const pushConfigured = () => !!KEY;
export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
/** iPhone / iPad : les notifications ne fonctionnent qu'une fois l'application installée */
export const needsInstall = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone
  && !matchMedia("(display-mode: standalone)").matches;

function keyBytes(base64: string) {
  const s = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export function savedLevel(): AlertLevel {
  try { return localStorage.getItem(LEVEL) === "info" ? "info" : "warning"; } catch { return "warning"; }
}

export async function subscribe(level: AlertLevel) {
  if (!KEY) throw new Error("Notifications non configurées (clé VAPID absente).");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications refusées : les autoriser dans les réglages du navigateur.");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) });
  await api.savePushSubscription(sub.toJSON(), level);
  try { localStorage.setItem(LEVEL, level); } catch { /* ignoré */ }
}

export async function unsubscribe() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.deletePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
