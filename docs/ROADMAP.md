# Évolutions prévues

Liste vivante : à compléter et reclasser au fil des idées et des retours (famille, amis).
Priorités : **P1** prochaine étape · **P2** ensuite · **P3** plus tard · **?** à discuter.

## Vue d'ensemble

| # | Évolution | Priorité | Taille | Statut |
|---|---|---|---|---|
| 1 | [Couleur des courbes par emplacement](#1-couleur-des-courbes-par-emplacement) | P1 | S | à faire |
| 2 | [Courbes lissées (option d'affichage)](#2-courbes-lissées-option-daffichage) | P1 | S | à faire |
| 3 | [Rapport de diagnostic « pour Claude »](#3-rapport-de-diagnostic-pour-claude) | P1 | S | à faire |
| 4 | [Maisons, comptes et partage](#4-maisons-comptes-et-partage) | P1 | L | ✅ fait (reste : identifiants Mobile Alerts par maison) |
| 5 | [Corrections et annotations](#5-corrections-et-annotations) | P2 | M | à faire |
| 13 | [Import et export CSV / Excel depuis l'interface](#13-import-et-export-csv--excel-depuis-linterface) | P1 | M | ✅ fait |
| 6 | [Périodes sans mesure (piles vides)](#6-périodes-sans-mesure-piles-vides) | P2 | S | à faire |
| 7 | [Alertes sur seuils](#7-alertes-sur-seuils) | P2 | L | à faire |
| 8 | [Données météo publiques](#8-données-météo-publiques) | P2 | M | à faire |
| 9 | [Statistiques par groupe d'emplacements](#9-statistiques-par-groupe-demplacements) | P3 | M | idée |
| 10 | [Reprise de l'historique des Google Sheets](#10-reprise-de-lhistorique-des-google-sheets) | P1 | – | outils prêts (application ou PC), à lancer |
| 11 | [Module carto / plan intérieur](#11-module-carto--plan-intérieur) | P3 | L | idée |
| 12 | [Ouverture : SensorThings, openSenseMap, Play Store](#12-ouverture--sensorthings-opensensemap-play-store) | P3 | M | idée |

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

## 2. Courbes lissées (option d'affichage)

**Besoin** : rendu plus agréable que les « marches », en option seulement (les marches restent le
rendu fidèle : Mobile Alerts n'enregistre qu'aux changements de valeur).

**Pistes** : bascule « Escalier / Lissé » mémorisée par appareil ; lissage d'affichage seulement
(interpolation monotone, qui ne crée pas de faux pics), les données ne changent pas.

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

**Fait (06/10/2026)** : maisons, membres (propriétaire / gestion / lecture), invitation par e-mail
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
- alerte « capteur muet » (voir 6).

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

**Fait (07/10/2026)** : page **Données** (menu principal). Export CSV par emplacements, grandeurs,
période (24 h, 7 j, 30 j, tout l'historique, personnalisée), nombre de lignes maximal, fichier
exemple de 10 lignes, dates en heure de Paris avec décalage ou en UTC, format Excel français ou
international. Import (droits « gestion ») du même format en CSV ou Excel, ou de l'ancien tableur
Mobile Alerts, avec choix du fuseau des dates sans fuseau, analyse avant envoi, envoi par lots,
doublons ignorés, valeurs « rejetées » restaurées, affectations étendues vers le passé quand
l'historique est plus ancien que l'affectation du capteur.

**Fait (08/10/2026)** : doublons proches et conflits. Marge réglable (± 2 min par défaut, en
dessous de l'intervalle d'émission d'environ 7 min) ; l'analyse compare le fichier à l'existant
sans rien écrire et compte, par emplacement et grandeur, les valeurs nouvelles, identiques et en
conflit, avec des exemples (valeur actuelle / valeur du fichier) ; en cas de conflit, choix
« conserver » (par défaut) ou « remplacer » avec confirmation (la mesure existante la plus proche
est supprimée, y compris dans l'historique compacté) ; chaque remplacement est journalisé
(`maintenance_log`, tâche `import_replace`) ; avertissement si de nombreuses valeurs se retrouvent
décalées d'exactement 1 h ou 2 h (fuseau probablement erroné).

---

## Fait

| Date | Évolution |
|---|---|
| 01/10/2026 | Base Supabase (stockage en 3 niveaux, simplification), collecteur toutes les 10 min, import des tableurs |
| 02/10/2026 | PWA : valeurs actuelles, administration (statistiques, capteurs, emplacements, maintenance) |
| 04/10/2026 | Droits rattachés à l'e-mail, connexion Google en option |
| 04/10/2026 | Page par emplacement, page Courbes (périodes, glissement, zoom, curseur temporel) |
| 05/10/2026 | Correctif de performance des règles d'accès (délai dépassé sur les courbes) |
| 06/10/2026 | Maisons, comptes et partage ; correctif de sécurité des fonctions d'administration |
| 07/10/2026 | Import / export CSV et Excel depuis l'application |
