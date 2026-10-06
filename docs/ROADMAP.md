# Évolutions prévues

Liste vivante : à compléter et reclasser au fil des idées et des retours (famille, amis).
Priorités : **P1** prochaine étape · **P2** ensuite · **P3** plus tard · **?** à discuter.

## Vue d'ensemble

| # | Évolution | Priorité | Taille | Statut |
|---|---|---|---|---|
| 1 | [Couleur des courbes par emplacement](#1-couleur-des-courbes-par-emplacement) | P1 | S | ✅ fait |
| 2 | [Courbes lissées (option d'affichage)](#2-courbes-lissées-option-daffichage) | P1 | S | ✅ fait |
| 3 | [Rapport de diagnostic « pour Claude »](#3-rapport-de-diagnostic-pour-claude) | P1 | S | à faire |
| 4 | [Maisons, comptes et partage](#4-maisons-comptes-et-partage) | P1 | L | ✅ fait (reste : identifiants Mobile Alerts par maison) |
| 5 | [Corrections et annotations](#5-corrections-et-annotations) | P2 | M | à faire |
| 13 | [Import et export CSV / Excel depuis l'interface](#13-import-et-export-csv--excel-depuis-linterface) | P1 | M | ✅ fait |
| 6 | [Périodes sans mesure (piles vides)](#6-périodes-sans-mesure-piles-vides) | P2 | S | à faire |
| 7 | [Alertes sur seuils](#7-alertes-sur-seuils) | P2 | L | à faire |
| 8 | [Données météo publiques](#8-données-météo-publiques) | P2 | M | à faire |
| 9 | [Statistiques par groupe d'emplacements](#9-statistiques-par-groupe-demplacements) | P2 | M | en partie : moyenne d'un emplacement parent sur les courbes |
| 10 | [Reprise de l'historique des Google Sheets](#10-reprise-de-lhistorique-des-google-sheets) | P1 | – | outils prêts (application ou PC), à lancer |
| 11 | [Module carto / plan intérieur](#11-module-carto--plan-intérieur) | P3 | L | idée |
| 12 | [Ouverture : SensorThings, openSenseMap, Play Store](#12-ouverture--sensorthings-opensensemap-play-store) | P3 | M | idée |
| 14 | [Nom de l'application et nom de domaine](#14-nom-de-lapplication-et-nom-de-domaine) | P2 | S | à décider |
| 15 | [Envoi et réception d'e-mails](#15-envoi-et-réception-de-mails) | P2 | M | invitation à transmettre soi-même : ✅ ; e-mails : après le domaine |
| 16 | [Autres marques de capteurs](#16-autres-marques-de-capteurs) | P3 | M | idée (à garder en tête) |
| 17 | [Actions : volets Somfy TaHoma, Google Home…](#17-actions--volets-somfy-tahoma-google-home) | P3 | L | idée (à garder en tête) |

Taille : **S** quelques heures · **M** une journée · **L** plusieurs jours.

---

## 1. Couleur des courbes par emplacement

**Besoin** : choisir la couleur d'un emplacement depuis sa page de détail ; elle est conservée
dans toutes les courbes (page Courbes comprise).

**Pistes** :
- métadonnée de l'emplacement (`place.color`), éditable par les administrateurs ;
- sélecteur limité à la palette validée (8 teintes, lisibles en thème clair et sombre et pour les
  daltoniens), plutôt qu'une couleur libre ;
- la page Courbes utilise la couleur de l'emplacement quand elle existe, sinon l'attribution
  automatique actuelle ; signaler deux emplacements affichés avec la même couleur.

**Fait (06/10/2026)** : `place.color_slot` (numéro dans la palette de 8 teintes, NULL = automatique),
choisi sur la page de l'emplacement (droits « gestion ») ou dans Admin › Emplacements ; la page
Courbes l'utilise (moyenne d'un parent comprise), attribue aux autres une couleur libre, et signale
les courbes affichées de même couleur. Puis `place.color` : couleurs supplémentaires (gris,
marron…) ou personnalisée (#rrggbb), prioritaire sur la palette (non adaptée au thème sombre).

## 2. Courbes lissées (option d'affichage)

**Besoin** : rendu plus agréable que les « marches », en option seulement (les marches restent le
rendu fidèle : Mobile Alerts n'enregistre qu'aux changements de valeur).

**Pistes** : bascule « Escalier / Lissé » mémorisée par appareil ; lissage d'affichage seulement
(interpolation monotone, qui ne crée pas de faux pics), les données ne changent pas.

**Fait** : bascule « Escalier / Lissé » et choix des grandeurs affichées (température, humidité),
communs à la page Courbes et aux pages des emplacements, mémorisés par appareil ; les grandeurs
masquées ne sont pas chargées.

**Fait (05/10/2026)** : troisième rendu **Simplifié** : le capteur arrondit au dixième, si bien
qu'une montée lente forme des paliers (18,2 18,2 18,2 puis 18,3…) et des marches même lissées.
Chaque palier de valeurs identiques est remplacé par un point au milieu du palier (plus le premier
et le dernier point), puis lissé ; les pics isolés sont conservés. « Lissé » devient le rendu par
défaut.

**Piste suivante** : faire cette réduction côté base (`series_data`), pour transférer moins de
points sur les longues périodes ; à mesurer (au-delà de 2 000 points, `series_data` renvoie déjà
les minima et maxima par intervalle).

## 3. Rapport de diagnostic « pour Claude »

**Besoin** : un bouton qui produit un résumé compact, à coller dans une conversation avec Claude,
pour analyser un problème, anticiper la volumétrie ou une montée en charge.

**Pistes** :
- bouton **Copier le rapport** dans Admin > Tableau de bord : texte Markdown compact, sans
  aucun secret ni identifiant de capteur complet (masqués : `07…A5`) ;
- contenu : version de l'application, volume et quota, valeurs par niveau de stockage, croissance
  sur 7 / 30 jours et projection de la date d'atteinte du quota, état de chaque capteur (dernière
  mesure, statut, dernière erreur), journal des dernières maintenances, tâches planifiées, erreurs
  récentes de collecte ;
- journaux Supabase (Edge Functions, base) : accessibles par l'API de gestion Supabase avec un
  jeton ; à étudier (fonction serveur qui les résume, sans exposer le jeton).

> Note : Claude n'a pas d'accès direct au projet Supabase ni à ses journaux ; c'est ce rapport,
> collé dans la conversation, qui lui donne le contexte.

## 4. Maisons, comptes et partage

**Besoin** :
- regrouper capteurs et emplacements dans une **maison** (« Maison X », un super-emplacement) ;
- chacun peut **créer son compte** à la première connexion (Google ou e-mail), même sans capteur ;
- l'administrateur d'une maison la **partage en lecture** avec des comptes choisis (conjointe,
  enfants, amis pour une démo), voire en gestion ;
- à terme : plusieurs maisons par compte, plusieurs comptes Mobile Alerts.

**Pistes** :
- `home` (maison) = emplacement racine, avec un propriétaire ; `home_member (home_id, user, rôle :
  owner / editor / viewer)` ; invitations par e-mail (déjà possible côté droits : rôle rattaché à
  l'adresse) ;
- règles d'accès (RLS) par maison au lieu du rôle global actuel : chaque requête ne voit que les
  maisons du compte ;
- inscription ouverte : le compte créé arrive sur un écran d'accueil (« aucune maison partagée
  pour l'instant ») ;
- les identifiants Mobile Alerts (vendorid) deviennent une donnée de la maison, chiffrée (Vault),
  au lieu d'un secret global de la fonction de collecte ;
- page Admin > Partage : liste des membres, inviter, retirer, changer le rôle.

À faire **avant** les alertes et la météo, qui dépendent de la maison (destinataires, localisation).

**Fait (05/10/2026)** : maisons, membres (propriétaire / gestion / lecture), invitation par e-mail
avant la première connexion, création de compte, écran d'accueil sans maison, sélecteur de maison,
page Admin > Partage, règles d'accès par maison. **Reste** : identifiants Mobile Alerts propres à
chaque maison (aujourd'hui un seul compte, celui du collecteur) ; création de maison par un
utilisateur non administrateur ; tableau de bord par maison pour les propriétaires.

## 5. Corrections et annotations

**Besoin** : marquer les valeurs aberrantes, commenter une période (« chauffage coupé »,
« vacances »). La base les gère déjà (tables `correction` et `annotation`), il manque l'interface.

**Pistes** : sur la courbe d'un emplacement, sélection d'une plage à la souris ou au doigt >
*Rejeter ces valeurs* / *Annoter* ; annotations affichées en bandeaux sur les courbes ; liste et
annulation dans la page de l'emplacement.

## 6. Périodes sans mesure (piles vides)

**Besoin** : distinguer « valeur stable » de « capteur muet » (piles vides : plusieurs périodes
connues).

**Pistes** : seuil de silence par capteur (ex. 3 h sans transmission) ; périodes muettes détectées
par la collecte, affichées en zones grisées sur les courbes et listées ; option d'annotation
automatique « capteur muet » ; alerte associée (voir 7).

## 7. Alertes sur seuils

**Besoin** : seuils par emplacement et par grandeur, deux niveaux :
- **urgent** (ex. congélateur au-dessus de −10 °C) ;
- **avertissement** (ex. température > 35 °C).

Restitution : historique des alertes dans l'application, et récapitulatif par e-mail (immédiat
pour l'urgent, quotidien pour les avertissements).

**Pistes** :
- tables `alert_rule (série, niveau, sens > / <, seuil, durée minimale, hystérésis)` et
  `alert_event (début, fin, valeur extrême, acquittement)` ;
- évaluation à chaque collecte (fonction SQL appelée après l'ingestion) ;
- e-mails via un service d'envoi (Resend, Brevo… offres gratuites) depuis une Edge Function ;
  notifications push de la PWA en option ;
- seuils affichés en lignes horizontales sur les courbes de la page d'un emplacement,
  **déplaçables en les faisant glisser** pour les ajuster ;
- alerte « capteur muet » (voir 6) ;
- alerte **inversion de tendance** (pic ou creux passé, ex. « l'extérieur redescend : ouvrir les
  fenêtres », « le salon a commencé à chauffer : fermer les volets ») : reprendre l'algorithme des
  flèches de tendance (`web/src/lib/trend.ts` : pente sur 1 h rapportée à l'écart du jour, pic ou
  creux dépassé d'un seuil de part et d'autre), côté base pour l'évaluer à chaque collecte ; lien
  avec les actions (voir 17).

## 8. Données météo publiques

**Besoin** : superposer la météo extérieure aux courbes des capteurs.

**Pistes** :
- source : Open-Meteo (gratuite, sans clé, archives historiques) ; Météo-France (open data)
  en option ;
- à la demande pour l'affichage (aucun stockage), et **archive très compacte en base** :
  min / max (et éventuellement moyenne, précipitations) **par jour** pour les comparaisons longues ;
- position : celle de la maison (voir 4) ;
- affichage : série « Météo » optionnelle dans la page Courbes et la page d'un emplacement
  extérieur, avec son propre style (pointillé) pour ne pas la confondre avec un capteur.

## 9. Statistiques par groupe d'emplacements

**Fait en partie (05/10/2026)** : page Courbes organisée selon l'imbrication des emplacements ;
courbe **moyenne** d'un emplacement parent (moyenne, à chaque changement, des dernières valeurs
de ses sous-emplacements mesurés), en tirets, avec sa ligne dans le tableau récapitulatif ;
emplacements sans mesure grisés. Un emplacement parent se sélectionne en entier (bouton en
pointillé = moyenne, ses éventuelles mesures propres comprises) ; ordre et arborescence modifiables
dans Admin › Emplacements (glisser-déposer, flèches ; `place.sort_order`, `reorder_places`,
boucles interdites). Pistes : bande min – max du groupe autour de la moyenne, page
d'un emplacement parent (courbes de ses sous-emplacements), statistiques du groupe.

**Besoin** : profiter de la hiérarchie des emplacements (Maison > étage > pièces) pour des moyennes
et extrêmes par groupe (« moyenne de l'étage », « toute la maison »).

**Pistes** : séries calculées à la lecture à partir des séries enfants ; tableau comparatif.

## 10. Reprise de l'historique des Google Sheets

Outil prêt (`python -m mobalplus import-sheets`, voir [supabase-setup.md](supabase-setup.md),
étape 8) : exporter les classeurs en `.xlsx`, puis lancer l'import depuis le PC. L'historique est
compacté au fil de l'import (≈ 10 octets par valeur).

## 11. Module carto / plan intérieur

**Besoin** : visualiser les capteurs sur une carte ou un plan de la maison, valeurs en couleur au
temps choisi par le curseur temporel.

**Pistes** : MapLibre GL ; plans intérieurs en GeoJSON ou image géoréférencée ; position par
emplacement (colonnes déjà prévues) ; PostGIS si nécessaire.

## 12. Ouverture : SensorThings, openSenseMap, Play Store

- API **OGC SensorThings** en lecture (le modèle de données est déjà aligné) ;
- publication optionnelle de capteurs extérieurs sur **openSenseMap** (open data) ;
- **Play Store** : encapsulation de la PWA (TWA, PWABuilder).

## 13. Import et export CSV / Excel depuis l'interface

**Besoin** : importer un historique depuis l'application (version web), sans outil en ligne de
commande ; exporter les données d'un capteur ou d'un emplacement en un gros fichier CSV, pour se
rassurer et sauvegarder.

**Pistes** :
- **format standard documenté** : `date;emplacement;grandeur;valeur` (ou une colonne par grandeur),
  dates ISO ou `jj/mm/aaaa hh:mm:ss` heure de Paris, séparateur `;` ou `,`, décimale `,` ou `.` ;
  modèle téléchargeable ; le format des anciens Google Sheets reconnu aussi ;
- import : lecture du fichier **dans le navigateur** (Excel via SheetJS), aperçu des premières
  lignes et de la correspondance des colonnes, puis envoi par lots à une fonction SQL d'import
  (droits « gestion » de la maison), compactage au fil de l'eau, dédoublonnage ;
- export : page d'un emplacement > **Exporter** (période au choix ou tout l'historique), CSV
  produit par lots dans le navigateur, valeurs rejetées signalées dans une colonne « qualité » ;
- export complet d'une maison (tous ses emplacements) pour sauvegarde.

**Fait (05/10/2026)** : page **Données** (menu principal). Export CSV par emplacements, grandeurs,
période (24 h, 7 j, 30 j, tout l'historique, personnalisée), nombre de lignes maximal, fichier
exemple de 10 lignes, dates en heure de Paris avec décalage ou en UTC, format Excel français ou
international. Import (droits « gestion ») du même format en CSV ou Excel, ou de l'ancien tableur
Mobile Alerts, avec choix du fuseau des dates sans fuseau, analyse avant envoi, envoi par lots,
doublons ignorés, valeurs « rejetées » restaurées, affectations étendues vers le passé quand
l'historique est plus ancien que l'affectation du capteur.

**Fait (05/10/2026)** : doublons proches et conflits. Marge réglable (± 2 min par défaut, en
dessous de l'intervalle d'émission d'environ 7 min) ; l'analyse compare le fichier à l'existant
sans rien écrire et compte, par emplacement et grandeur, les valeurs nouvelles, identiques et en
conflit, avec des exemples (valeur actuelle / valeur du fichier) ; en cas de conflit, choix
« conserver » (par défaut) ou « remplacer » avec confirmation (la mesure existante la plus proche
est supprimée, y compris dans l'historique compacté) ; chaque remplacement est journalisé
(`maintenance_log`, tâche `import_replace`) ; avertissement si de nombreuses valeurs se retrouvent
décalées d'exactement 1 h ou 2 h (fuseau probablement erroné).

## 14. Nom de l'application et nom de domaine

**Besoin** : « MobAlPlus » vient de « Mobile Alerts Plus ». Mobile Alerts est une marque : un nom
qui la reprend (ou s'en approche) peut poser problème, et l'application doit pouvoir accueillir
d'autres capteurs (voir 16). Trouver un nom parlant, sympa, libre, avec son domaine (~10 €/an).

**Pistes** :
- vérifier la disponibilité : marques (base INPI, TMview de l'EUIPO pour l'Europe), domaine
  (`.fr`, `.app`, `.eu`), stores ;
- mentionner les marques seulement pour décrire la compatibilité (« compatible avec les capteurs
  Mobile Alerts »), pas dans le nom ni le logo ;
- le changement de nom touche peu de choses : titre, manifeste PWA, icône, textes ; le dépôt et le
  projet Supabase peuvent garder leur nom technique ;
- domaine acheté chez Cloudflare (prix coûtant) : adresse de l'application
  (`app.<domaine>`) et e-mails (voir 15).

## 15. Envoi et réception d'e-mails

**Besoin** : prévenir les personnes invitées, envoyer les alertes (voir 7), permettre la création
de compte par e-mail (confirmation), plus tard recevoir des commandes par e-mail.

**Fait (05/10/2026)** : en attendant, page **Partage** : après une invitation (ou depuis un membre
« en attente »), message d'invitation modifiable à envoyer par **WhatsApp**, par le partage du
téléphone (SMS…), par e-mail (messagerie de l'appareil) ou à copier.

**Pistes** (après l'achat du domaine) :
- **envoi** : Resend (gratuit jusqu'à ~3 000 e-mails/mois) avec le domaine vérifié (SPF, DKIM) :
  SMTP de Supabase Auth (confirmations, mot de passe oublié) et Edge Function `notify` pour les
  invitations et les alertes ;
- **réception** : Cloudflare Email Routing (gratuit) vers un Email Worker qui transmet le message
  à une Edge Function ; commandes acceptées seulement depuis l'adresse d'un membre, avec un
  vocabulaire simple (« état congélateur », « pause alertes 2 h ») et réponse par e-mail ;
- sans domaine, dépannage possible avec Brevo et une adresse Gmail vérifiée (risque de spam).

## 16. Autres marques de capteurs

**Besoin** : ne pas rester lié à Mobile Alerts : d'autres capteurs bon marché pourraient
alimenter les mêmes emplacements, courbes et alertes.

**Pistes** :
- le modèle de données le permet déjà : capteur → canaux → affectations datées → séries ; ajouter
  un champ `device.vendor` (« mobile_alerts » par défaut) et des identifiants de compte par maison
  et par fournisseur ;
- un **adaptateur** par fournisseur dans le collecteur (`collect` choisit l'adaptateur selon
  `vendor`), sur le modèle de `ma_client` / `ma_parser` : liste des mesures d'une période, ou
  dernière valeur seulement ;
- candidats : stations Netatmo (API officielle), capteurs Zigbee / Xiaomi / SwitchBot via leurs
  API cloud, Home Assistant (API REST), capteurs à pousser soi-même (ESP32, LoRaWAN / The Things
  Network) via une Edge Function de **réception** (jeton par capteur).

## 17. Actions : volets Somfy TaHoma, Google Home…

**Besoin** : déclencher des actions selon les valeurs des capteurs, par exemple fermer les volets
Somfy (box TaHoma) quand le salon dépasse 26 °C l'été, ou les rouvrir quand l'extérieur est plus
frais que l'intérieur.

**Pistes** :
- même moteur que les alertes (voir 7) : **règle** (condition sur une ou plusieurs séries,
  durée, plage horaire, saison) → **actions** (e-mail, notification, commande d'un appareil),
  avec journal, anti-rebond (pas plus d'une action par heure…) et mode « simulation » pour tester ;
- connecteurs d'actions dans une Edge Function, identifiants chiffrés (Vault) par maison ;
- **Somfy TaHoma** : API locale officielle (« mode développeur » de la box, jeton) joignable
  seulement depuis le réseau de la maison ; depuis le cloud, l'API cloud Overkiz (utilisée par
  Home Assistant), non officielle pour ce type d'usage : à vérifier au moment de la réalisation ;
- **Google Home** : pas d'API simple pour piloter des appareils depuis un service tiers ; plutôt
  exposer nos capteurs à Google Home, ou passer par une passerelle ;
- passerelle universelle possible : **Home Assistant** (s'il y en a un à la maison) ou IFTTT /
  webhooks, l'application n'envoyant qu'un appel HTTP.

---

## Fait

| Date | Évolution |
|---|---|
| 01/10/2026 | Base Supabase (stockage en 3 niveaux, simplification), collecteur toutes les 10 min, import des tableurs |
| 02/10/2026 | PWA : valeurs actuelles, administration (statistiques, capteurs, emplacements, maintenance) |
| 04/10/2026 | Droits rattachés à l'e-mail, connexion Google en option |
| 04/10/2026 | Page par emplacement, page Courbes (périodes, glissement, zoom, curseur temporel) |
| 05/10/2026 | Correctif de performance des règles d'accès (délai dépassé sur les courbes) |
| 05/10/2026 | Maisons, comptes et partage ; correctif de sécurité des fonctions d'administration |
| 05/10/2026 | Import / export CSV et Excel depuis l'application |
| 05/10/2026 | Courbes lissées en option, grandeurs masquables (ex. humidité) |
| 05/10/2026 | Courbes : emplacements imbriqués, courbe moyenne d'un emplacement parent |
| 06/10/2026 | Couleur des courbes choisie par emplacement |
| 06/10/2026 | Flèches de tendance et inversions (pic, creux) sur la page Maintenant, réglables |
| 05/10/2026 | Emplacements : ordre et arborescence réorganisables (glisser-déposer, flèches) |
| 05/10/2026 | Rendu « Simplifié » des courbes (un point par palier), « Lissé » par défaut |
| 05/10/2026 | Partage : message d'invitation à envoyer par WhatsApp, SMS, e-mail ou à copier |
