// Textes éditables de l'application (dossier docs/ du dépôt), intégrés au moment de la construction.

import { marked } from "marked";
import aboutMd from "../../../docs/a-propos.md?raw";
import newsMd from "../../../docs/nouveautes.md?raw";

const stripComments = (md: string) => md.replace(/<!--[\s\S]*?-->/g, "").trim();

// Contenu du dépôt (de confiance) : rendu Markdown simple, liens ouverts dans un nouvel onglet
marked.use({
  gfm: true,
  renderer: {
    link({ href, text }) {
      const external = /^https?:/.test(href);
      return `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ""}>${text}</a>`;
    },
  },
});

export const aboutHtml = marked.parse(stripComments(aboutMd), { async: false });
export const newsHtml = marked.parse(stripComments(newsMd), { async: false });

/** Empreinte des nouveautés : sert à signaler qu'il y a du nouveau depuis la dernière visite */
export const newsVersion = (() => {
  let h = 0;
  for (const c of stripComments(newsMd)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return String(h >>> 0);
})();

const SEEN = "mobalplus.news-seen";
export function hasUnseenNews(): boolean {
  try { return localStorage.getItem(SEEN) !== newsVersion; } catch { return false; }
}
export function markNewsSeen() {
  try { localStorage.setItem(SEEN, newsVersion); } catch { /* stockage indisponible */ }
}

export const buildInfo = { date: __BUILD_DATE__, commit: __COMMIT__ };
