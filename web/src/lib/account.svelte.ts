// Options du compte (table user_options, un document JSON) : synthèses de chaque maison et
// préférences d'affichage. Lues à la connexion (elles remplacent celles de l'appareil), puis
// enregistrées après chaque modification. Sans la table (base pas encore à jour) ou hors ligne :
// réglages de l'appareil seulement.

import { api } from "./api";
import { allDashboards, replaceDashboards, setDashboardsSaveHook } from "./dashboards";
import { accountDisplay, applyAccountDisplay, setDisplaySaveHook } from "./display.svelte";

export const account = $state({ synced: false, error: "" });

let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false;

export async function loadAccountOptions() {
  // Session renouvelée avec une modification pas encore envoyée : on l'envoie plutôt que de l'écraser
  if (account.synced && pending) {
    clearTimeout(timer);
    await save();
    return;
  }
  account.synced = false;
  try {
    const o = await api.userOptions();
    if (o && Object.keys(o).length) {
      applyAccountDisplay(o.display);
      replaceDashboards(o.dashboards);
    } else {
      // Premier passage pour ce compte : il reprend les réglages de cet appareil
      pending = true;
    }
    account.synced = true;
    account.error = "";
    if (pending) schedule(0);
  } catch (e) {
    account.error = e instanceof Error ? e.message : String(e);
  }
}

function schedule(ms = 1500) {
  pending = true;
  clearTimeout(timer);
  if (account.synced) timer = setTimeout(save, ms);
}

async function save() {
  if (!account.synced || !pending) return;
  pending = false;
  try {
    await api.saveUserOptions({ display: accountDisplay(), dashboards: allDashboards() });
    account.error = "";
  } catch (e) {
    pending = true;
    account.error = e instanceof Error ? e.message : String(e);
  }
}

setDisplaySaveHook(() => schedule());
setDashboardsSaveHook(() => schedule());
// Page quittée ou mise en arrière-plan : on n'attend pas le délai
addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && pending) { clearTimeout(timer); save(); } });
