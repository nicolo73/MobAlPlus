# Architecture et conception de MobAlPlus

MobAlPlus historise les mesures des capteurs **Mobile Alerts** (température, humidité…) au-delà des
3 mois conservés par le service officiel, et les présente dans une application web installable sur
téléphone (PWA). Tout repose sur des **services cloud gérés, sur leurs offres gratuites** : aucune
machine à administrer.

<p align="center"><img src="images/apercu-ordinateur.jpg" alt="Aperçu de l'application sur ordinateur (démo)" width="640"></p>

> Les schémas de cette page sont écrits en [Mermaid](https://mermaid.js.org) : du texte dans le
> fichier Markdown, que GitHub dessine automatiquement. Pour les modifier : bouton ✏️ de GitHub sur
> ce fichier (aperçu avec l'onglet *Preview*), ou copier le bloc dans
> [mermaid.live](https://mermaid.live) pour le retoucher avec un aperçu immédiat, puis le recoller.
> draw.io sait aussi importer un bloc Mermaid (*Organiser › Insérer › Avancé › Mermaid*) pour en
> faire un dessin libre.

**Sommaire** · [Vue d'ensemble](#vue-densemble) · [Technologies](#technologies-et-services) ·
[Collecte](#collecte-des-mesures) · [Stockage](#stockage-en-trois-niveaux) ·
[Lecture et affichage](#lecture-et-affichage) · [Application web](#application-web) ·
[Sécurité](#sécurité-et-droits) · [Déploiement](#déploiement) · [Modèle de données](#modèle-de-données)
· [Évolutions](#évolutions-darchitecture-prévues)

---

## Vue d'ensemble

```mermaid
flowchart TB
  subgraph users["Utilisateurs"]
    direction LR
    phone["📱 Téléphone<br/>application installée"]
    browser["💻 Navigateur"]
  end

  subgraph cf["Cloudflare Pages"]
    pwa["<b>Application web (PWA)</b><br/>Svelte 5 · Vite · ECharts · fichiers statiques"]
  end

  subgraph sb["Supabase"]
    direction TB
    auth["<b>Auth</b><br/>e-mail · Google"]
    api["<b>API REST</b> PostgREST<br/>tables + fonctions SQL"]
    fn["<b>Edge Function collect</b><br/>Deno · TypeScript"]
    wfn["<b>Edge Function weather</b><br/>météo publique"]
    db[("<b>PostgreSQL</b><br/>données · règles d'accès<br/>maintenance nocturne")]
    cron["<b>pg_cron</b> + <b>pg_net</b> + <b>Vault</b><br/>planificateur, appel HTTP, secrets"]
  end

  subgraph ma["Mobile Alerts"]
    direction LR
    sensors["📡 Capteurs → passerelle"]
    site["🌐 measurements.mobile-alerts.eu<br/>90 jours d'historique"]
  end

  google["Google<br/>connexion OAuth"]
  om["🌦 Open-Meteo<br/>prévision · archives ERA5"]

  subgraph gh["GitHub"]
    direction TB
    repo["Dépôt : code + documentation"]
    actions["Actions : tests,<br/>déploiement Supabase"]
  end

  cli["🐍 Outils Python sur PC<br/>import des Google Sheets"]

  phone & browser -->|HTTPS| pwa
  pwa --> auth
  pwa --> api
  pwa -->|« collecter maintenant »| fn
  auth -.-> google
  api --> db
  cron -->|toutes les 10 min| fn
  fn -->|enregistre| db
  cron -.-|dans la base| db
  fn -->|lit les pages HTML| site
  cron -->|toutes les 30 min| wfn
  wfn -->|enregistre| db
  wfn -->|API JSON| om
  sensors --> site
  repo -->|chaque push : construction| cf
  actions -->|migrations + fonction| sb
  cli -->|SQL| db
```

| Brique | Rôle | Code |
|---|---|---|
| Application web (PWA) | valeurs actuelles, courbes, données, administration ; installable | `web/` |
| Base de données | stockage, règles d'accès, calculs (séries, export, import, maintenance) | `supabase/migrations/` |
| Collecteur | récupère les mesures sur le site Mobile Alerts toutes les 10 minutes | `supabase/functions/collect/` |
| Collecteur météo | relève les stations météo publiques (Open-Meteo) toutes les 30 minutes | `supabase/functions/weather/` |
| Outils PC | import des anciens tableurs, rattrapage manuel, tests de la base | `backend/` |
| Documentation | architecture, mise en place, feuille de route, textes de l'application | `docs/` |

Mise en place pas à pas : [supabase-setup.md](supabase-setup.md), puis [deploiement-web.md](deploiement-web.md).

## Technologies et services

| Couche | Produit / technologie | Pourquoi | Offre |
|---|---|---|---|
| Hébergement de l'application | **Cloudflare Pages** | fichiers statiques sur un réseau mondial, construction automatique à chaque push | gratuit |
| Application | **Svelte 5** (runes), **TypeScript**, **Vite 8** | application légère et réactive, construction rapide | libre |
| Mode hors ligne, installation | **vite-plugin-pwa** (Workbox) | service worker, icône sur l'écran d'accueil | libre |
| Courbes | **Apache ECharts 6** (chargé à la demande) | zoom, curseur, plein écran, milliers de points | libre |
| Accès aux données | **supabase-js 2** | authentification et appels à l'API depuis le navigateur | libre |
| Textes de l'application | **marked** | « À propos », nouveautés, aide écrits en Markdown dans `docs/` | libre |
| Import Excel | **read-excel-file** | lecture des fichiers `.xlsx` dans le navigateur | libre |
| Base de données | **PostgreSQL** (Supabase) | SQL, contraintes, fonctions, Row Level Security | gratuit jusqu'à 500 Mo |
| API | **PostgREST** (Supabase) | API REST générée depuis le schéma, appels de fonctions (RPC) | inclus |
| Comptes | **Supabase Auth** (e-mail, Google OAuth) | connexion, jetons JWT lus par les règles d'accès | inclus |
| Tâches planifiées | **pg_cron**, **pg_net**, **Vault** | collecte toutes les 10 min, maintenance chaque nuit, secrets chiffrés | inclus |
| Collecteur | **Supabase Edge Functions** (Deno, TypeScript) | appel du site Mobile Alerts et lecture de ses pages | inclus |
| Météo publique | **Open-Meteo** (prévision, archives ERA5) appelé par le serveur ; géocodage par le navigateur à la création d'une station | stations météo virtuelles, sans clé | gratuit |
| Source des mesures | **Mobile Alerts** (site `measurements.mobile-alerts.eu`) | historique complet des 90 derniers jours | gratuit |
| Code, intégration continue | **GitHub**, **GitHub Actions** | tests à chaque push, déploiement Supabase à la demande | gratuit |
| Outils PC et tests | **Python 3.12**, psycopg, pytest ; **Node 22** (`node --test`) | import des tableurs, tests de la base et du code partagé | libre |

## Collecte des mesures

Le site Mobile Alerts ne fournit pas d'API d'historique : sa page
`Home/MeasurementDetails?deviceid=…&vendorid=…&fromepoch=…&toepoch=…` renvoie en HTML **toutes**
les mesures d'une période. Le collecteur la lit par fenêtres d'un jour.

```mermaid
sequenceDiagram
  autonumber
  participant C as pg_cron
  participant F as Edge Function collect
  participant D as PostgreSQL
  participant M as Site Mobile Alerts

  C->>F: toutes les 10 min (pg_net, jeton du Vault)
  F->>D: collect_targets() : capteurs actifs, date de dernière collecte
  loop chaque capteur, 10 jours au plus par passage
    F->>M: MeasurementDetails (fenêtre d'un jour)
    M-->>F: page HTML
    F->>F: lecture du tableau, heure locale → UTC
    F->>D: ingest_readings(mesures, synced_until)
  end
  Note over F,D: en cas d'erreur : record_sync_error(), le capteur est repris au passage suivant
  C->>F: chaque nuit à 2 h 47 : relecture des 3 derniers jours
```

- **Incrémentale** : chaque capteur reprend là où il s'était arrêté (`device_sync.synced_until`) ;
  après une interruption, le retard (jusqu'à 90 jours) se rattrape sur les passages suivants.
- **Relecture nocturne** des 3 derniers jours, pour les mesures transmises en retard.
- **Heure** : `fromepoch` / `toepoch` sont l'heure *locale* encodée comme de l'UTC ; les dates lues
  sont converties en UTC, avec levée de l'ambiguïté du passage à l'heure d'hiver grâce à l'ordre
  chronologique des mesures (`_shared/timeutil.ts`).
- Le site n'enregistre une mesure que lorsque la valeur change (environ toutes les 7 minutes) :
  le rendu fidèle est donc en **escalier**.
- Les identifiants Mobile Alerts sont des secrets de la fonction, jamais dans le dépôt.

### Météo publique : stations virtuelles

Une **station météo** est un capteur virtuel (`device.vendor = 'open_meteo'`, position `lat` / `lon`)
affecté à un emplacement de type `weather`. Elle passe par le même chemin que les vrais capteurs
(`ingest_readings`, séries, alertes, tendances) ; seul le collecteur diffère :

- Edge Function `weather`, toutes les 30 minutes (pg_cron, minutes 7 et 37) : `weather_targets()`
  donne les stations actives et leur dernière mesure ; un appel Open-Meteo par station (valeurs
  horaires des derniers jours + valeur actuelle) ; à la création, un an d'historique (archives ERA5).
- Les navigateurs ne contactent plus Open-Meteo pour les mesures : pas de risque de blocage, une
  seule requête par station et par demi-heure quel que soit le nombre d'utilisateurs.
- Création : `add_weather_station(maison, nom, lat, lon)` (gestionnaire de la maison), depuis
  Admin › Partage › Météo publique ; l'application lance aussitôt une collecte.

## Stockage en trois niveaux

```mermaid
flowchart LR
  in(["mesures collectées<br/>ou importées"]) --> r
  subgraph r["0 – 90 jours"]
    reading[("reading<br/>1 ligne par mesure<br/>≈ 84 octets / valeur")]
  end
  subgraph c["90 jours – 3 ans"]
    day[("reading_day<br/>1 ligne par canal et par jour<br/>tableaux t[] / v[] · ≈ 10 octets / valeur")]
  end
  subgraph s["au-delà de 3 ans"]
    simp[("reading_day simplifié<br/>points significatifs seulement")]
  end
  reading -->|"chaque nuit : compactage<br/>sans perte"| day
  day -->|"chaque nuit : simplification<br/>min / max du jour + Douglas-Peucker"| simp
```

- Durées réglables (`app_setting` : `hot_days`, `simplify_after_days`), tâche nocturne
  `run_maintenance()` à 3 h 17, journal dans `maintenance_log`.
- **Simplification** : premier et dernier point, minimum et maximum du jour, puis Douglas-Peucker
  sur l'écart vertical avec une tolérance par grandeur (`observed_property.simplify_tolerance` :
  0,2 °C, 2 % ; pluie jamais simplifiée). Les points conservés sont de **vrais points**.
- Les mesures brutes ne sont **jamais modifiées** : corrections et annotations sont à part et
  s'appliquent à la lecture.
- Estimation : 3 ans pour 13 capteurs ≈ 110 Mo, pour un quota gratuit de 500 Mo.

## Lecture et affichage

```mermaid
flowchart LR
  raw[("reading<br/>reading_day")] --> cr["channel_readings()<br/>les deux niveaux réunis"]
  cr --> so["series_observations()<br/>canal → série selon les affectations datées<br/>+ corrections (rejet, remplacement)"]
  so --> sd["series_data()<br/>tous les points, ou min / max<br/>par intervalle au-delà de 1 000"]
  so --> st["series_stats()<br/>min, max, moyenne"]
  so --> ex["export_csv()"]
  sd -->|API| ui["Navigateur : courbes<br/>escalier · lissé · simplifié<br/>moyenne d'un groupe · tendance"]
```

- **Affectations datées** : le rattachement d'une mesure à un emplacement est calculé à la
  lecture ; déplacer un capteur ou corriger une date ne réécrit aucune mesure.
- **Réduction** : au-delà de 1 000 points, `series_data` renvoie le minimum et le maximum réels de
  chaque intervalle ; les pics restent visibles à toutes les échelles.
- **Calculs dans le navigateur** (rapides, sans charge pour la base) : rendus lissé et simplifié
  (`curve.ts`), moyenne d'un emplacement parent (`placetree.ts`), flèches de tendance et
  inversions (`trend.ts`).

## Application web

```mermaid
flowchart TB
  app["App.svelte<br/>en-tête, navigation, routage (#/…)"]
  subgraph pages["Pages"]
    now["Maintenant"]
    charts["Courbes"]
    place["Emplacement"]
    data["Données<br/>import / export"]
    admin["Admin : tableau de bord,<br/>capteurs, emplacements,<br/>partage, maintenance"]
    opts["Options · À propos"]
  end
  subgraph comps["Composants"]
    tc["TimeChart<br/>(ECharts à la demande)"]
    bars["PeriodBar · DisplayBar<br/>TrendArrow · InviteSend"]
  end
  subgraph lib["Logique (src/lib)"]
    api["api.ts : interface Api"]
    sapi["supabase-api.ts"]
    demo["demo-api.ts<br/>données fictives"]
    calc["curve · placetree · trend<br/>dataio · timeutil"]
    state["home · display · router<br/>(état partagé, préférences)"]
  end
  app --> pages
  pages --> comps
  pages --> lib
  api --> sapi & demo
  sapi -->|supabase-js| sb[("Supabase")]
```

- **Copies d'écran** de la documentation (`docs/images/`) : `cd web && npm run screenshots`
  reconstruit l'application en mode démo et la parcourt avec Playwright (`scripts/screenshots.mjs`).
- **Mode démo** : sans variables Supabase, l'application tourne sur des données fictives
  (`demo-api.ts`) ; pratique pour essayer une évolution sans toucher aux vraies données.
- **Préférences** (rendu des courbes, grandeurs masquées, taille du texte, densité, tendances) :
  mémorisées sur l'appareil (`localStorage`).
- **Textes** : `docs/a-propos.md`, `docs/nouveautes.md` et `docs/guide-utilisateur.md` sont intégrés
  à la construction ; les modifier sur GitHub suffit à mettre l'application à jour.

## Alertes et notifications

```mermaid
flowchart LR
  rules[("alert_rule<br/>seuils par série")] --> ev
  cron1["pg_cron<br/>toutes les 10 min (+4)"] --> ev["evaluate_alerts()<br/>dépassements, pics, creux"]
  ev --> events[("alert_event")]
  events -->|API| app["Application : cloche,<br/>page Alertes, fiches, courbes"]
  cron2["pg_cron (+5)"] -->|pg_net| notify["Edge Function notify<br/>Web Push (clés VAPID)"]
  events --> notify
  subs[("push_subscription")] --> notify
  notify --> phone["📱 notification<br/>(service worker)"]
```

- Les seuils sont réglés par série (emplacement × grandeur) sur deux niveaux ; un dépassement est
  une alerte **en cours** jusqu'au retour en deçà du seuil d'un pas de mesure (hystérésis) ; un
  refranchissement dans l'heure rouvre la même alerte : une notification par franchissement.
- Les pics et creux reprennent l'algorithme des flèches de tendance (`trend.ts`) ;
  `alerteval.ts` en est la version JavaScript (mode démo, tests).
- Chaque compte archive ses alertes pour lui-même ; l'effacement vaut pour toute la maison.

## Sécurité et droits

```mermaid
flowchart LR
  user["Compte connecté<br/>(jeton JWT : id, e-mail)"] --> rls
  subgraph rls["Règles d'accès (Row Level Security)"]
    ids["my_home_ids(rôle) · my_place_ids · my_channel_ids…<br/>calculés une fois par requête"]
  end
  member[("home_member<br/>e-mail · rôle")] --> ids
  ids --> tables[("tables de la maison :<br/>emplacements, capteurs,<br/>séries, mesures…")]
  admin["Administrateur de la plateforme<br/>(app_user.role = admin)"] -->|"voit tout, statistiques,<br/>maintenance"| tables
```

| Rôle dans une maison | Peut… |
|---|---|
| **Propriétaire** (`owner`) | tout, y compris inviter, retirer, changer les droits |
| **Gestion** (`editor`) | capteurs, emplacements, corrections, import ; collecte de ses capteurs |
| **Lecture** (`viewer`) | consulter valeurs, courbes, export |

- Les membres sont désignés par leur **e-mail** : une invitation fonctionne avant la première
  connexion, et les droits suivent l'adresse même si le compte est recréé.
- Cohérence garantie par la base : un capteur n'alimente qu'un emplacement de sa maison, une
  maison garde au moins un propriétaire, un emplacement ne peut pas être son propre ancêtre.
- Le collecteur utilise la clé *service_role* ; il n'accepte que le jeton de pg_cron,
  l'administrateur, ou un gestionnaire de maison pour ses propres capteurs (`can_collect`).

## Déploiement

```mermaid
flowchart LR
  dev["Modification<br/>(code ou docs/*.md)"] -->|git push| gh["GitHub"]
  gh -->|automatique| tests["Actions « Tests »<br/>pytest · node --test ·<br/>svelte-check · build"]
  gh -->|automatique| cfp["Cloudflare Pages<br/>construit et publie l'application"]
  gh -->|"à la demande<br/>(Run workflow)"| dep["Actions « Déploiement Supabase »<br/>supabase db push +<br/>functions deploy collect, notify, weather"]
  dep --> sbp[("Supabase")]
```

- Une modification de la **base** (nouveau fichier dans `supabase/migrations/`) demande de lancer
  le workflow « Déploiement Supabase » ; l'application, elle, se republie seule.
- Secrets : clés Supabase dans les secrets GitHub et Cloudflare ; identifiants Mobile Alerts dans
  les secrets de l'Edge Function ; URL et jeton de collecte dans le Vault.

## Modèle de données

Vue d'ensemble ci-dessous ; **toutes les tables et colonnes** dans
[modele-donnees.md](modele-donnees.md).

```mermaid
flowchart TB
  home["🏠 home<br/>maison"] --> member["home_member<br/>membres et rôles"]
  home --> place["📍 place<br/>emplacement (arborescence)"]
  home --> device["📡 device<br/>capteur physique"]
  place -->|parent| place
  device --> channel["device_channel<br/>canal = une grandeur mesurée"]
  property["observed_property<br/>température, humidité…"] --> channel
  place --> series["📈 series<br/>emplacement × grandeur"]
  property --> series
  channel --> deployment["deployment<br/>canal → série, période datée"]
  series --> deployment
  channel --> reading[("reading · reading_day<br/>mesures brutes")]
  channel --> correction["correction<br/>rejet, remplacement"]
  series --> annotation["annotation<br/>commentaire sur une période"]
```

L'idée centrale : le **capteur** (ce qui mesure) est séparé de l'**emplacement** (ce qu'on
regarde). Les mesures sont rattachées au canal du capteur ; la **série** affichée (« Salon –
température ») en reçoit les valeurs selon les **affectations datées**. Ce découpage suit le
standard OGC SensorThings (Thing, Sensor, Location, Datastream, Observation).

## Évolutions d'architecture prévues

À garder en tête dans les choix techniques (détails dans la [feuille de route](ROADMAP.md)) :

- **Plusieurs marques de capteurs** (ROADMAP 16) : un adaptateur par fournisseur dans le
  collecteur (`device.vendor`), et une source pourra aussi *pousser* ses mesures. Le nom de
  l'application ne doit pas reprendre une marque (ROADMAP 14).
- **Règles et actions** (ROADMAP 17) : les alertes (ci-dessus) sont la première brique ; les
  actions s'y brancheront (alert_event → action) :
  e-mail, notification, commande d'appareils (volets Somfy TaHoma, Google Home, Home Assistant,
  webhooks). Identifiants des services tiers par maison, chiffrés.
- **E-mails** (ROADMAP 15) : envoi par un service SMTP / API sur le domaine de l'application,
  réception par Cloudflare Email Routing vers une Edge Function.
