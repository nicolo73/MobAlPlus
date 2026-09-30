# Architecture MobAlPlus

## Vue d'ensemble

```
 measurements.mobile-alerts.eu ──► collecteur (Python, toutes les 10 min)
      (page MeasurementDetails)            │
                                           ▼
 exports .xlsx / .csv des tableurs ──► PostgreSQL (+ TimescaleDB, + PostGIS)
      (historique depuis 2020)             │
                                           ▼
                                  API ──► PWA (web + mobile)      [à venir]
```

## Source des données

La page `Home/MeasurementDetails?deviceid=…&vendorid=…&fromepoch=…&toepoch=…` renvoie **toutes**
les mesures d'un intervalle (l'API REST publique ne donne que la dernière). Le collecteur l'appelle
de façon incrémentale depuis la dernière mesure reçue, par fenêtres d'un jour : aucune perte si le
collecteur s'arrête quelques jours (le site conserve ~3 mois).

Particularités reprises du script d'origine :

- `fromepoch` / `toepoch` sont l'heure **locale** encodée comme si c'était de l'UTC ;
- les dates affichées sont locales (Europe/Paris) : conversion en UTC, avec levée d'ambiguïté
  au passage à l'heure d'hiver grâce à l'ordre chronologique des mesures ;
- le site semble n'enregistrer une mesure que lorsque la valeur change : les courbes doivent être
  tracées en escalier, et un capteur « muet » se détecte via l'état de collecte.

## Modèle de données (`db/schema.sql`)

Le **capteur** est découplé de l'**emplacement** :

| Table | Rôle | Équivalent SensorThings |
|---|---|---|
| `device`, `device_channel` | capteur physique et ses colonnes de mesure | Thing / Sensor |
| `place` | pièce, zone extérieure, appareil (hiérarchique, position) | Location |
| `series` | courbe affichée = emplacement × grandeur | Datastream |
| `deployment` | affectation datée d'un canal à une série | (HistoricalLocation) |
| `reading` | mesures brutes, immuables, par canal | Observation |
| `correction` | valeurs rejetées / corrigées, sans toucher au brut | resultQuality |
| `annotation` | commentaires sur une période | — |
| `device_sync` | état de collecte par capteur | — |

- Déplacer ou remplacer un capteur = clôturer une affectation et en ouvrir une autre. Les
  contraintes d'exclusion garantissent qu'un canal n'est qu'à un endroit à la fois et qu'une série
  n'a qu'une source à la fois.
- La vue `observation` rattache chaque mesure à sa série au moment de la lecture : corriger une
  date de déplacement ne réécrit aucune mesure.
- `series_hourly` (min / max / moyenne par heure) sert à l'affichage des longues périodes.

## Volumétrie et hébergement

Mesuré : ~80 octets par valeur sur disque (index compris), sans compression.
L'historique complet (2020 → aujourd'hui) représente de l'ordre de 10 millions de valeurs, soit
~0,8 Go sans compression, et +2 millions de valeurs par an.

- L'offre gratuite de Supabase (500 Mo) est donc trop juste pour tout l'historique.
- Avec TimescaleDB (compression des données de plus de 30 jours, activée automatiquement par le
  schéma si l'extension est présente), le volume est divisé par ~10.

Recommandation : auto-hébergement (VM Oracle Cloud « Always Free » ou Raspberry Pi) avec
`docker-compose.yml` (PostgreSQL 16 + TimescaleDB + PostGIS). Le schéma reste compatible avec un
PostgreSQL standard.
