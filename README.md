# MobAlPlus

Historisation et visualisation des capteurs **Mobile Alerts** (températures, hygrométrie…),
au-delà des 3 mois conservés par le service officiel.

- **Architecture et technologies** (schémas) : [docs/architecture.md](docs/architecture.md)
- **Modèle de données** (schémas des tables) : [docs/modele-donnees.md](docs/modele-donnees.md)
- **Guide d'utilisation** (aussi affiché dans l'application, page Aide) : [docs/guide-utilisateur.md](docs/guide-utilisateur.md)
- **Mise en place Supabase** (pas à pas) : [docs/supabase-setup.md](docs/supabase-setup.md)
- **Mise en ligne de l'application** (Cloudflare Pages) : [docs/deploiement-web.md](docs/deploiement-web.md)
- **Évolutions prévues** : [docs/ROADMAP.md](docs/ROADMAP.md)
- **Page « À propos » de l'application** : textes modifiables directement sur GitHub,
  [docs/a-propos.md](docs/a-propos.md) (présentation) et [docs/nouveautes.md](docs/nouveautes.md)
  (nouveautés, les plus récentes en haut) ; l'application est reconstruite automatiquement.

## État

| Brique | État |
|---|---|
| Base de données Supabase (schéma, sécurité, stockage en 3 niveaux, simplification) | ✅ |
| Collecteur serverless (Edge Function, toutes les 10 minutes) | ✅, à valider sur le vrai site |
| Import de l'historique des Google Sheets | ✅ |
| PWA : valeurs actuelles, administration (statistiques, capteurs, emplacements, maintenance) | ✅ (mode démo sans Supabase) |
| PWA : page par emplacement (courbes, statistiques, mesures, capteurs), courbes superposées avec périodes et glissement | ✅ |
| Suite (maisons et partage, alertes, météo, corrections…) | voir [ROADMAP](docs/ROADMAP.md) |

## Organisation du dépôt

```
supabase/migrations/     schéma, fonctions SQL, sécurité, tâches planifiées
supabase/functions/      Edge Function « collect » (TypeScript / Deno)
web/                     application PWA (Svelte + Vite), hébergée sur Cloudflare Pages
backend/                 outils Python : import des tableurs, chargement de la config, rattrapage
config/                  référentiel des capteurs (exemple ; le vrai fichier est ignoré par Git)
docs/                    architecture et mise en place
```

## Outils en ligne de commande (PC)

```bash
cd backend && pip install -e . && cd ..
cp .env.example .env                       # DATABASE_URL = chaîne de connexion Supabase
python -m mobalplus load-config config/devices.yaml
python -m mobalplus import-sheets data/*.xlsx
python -m mobalplus status
python -m mobalplus collect --device 07XXXXXXXXXX -v    # collecte manuelle (nécessite MA_VENDOR_ID)
python -m mobalplus maintenance                         # compactage / simplification immédiats
```

Reprise de l'historique : exporter chaque Google Sheet en `.xlsx` dans `data/`. Chaque onglet de
mesures est reconnu par sa structure (« Device ID » en A1) et la cellule `columns` (`1;2`, `3;4`)
rattache les valeurs aux bons canaux. L'import est relançable sans doublon, même avec des fichiers
annuels qui se chevauchent.

## Tests

Les tests tournent automatiquement sur GitHub (workflow *Tests*). En local, avec un PostgreSQL 15+
vide (la base est réinitialisée) :

```bash
export TEST_DATABASE_URL=postgresql://…
cd backend && pip install -e ".[dev]" && pytest          # migrations, import, collecteur, sécurité
cd ../supabase && npm ci && npm test                      # Edge Function (Node 22.18+)
```
