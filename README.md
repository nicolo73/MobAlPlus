# MobAlPlus

Historisation et visualisation des capteurs **Mobile Alerts** (températures, hygrométrie…),
au-delà des 3 mois conservés par le service officiel.

État : **V0** : base de données, collecteur et import de l'historique des tableurs.
L'interface (PWA web et mobile) viendra ensuite. Voir [docs/architecture.md](docs/architecture.md).

## Démarrage

```bash
# 1. Base de données (PostgreSQL + TimescaleDB + PostGIS)
docker compose up -d

# 2. Outils Python
cd backend && pip install -e ".[dev]" && cd ..

# 3. Configuration (fichiers ignorés par Git)
cp .env.example .env                                  # renseigner MA_VENDOR_ID
cp config/devices.example.yaml config/devices.yaml    # renseigner les vrais ID des capteurs

# 4. Schéma et référentiel
python -m mobalplus init-db
python -m mobalplus load-config config/devices.yaml
```

## Reprise de l'historique

Exporter chaque Google Sheet en `.xlsx` (Fichier > Télécharger > Microsoft Excel) dans `data/`,
puis :

```bash
python -m mobalplus import-sheets data/*.xlsx
```

- Chaque onglet de mesures est reconnu par sa structure (« Device ID » en A1). L'onglet Config et
  les onglets sans mesures sont ignorés.
- La cellule `columns` de chaque onglet (ex. `1;2`, `3;4`) rattache les valeurs aux bons canaux du
  capteur : `01-Salon` et `01-Ext` alimentent le même capteur, sur des canaux différents.
- L'import peut être relancé autant de fois que nécessaire : les mesures déjà présentes sont
  ignorées. Les fichiers qui se chevauchent (duplication annuelle) ne créent donc pas de doublons.
- Un export `.csv` par onglet est aussi accepté.

## Collecte

```bash
python -m mobalplus collect      # à planifier toutes les 10 minutes (cron, systemd timer…)
python -m mobalplus status       # état de la collecte par capteur
```

Exemple de crontab : `*/10 * * * * cd /opt/mobalplus && .venv/bin/python -m mobalplus collect`

## Tests

```bash
cd backend
pytest                                            # tests unitaires
TEST_DATABASE_URL=postgresql://… pytest           # + tests sur base (la base est réinitialisée)
```
