// Textes éditables de l'application (dossier docs/ du dépôt), intégrés au moment de la construction.

import { marked } from "marked";
import aboutMd from "../../../docs/a-propos.md?raw";
import newsMd from "../../../docs/nouveautes.md?raw";
import guideMd from "../../../docs/guide-utilisateur.md?raw";

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
// Images de docs/images/ : intégrées à la construction (adresses avec empreinte, chargées à la demande)
const images = import.meta.glob("../../../docs/images/*.{jpg,png,webp}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const imageUrl = (src: string) => images[`../../../docs/${src}`] ?? src;
const withImages = (html: string) => html.replace(/src="(images\/[^"]+)"/g, (_, src) => `src="${imageUrl(src)}" loading="lazy"`);

export const guideHtml = withImages(marked.parse(stripComments(guideMd), { async: false }));

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
