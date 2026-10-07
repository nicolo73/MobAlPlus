# Modèle de données

Base PostgreSQL (Supabase). Schéma défini par les fichiers de `supabase/migrations/`, appliqués dans
l'ordre de leur nom. Vue d'ensemble dans [architecture.md](architecture.md#modèle-de-données).

> Schémas en [Mermaid](https://mermaid.js.org) : modifiables directement sur GitHub (✏️) ou dans
> [mermaid.live](https://mermaid.live). Penser à les mettre à jour avec chaque nouvelle migration.

## Vue synthétique

Les cinq notions à retenir, et leur équivalent dans le standard OGC SensorThings :

```mermaid
flowchart LR
  device["📡 <b>Capteur</b><br/>device<br/><i>Thing</i>"] -->|a des| channel["<b>Canal</b><br/>device_channel<br/><i>Sensor</i>"]
  channel -->|produit des| reading[("<b>Mesures</b><br/>reading, reading_day<br/><i>Observation</i>")]
  channel -->|"affecté (daté) à"| series["📈 <b>Série</b><br/>series<br/><i>Datastream</i>"]
  place["📍 <b>Emplacement</b><br/>place<br/><i>Location</i>"] -->|a une série par grandeur| series
  home["🏠 <b>Maison</b><br/>home"] -->|contient| place
  home -->|contient| device
```

- Un **capteur** (ex. une sonde thermo-hygro) a un ou plusieurs **canaux**, chacun mesurant une
  grandeur (température, humidité…).
- Un **emplacement** (Salon, Jardin…) a une **série** par grandeur : c'est la courbe affichée.
- Une **affectation** (`deployment`) relie un canal à une série pendant une période : déplacer ou
  remplacer un capteur, c'est fermer une affectation et en ouvrir une autre ; l'historique de la
  série reste continu.
- Les **mesures** sont stockées par canal, jamais modifiées ; corrections et annotations sont à part.

## Schéma détaillé

```mermaid
erDiagram
  home ||--o{ home_member : "membres"
  home ||--o{ place : "contient"
  home ||--o{ device : "contient"
  place ||--o{ place : "parent de"
  place ||--o{ series : "une par grandeur"
  observed_property ||--o{ series : "grandeur"
  observed_property ||--o{ device_channel : "grandeur"
  device ||--o{ device_channel : "canaux"
  device ||--o| device_sync : "état de collecte"
  device_channel ||--o{ deployment : "affecté"
  series ||--o{ deployment : "alimentée par"
  device_channel ||--o{ reading : "mesures récentes"
  device_channel ||--o{ reading_day : "mesures compactées"
  device_channel ||--o{ correction : "corrections"
  series |o--o{ annotation : "annotée"
  series ||--o{ alert_rule : "seuils d'alerte"
  series ||--o{ alert_event : "alertes"
  alert_rule |o--o{ alert_event : "déclenche"
  alert_event ||--o{ alert_archive : "archivée par"
  place |o--o{ annotation : "annotée"

  home {
    int id PK
    text name
    float lat
    float lon
    text timezone "Europe/Paris"
    timestamptz created_at
  }
  home_member {
    int id PK
    int home_id FK
    text email "minuscules, unique par maison"
    uuid user_id "renseigné à la 1re connexion"
    text role "owner | editor | viewer"
    text invited_by
    timestamptz created_at
  }
  place {
    int id PK
    int home_id FK
    text code "unique par maison"
    text name
    int parent_id FK "emplacement parent"
    int sort_order "ordre parmi ses voisins"
    smallint color_slot "couleur des courbes, 0-7 ou NULL"
    text color "couleur personnalisée #rrggbb, prioritaire"
    text kind "room, outdoor, zone…"
    text exposure "indoor | outdoor | appliance"
    float lon
    float lat
    int plan_id "futur plan intérieur"
    float plan_x
    float plan_y
    timestamptz created_at
  }
  device {
    int id PK
    int home_id FK
    text ma_id "identifiant Mobile Alerts, unique"
    text name "nom local"
    text ma_name "nom sur le site"
    text model
    bool active "false = retiré, historique gardé"
    timestamptz added_at
    timestamptz retired_at
  }
  device_channel {
    int id PK
    int device_id FK
    smallint channel_no "colonne de mesure, 1…"
    smallint property_id FK
    text label
  }
  observed_property {
    smallint id PK
    text code "temperature, humidity, rain"
    text name
    text unit
    real simplify_tolerance "NULL = jamais simplifié"
  }
  series {
    int id PK
    int place_id FK
    smallint property_id FK "unique avec place_id"
    text name
    text color
  }
  deployment {
    int id PK
    int channel_id FK
    int series_id FK
    tstzrange valid "période, sans chevauchement"
    text note
  }
  reading {
    int channel_id PK, FK
    timestamptz ts PK
    real value
  }
  reading_day {
    int channel_id PK, FK
    date day PK
    int_array t "secondes depuis minuit"
    real_array v "valeurs"
    int n_raw "points avant simplification"
    bool simplified
  }
  correction {
    int id PK
    int channel_id FK
    tstzrange ts_range
    text action "reject | replace"
    real value "si replace"
    text reason
    text author
    timestamptz created_at
  }
  annotation {
    int id PK
    int series_id FK "ou"
    int place_id FK "ou aucun : globale"
    tstzrange ts_range
    text text
    text author
    timestamptz created_at
  }
  alert_rule {
    int id PK
    int series_id FK
    text kind "above | below | peak | trough"
    text level "info | warning"
    real threshold "seuil, ou montée minimale du pic"
    bool enabled
  }
  alert_event {
    bigint id PK
    int rule_id FK
    int series_id FK
    text kind
    text level
    real threshold
    timestamptz started_at
    timestamptz ended_at "NULL = en cours"
    real value "valeur extrême"
    timestamptz notified_at
  }
  alert_archive {
    bigint event_id PK, FK
    uuid user_id PK "chaque compte archive pour lui"
    timestamptz archived_at
  }
  device_sync {
    int device_id PK, FK
    timestamptz last_ts "dernière mesure reçue"
    timestamptz synced_until "fin de la période interrogée"
    timestamptz last_run
    text status "OK | NO_DATA | ERROR"
    text message
    int nb_imported
  }
```

Tables techniques, sans lien avec les autres :

```mermaid
erDiagram
  app_setting {
    text key PK "hot_days, simplify_after_days, timezone, db_quota_mb"
    jsonb value
    text label
  }
  app_user {
    int id PK
    uuid user_id "unique"
    text email
    text role "admin | viewer"
  }
  push_subscription {
    int id PK
    uuid user_id
    text endpoint "unique, adresse du service de notification"
    text p256dh
    text auth
    text min_level "info | warning"
  }
  maintenance_log {
    bigint id PK
    timestamptz run_at
    text task "compact, simplify, import_replace…"
    jsonb details
  }
```

## Tables

| Table | Contenu | Points importants |
|---|---|---|
| `home` | maison : regroupe emplacements et capteurs | toutes les règles d'accès partent d'elle |
| `home_member` | membres d'une maison, par e-mail | invitation possible avant la 1re connexion ; au moins un propriétaire |
| `place` | emplacements, en arborescence | même maison que son parent ; pas de boucle ; ordre `sort_order` ; un emplacement parent n'a pas de capteur affecté (et un emplacement équipé ne contient pas d'autres emplacements) |
| `device` | capteurs physiques | `active = false` : plus collecté, historique conservé |
| `device_channel` | canaux d'un capteur (une grandeur chacun) | créés automatiquement à la 1re collecte |
| `observed_property` | grandeurs mesurées | tolérance de simplification par grandeur |
| `series` | courbe d'un emplacement pour une grandeur | une seule par couple emplacement × grandeur |
| `deployment` | affectation datée canal → série | contraintes d'exclusion : un canal à un seul endroit, une série à une seule source à la fois |
| `reading` | mesures récentes, une ligne par valeur | clé (canal, horodatage) : pas de doublon |
| `reading_day` | mesures anciennes, une ligne par canal et par jour | tableaux `t` / `v` ; `simplified` au-delà de 3 ans |
| `correction` | valeurs rejetées ou remplacées | appliquées à la lecture, le brut reste intact |
| `annotation` | commentaires sur une période | par série, par emplacement ou globaux |
| `alert_rule` | seuils d'alerte d'une série (au-dessus, en dessous, pic, creux ; info ou importante) | une règle par type et niveau |
| `alert_event` | alertes déclenchées | en cours tant que `ended_at` est vide ; effacement réservé à « gestion » |
| `alert_archive` | alertes archivées (masquées) | propre à chaque compte |
| `push_subscription` | appareils abonnés aux notifications | supprimés quand le service les déclare expirés |
| `device_sync` | avancement de la collecte par capteur | reprise incrémentale, dernière erreur |
| `maintenance_log` | journal des tâches (compactage, simplification, remplacements à l'import) | consultable dans Admin › Maintenance |
| `app_setting` | réglages (durées de conservation, fuseau, quota) | modifiables par l'administrateur |
| `app_user` | administrateurs de la plateforme | rôle reconnu par l'e-mail du compte |

## Vues et fonctions principales

| Nom | Rôle |
|---|---|
| `reading_all`, `channel_readings()` | mesures d'un canal, tous niveaux de stockage réunis |
| `observation`, `series_observations()` | mesures d'une série : affectations et corrections appliquées |
| `series_data()`, `series_data_multi()` | points d'une courbe, réduits en min / max par intervalle si nécessaire |
| `series_stats()`, `series_bounds()` | minimum, maximum, moyenne ; première et dernière mesure |
| `current_values()` | dernière valeur de chaque série (page Maintenant) |
| `collect_targets()`, `ingest_readings()`, `record_sync_error()` | collecteur |
| `run_maintenance()`, `compact_readings()`, `simplify_old()` | maintenance nocturne |
| `assign_channel()`, `retire_device()`, `reorder_places()` | administration |
| `place_issues()` | emplacements parents ayant encore un capteur affecté (incohérence ancienne à corriger) |
| `export_csv()`, `import_preview()`, `import_values()` | export et import de fichiers |
| `my_context()`, `my_home_ids()`, `my_place_ids()`… | droits du compte connecté (règles d'accès) |
| `evaluate_alerts()`, `set_alert_rules()` | alertes : évaluation toutes les 10 minutes, réglage des seuils |
| `pending_notifications()`, `mark_notified()` | notifications à envoyer (Edge Function `notify`) |
| `admin_stats()`, `stats()` | statistiques d'occupation |
