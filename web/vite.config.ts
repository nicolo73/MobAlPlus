import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";

import { execSync } from "node:child_process";

// Version affichée dans « À propos » : commit fourni par Cloudflare Pages, sinon celui du dépôt local
const commit = (process.env.CF_PAGES_COMMIT_SHA ?? (() => {
  try { return execSync("git rev-parse HEAD").toString().trim(); } catch { return ""; }
})()).slice(0, 7);

export default defineConfig({
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __COMMIT__: JSON.stringify(commit),
  },
  // Les textes de la page « À propos » sont dans docs/ (hors du dossier web)
  server: { fs: { allow: [".."] } },
  // ECharts (chargé à la demande) dépasse le seuil d'avertissement par défaut
  build: { chunkSizeWarningLimit: 700 },
  plugins: [
    svelte(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "MobAlPlus",
        short_name: "MobAlPlus",
        description: "Historique et courbes des capteurs Mobile Alerts",
        lang: "fr",
        theme_color: "#0f766e",
        background_color: "#f7f8f7",
        display: "standalone",
        start_url: "./",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Les données viennent de Supabase : jamais mises en cache par le service worker
        navigateFallbackDenylist: [/^\/functions\//],
        // Notifications d'alertes (public/push-sw.js)
        importScripts: ["push-sw.js"],
      },
    }),
  ],
});
