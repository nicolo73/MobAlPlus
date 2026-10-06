// Copies d'écran de la documentation (docs/images/), prises sur l'application en mode démo.
//
//   cd web && npm run screenshots
//
// Construit l'application sans configuration Supabase (données fictives), la sert localement,
// puis la parcourt avec Playwright (Chromium : `npx playwright install chromium` la première fois).
// À relancer après une évolution visible de l'interface ; les images sont ensuite à committer.

import { spawn, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const WEB = resolve(import.meta.dirname, "..");
const OUT = resolve(WEB, "../docs/images");
const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;

mkdirSync(OUT, { recursive: true });
const dist = mkdtempSync(join(tmpdir(), "mobalplus-shots-"));
console.log("Construction en mode démo…");
execSync(`npx vite build --outDir "${dist}" --emptyOutDir`, {
  cwd: WEB, stdio: "inherit",
  env: { ...process.env, VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "", VITE_AUTH_GOOGLE: "" },
});
const server = spawn("npx", ["vite", "preview", "--outDir", dist, "--port", String(PORT), "--strictPort"], {
  cwd: WEB, stdio: "ignore", detached: true,
});
const stop = () => { try { process.kill(-server.pid); } catch { /* déjà arrêté */ } };
process.on("exit", stop);
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* pas encore prêt */ }
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const PHONE = { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, colorScheme: "light", locale: "fr-FR" };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Nouvelle page de téléphone, préférences d'affichage données */
async function phone(prefs = {}, options = {}) {
  const ctx = await browser.newContext({ ...PHONE, ...options });
  await ctx.addInitScript((p) => {
    localStorage.setItem("mobalplus.display", JSON.stringify(p));
    localStorage.setItem("mobalplus.news-seen", "x");
  }, prefs);
  return ctx.newPage();
}
async function go(page, hash, ms = 1800) {
  await page.goto(BASE + hash);
  await wait(ms);
}
async function shot(page, name, { scrollTo, top = 70 } = {}) {
  if (scrollTo) {
    await page.locator(scrollTo).first().evaluate((e, t) => scrollTo(0, e.getBoundingClientRect().top + scrollY - t), top);
    await wait(300);
  }
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 82 });
  console.log(`  ${name}.jpg`);
}

console.log("Copies d'écran…");
let p = await phone();
await go(p, "#/");
await shot(p, "maintenant");
await shot(p, "maintenant-groupe", { scrollTo: ".group" });

p = await phone({ density: "compact", hidden: ["humidity"], text: "small" });
await go(p, "#/");
await shot(p, "maintenant-compact");

p = await phone();
await go(p, "#/courbes");
// Une moyenne de groupe et deux emplacements
await p.getByRole("button", { name: "Jardin", exact: true }).click();
await wait(1200);
await shot(p, "courbes", { scrollTo: ".places" });
await shot(p, "courbes-graphique", { scrollTo: "section.card h2" });

p = await phone({}, { viewport: { width: 780, height: 390 } });
await go(p, "#/courbes");
await p.getByRole("button", { name: /^Plein écran/ }).first().click();
await wait(800);
await p.locator(".chart").first().click({ position: { x: 420, y: 160 } });
await wait(400);
await shot(p, "plein-ecran");

p = await phone();
await go(p, "#/lieu/4", 2500);
await shot(p, "emplacement");

p = await phone();
await go(p, "#/lieu/10", 2500); // emplacement parent « Jardin » de la démo
await shot(p, "groupe");

p = await phone();
await go(p, "#/donnees");
await shot(p, "donnees");

p = await phone();
await go(p, "#/options");
await shot(p, "options");
await shot(p, "options-tendances", { scrollTo: ".legend", top: 120 });

p = await phone();
await go(p, "#/admin/partage");
await p.getByLabel("Adresse e-mail").fill("marie@exemple.fr");
await p.getByRole("button", { name: "Inviter" }).click();
await wait(600);
await shot(p, "partage", { scrollTo: "[aria-label=\"Envoyer l'invitation\"]", top: 60 });

p = await phone();
await go(p, "#/admin/emplacements");
await shot(p, "admin-emplacements");

// Aperçu sur ordinateur, pour la documentation technique
const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: "light", locale: "fr-FR" });
await desk.addInitScript(() => localStorage.setItem("mobalplus.news-seen", "x"));
p = await desk.newPage();
await go(p, "#/courbes");
await p.getByRole("button", { name: "Jardin", exact: true }).click();
await wait(1200);
await shot(p, "apercu-ordinateur");

await browser.close();
stop();
console.log(`Images dans ${OUT}`);
process.exit(0);
