<!--
  Nouveautés affichées dans la page « À propos ». Ajouter les nouvelles entrées EN HAUT, sous la
  forme « ## jj mois aaaa » suivie d'une liste. Le point signalant une nouveauté dans l'application
  apparaît dès que ce fichier change.
-->


## 8 octobre 2026
- **Prévisions météo** : la courbe des stations météo se prolonge dans le futur (7 jours, trait
  mixte, zone « prévision » ; glisser la barre sous la courbe pour avancer), tableau des prévisions
  jour par jour sur la page de la station, et alertes **prévu au-dessus / en dessous de** dans les
  24 h (chaleur, gel). Bouton **Prévisions** pour les masquer.
- **Valeurs colorées selon les seuils d'alerte** haut / bas (rouge foncé, orange, bleu léger, bleu
  foncé), sur Maintenant, Synthèse, emplacements et groupes ; flèches de tendance en gras rouge ou
  bleu si la situation s'aggrave, vertes si un pic ou un creux ramène vers la normale. Au choix dans
  Options : fond, texte ou couleur par grandeur.
- Flèches de pic / creux sans fond coloré.
- Nouvelle page **Synthèse** (après Maintenant ; glisser à gauche / à droite pour passer de l'une à
  l'autre sur le téléphone) : les courbes choisies et, dessous, les valeurs au curseur avec
  tendances et alertes. Curseur à « maintenant » par défaut.
- Téléphone : menu **Données** déplacé dans **Admin › Données**.
- Téléphone : l'affichage ne reste plus rétréci après un passage en paysage (plein écran des courbes).

## 7 octobre 2026
- Nouvelles **alertes** : **comparaison de deux emplacements** (« plus chaud dehors que dedans » :
  Extérieur plus haut que Salon de plus de 0 °C, aussi avec une station météo) et **montée ou baisse
  rapide** (plus de x °C par heure). À régler sous chaque courbe, rubrique Alertes.
- **Météo publique** collectée par le serveur et enregistrée : chaque commune suivie devient une
  **station météo**, un emplacement comme les autres (fiche, courbes, tendances, alertes), rangeable
  où l'on veut ; plusieurs communes possibles (Admin › Partage › Météo publique). La fiche Météo ne
  dépend plus du téléphone et ne disparaît plus.
- Page **Maintenant** : choisir les fiches affichées (emplacements, groupes, météo) dans Options ;
  la fiche Météo ne disparaît plus au renouvellement de la connexion.
- **Météo publique** (Open-Meteo) : température et humidité extérieures à la position de la maison,
  en fiche sur Maintenant et en courbe grise en pointillés sur les graphiques, historique compris.
  Position à régler dans Admin › Partage.
- Alerte **capteur muet** (plus de mesure depuis N heures) et **périodes sans mesure en gris** sur
  la courbe d'un emplacement.
- Courbes : **lignes verticales** aux graduations du temps, trait plus net à minuit.
- Courbes : l'infobulle donne la valeur de **toutes les courbes** à l'instant pointé (de la plus
  haute à la plus basse), même quand leurs mesures ne tombent pas à la même minute.
- Plein écran : quadrillage plus fin (lignes intermédiaires sans étiquette).
- Nouveau symbole « capteur » dans Admin › Emplacements.- Un **emplacement parent ne peut plus recevoir de capteur** (et un emplacement équipé ne peut plus
  contenir d'autres emplacements) ; les cas existants sont signalés dans Admin › Emplacements.
- La page d'un emplacement parent s'affiche aussi s'il avait encore un capteur (courbe « capteur
  propre »).

## 6 octobre 2026
- **Alertes** : seuils haut et bas, pics et creux, sur deux niveaux (info, importante), réglés sur
  la page de chaque emplacement. Cloche 🔔 avec le nombre d'alertes, page **Alertes** (glisser pour
  archiver), étiquettes sur les fiches, lignes de seuil sur les courbes, **notifications sur le
  téléphone** (Options).
- Guide d'utilisation simplifié : symboles dans le texte, copies d'écran regroupées à la fin.- Page **Maintenant** : fiches dans l'ordre de l'arborescence, regroupées par emplacement parent
  (cadre en pointillé avec la **moyenne** ⌀ et sa tendance) ; liseré de la couleur choisie pour
  l'emplacement.
- **Page d'un emplacement parent** : moyenne, courbes de ses sous-emplacements avec la moyenne en
  tirets, liste des sous-emplacements, couleur de la moyenne.
- Flèches de tendance : un **pic** est signalé dès que la baisse s'amorce (moitié du seuil).- **Couleur de chaque emplacement** dans les courbes : à choisir sur la page de l'emplacement
  (« Couleur dans les courbes ») ou dans Admin › Emplacements : 8 couleurs de la palette, gris,
  marron, turquoise… ou n'importe quelle couleur personnalisée.- **Guide d'utilisation** dans l'application : lien depuis « À propos » et « Options ».- **Flèches de tendance** sur la page Maintenant : plus ou moins inclinées selon la variation de la
  dernière heure (comparée à l'écart du jour), et flèche « cassée » orange quand on vient de passer
  un **pic** ou un **creux** (moment de fermer ou d'ouvrir les fenêtres). Réglages dans Options.
- Les mêmes flèches, avec la pente, en tête de la page de chaque emplacement.

## 3-4-5 octobre 2026
- Page **Maintenant** : bouton discret « Temp. / Hum. » pour n'afficher que la température.
- Nouvelle page **Options d'affichage** (icône à réglettes en haut) : taille du texte et
  présentation **compacte** (2 colonnes de fiches sur téléphone), grandeurs et rendu des courbes.
- **Plein écran** pour chaque courbe (bouton en haut à droite ; en paysage sur Android).
- Courbes plus faciles à lire au doigt : glisser dans la courbe déplace seulement le curseur des
  valeurs ; on se déplace dans le temps avec la barre sous la courbe, on zoome à deux doigts ou à
  la molette.
- Page **Courbes** : les emplacements apparaissent avec leur imbrication. Un emplacement parent
  (bouton en pointillé) affiche la **moyenne** de ses sous-emplacements, tracée en tirets ; ses
  sous-emplacements suivent sur la même ligne, ou en retrait dessous s'il n'y a pas la place.
  Les emplacements sans aucune mesure sont grisés.
- **Admin › Emplacements** : organiser l'arborescence en glissant un emplacement sur un autre
  (ou avec les flèches sur téléphone) et choisir l'ordre d'affichage.
- Nouveau rendu **Simplifié** : un point au milieu de chaque palier de valeurs identiques, pour
  des courbes vraiment lisses (le capteur arrondit au dixième, ce qui dessinait des marches même
  en « Lissé »). Trois rendus au choix : Escalier, Lissé (par défaut), Simplifié.
- **Courbes lissées** en option (bouton « Escalier / Lissé ») : rendu adouci entre les mesures,
  sans créer de faux pics ; les marches restent le rendu par défaut, fidèle aux mesures.
- **Masquer une grandeur** (par exemple l'humidité) : le choix vaut pour la page Courbes et pour
  les pages des emplacements, et il est mémorisé sur l'appareil.
- **Partage** : après une invitation, un message tout prêt à envoyer par WhatsApp, SMS ou e-mail,
  ou à copier (l'application n'envoie pas encore d'e-mails elle-même).
- **Import plus sûr** : les mesures déjà présentes à quelques minutes près sont reconnues, les
  conflits (valeurs différentes) sont montrés avant l'import, avec le choix de conserver ou de
  remplacer.
- Avertissement si le fuseau horaire choisi pour l'import semble incorrect.
- Nouvelle page **Données** : export CSV (emplacements, période, fuseau, format Excel) et import de
  fichiers CSV ou Excel, y compris les anciens tableurs Mobile Alerts.
- Bouton **Exporter les données** sur la page de chaque emplacement.
- **Maisons et partage** : invitez la famille ou des amis par leur adresse e-mail, en lecture ou en
  gestion.
- Création de compte et connexion avec Google.

- Page détaillée de chaque emplacement : courbes, minimum, maximum, moyenne, liste des mesures.
- Page **Courbes** : plusieurs emplacements superposés, 24 h à 1 an, glissement dans le temps.

## 2 octobre 2026
- Première version de l'application : valeurs actuelles et administration des capteurs.
- 
---

**Prochainement** : couleur des courbes par emplacement, courbes lissées en option, alertes sur
seuils (congélateur…), météo publique superposée aux courbes.
