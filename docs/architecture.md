# Architecture MobAlPlus

## Vue d'ensemble

Uniquement des services cloud gérés, sur leurs offres gratuites : aucune machine à administrer.

```
                         Supabase (offre gratuite)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ pg_cron ─(10 min)─► Edge Function « collect » ──► measurements.mobile-alerts.eu
 │                              │
 │                              ▼
 │                PostgreSQL : récent ─(nuit)─► compacté ─(> 3 ans)─► simplifié
 │                              │
 │                    Auth + API (RLS)                                      │
 └──────────────────────────────┼───────────────────────────────────────────┘
                                ▼
           PWA statique (Cloudflare Pages) : courbes, administration
           installable sur mobile ; APK Play Store possible ensuite (TWA)

 PC (ponctuel) : python -m mobalplus import-sheets  ──► historique des Google Sheets
```

| Élément | Où | Code |
|---|---|---|
| Base de données, sécurité, tâches planifiées | Supabase | `supabase/migrations/` |
| Collecteur | Supabase Edge Function (Deno) | `supabase/functions/collect/` |
| Import de l'historique, rattrapage manuel | PC (Python) | `backend/` |
| Application web et mobile (PWA) | Cloudflare Pages | `web/` |

Mise en place : [supabase-setup.md](supabase-setup.md), puis [deploiement-web.md](deploiement-web.md).

## Source des données

La page `Home/MeasurementDetails?deviceid=…&vendorid=…&fromepoch=…&toepoch=…` renvoie **toutes**
les mesures d'un intervalle (l'API REST publique ne donne que la dernière).

- Collecte incrémentale depuis la dernière mesure reçue, par fenêtres d'un jour, 10 jours au plus
  par passage : après une interruption, le retard (90 jours au maximum, durée de conservation du
  site) se rattrape sur les passages suivants.
- Relecture quotidienne des 3 derniers jours, pour les mesures transmises en retard par la passerelle.
- `fromepoch` / `toepoch` sont l'heure **locale** encodée comme si c'était de l'UTC ; les dates
  affichées sont locales (Europe/Paris) et converties en UTC, avec levée d'ambiguïté au passage à
  l'heure d'hiver grâce à l'ordre chronologique des mesures.
- Le site semble n'enregistrer une mesure que lorsque la valeur change : courbes en escalier.

## Modèle de données

Le **capteur** est découplé de l'**emplacement** :

| Table | Rôle | Équivalent SensorThings |
|---|---|---|
| `device`, `device_channel` | capteur physique et ses colonnes de mesure | Thing / Sensor |
| `place` | pièce, zone extérieure, appareil (hiérarchique, position) | Location |
| `series` | courbe affichée = emplacement × grandeur | Datastream |
| `deployment` | affectation datée d'un canal à une série | (HistoricalLocation) |
| `reading`, `reading_day` | mesures brutes, par canal | Observation |
| `correction` | valeurs rejetées / corrigées, sans toucher au brut | resultQuality |
| `annotation` | commentaires sur une période | — |
| `device_sync`, `maintenance_log` | état de la collecte et de la maintenance | — |
| `app_setting`, `app_user` | paramètres, utilisateurs et rôles | — |

- Déplacer ou remplacer un capteur = clôturer une affectation et en ouvrir une autre. Les
  contraintes d'exclusion garantissent qu'un canal n'est qu'à un endroit à la fois et qu'une série
  n'a qu'une source à la fois.
- Le rattachement d'une mesure à sa série est calculé à la lecture : corriger une date de
  déplacement ne réécrit aucune mesure. Les corrections s'appliquent aussi à la lecture, quel que
  soit le niveau de stockage.

## Stockage en trois niveaux

| Âge (réglable) | Stockage | Contenu | Coût mesuré |
|---|---|---|---|
| 0 – 90 jours | `reading` : une ligne par valeur | tous les points | ~84 octets / valeur |
| 90 jours – 3 ans | `reading_day` : une ligne par canal et par jour (tableaux de points) | tous les points, **sans perte** | ~10 octets / valeur |
| au-delà de 3 ans | `reading_day` (simplifié) | points significatifs : extrêmes du jour, crêtes, creux, ruptures de pente | quelques % des points |

- Compactage et simplification chaque nuit (`run_maintenance()`), paramètres dans `app_setting`.
- Simplification : premier et dernier point, minimum et maximum du jour, puis Douglas-Peucker sur
  l'écart vertical, avec une tolérance par grandeur (`observed_property.simplify_tolerance` :
  0,2 °C, 2 % HR ; pluie jamais simplifiée). Les points conservés sont de **vrais points**
  (horodatage et valeur d'origine). Les valeurs rejetées sont écartées avant simplification.
- Estimation : 3 ans pour 13 capteurs ≈ 110 Mo, pour un quota gratuit de 500 Mo.

## Lecture pour l'affichage

`series_data(série, début, fin, max_points)` renvoie tous les points si leur nombre est inférieur
à `max_points`, sinon le minimum et le maximum de chaque intervalle : les pics restent visibles
quelle que soit l'échelle, et ce sont toujours des mesures réelles.

## Sécurité

- **Maisons** : emplacements et capteurs appartiennent à une maison (`home`). Les membres
  (`home_member`, désignés par leur e-mail, invitables avant leur première connexion) ont un rôle
  `owner`, `editor` ou `viewer`. L'administrateur de la plateforme (`app_user.role = 'admin'`) voit
  toutes les maisons et seul il accède aux statistiques globales et à la maintenance.
- **Row Level Security** sur toutes les tables : chaque règle compare l'identifiant de la ligne à
  la liste des maisons / capteurs / séries accessibles, calculée **une fois par requête**
  (`(SELECT my_channel_ids())::int[]`), jamais par ligne.
- Cohérence : un capteur ne peut alimenter qu'un emplacement de sa maison ; une maison garde
  toujours au moins un propriétaire.
- Le collecteur utilise la clé *service_role* ; il n'accepte que le jeton de pg_cron,
  l'administrateur, ou un gestionnaire de maison pour ses propres capteurs (`can_collect`).
- Identifiants Mobile Alerts : secrets de l'Edge Function et fichiers locaux ignorés par Git.
