<!--
  Guide d'utilisation affiché dans l'application (page « Aide », lien depuis « À propos » et
  « Options »). Pour le modifier : éditer ce fichier sur GitHub (icône crayon), puis valider
  (« Commit changes ») ; l'application est reconstruite automatiquement en 1 à 2 minutes.
-->

# Guide d'utilisation

## Installer l'application sur le téléphone

MobAlPlus est une application web : pas de magasin d'applications, elle s'installe depuis le
navigateur et s'ouvre ensuite comme les autres.

- **Android (Chrome)** : menu **⋮** › **Ajouter à l'écran d'accueil** (ou **Installer l'application**).
- **iPhone (Safari)** : bouton **Partager** › **Sur l'écran d'accueil**.

Connexion : **Continuer avec Google**, ou adresse e-mail et mot de passe.

## Maintenant

Une fiche par emplacement : dernière température, humidité, et ancienneté de la mesure.

- Badge **ancienne** : pas de nouvelle mesure depuis un moment (pile faible, capteur hors de portée…).
- **Flèche de tendance** à côté de la valeur : plus elle est inclinée, plus la variation de la
  dernière heure est forte (comparée à l'écart habituel de la journée).
- **Flèche cassée orange** : on vient de passer un **pic** (la température redescend) ou un **creux**
  (elle remonte). C'est le moment de fermer ou d'ouvrir les fenêtres.
- Boutons **Temp. / Hum.** en haut : n'afficher que la température (ou que l'humidité).
- Les fiches suivent l'ordre choisi dans Admin › Emplacements. Les sous-emplacements d'un
  emplacement parent (ex. Jardin) sont regroupés dans un **cadre en pointillé** qui affiche leur
  **moyenne** (⌀) et sa tendance ; toucher le titre du cadre ouvre la page du groupe (moyenne,
  courbes de chaque sous-emplacement et de la moyenne).
- Le liseré coloré à gauche d'une fiche rappelle la couleur choisie pour l'emplacement dans les
  courbes.
- Toucher une fiche ouvre la page de l'emplacement.
- Les valeurs se mettent à jour toutes les 2 minutes ; ↻ pour forcer.

## Courbes

Plusieurs emplacements superposés, une courbe par grandeur (température, humidité).

- **Choisir les emplacements** en touchant leurs noms (8 courbes au plus). La couleur à gauche du
  nom est celle de la courbe. Pour fixer la couleur d'un emplacement : sur sa page, **Couleur dans
  les courbes** (droits « gestion ») : palette, gris, marron… ou **Personnalisée…** pour n'importe
  quelle teinte ; sinon une couleur libre est attribuée automatiquement.
- **Emplacement parent** (bouton en pointillé, ex. « Jardin ») : affiche la **moyenne** de ses
  sous-emplacements, tracée en tirets. Ses sous-emplacements suivent sur la même ligne, ou en
  retrait dessous.
- **Période** : 24 h, 3 j, 7 j, 30 j, 1 an ; **‹ ›** pour reculer ou avancer ; **Maintenant** pour
  revenir au présent.
- **Lire une valeur** : toucher la courbe et glisser le doigt ; l'infobulle donne les valeurs de
  chaque emplacement à cet instant.
- **Zoomer** : à deux doigts (ou molette de la souris).
- **Se déplacer dans le temps** : faire glisser la barre grise sous la courbe, ou tirer ses poignées
  pour élargir ou réduire la période.
- **Plein écran** : bouton ⛶ en haut à droite de chaque courbe (tourner le téléphone pour le
  paysage).
- **Rendu** :
  - *Escalier* : fidèle aux mesures (le capteur n'enregistre qu'aux changements) ;
  - *Lissé* : courbe adoucie passant par toutes les mesures ;
  - *Simplifié* : supprime les petites marches dues à l'arrondi du capteur au dixième.
- Le tableau en bas résume la période affichée : valeur actuelle, minimum, maximum.

## Page d'un emplacement

Valeurs actuelles avec leur tendance, courbes de la période, minimum, maximum (avec leur date),
moyenne, liste des mesures (les plus récentes d'abord), capteurs affectés et leurs périodes, et
bouton **Exporter les données**.

## Données

- **Exporter** : choisir les emplacements, les grandeurs, la période, puis télécharger un fichier
  CSV (format Excel français par défaut). Le fichier exemple montre le format.
- **Importer** (droits « gestion ») : fichier CSV ou Excel au format MobAlPlus, ou ancien tableur
  Mobile Alerts. L'analyse montre ce qui sera ajouté **avant** d'écrire quoi que ce soit : mesures
  nouvelles, identiques, ou en conflit (valeur différente à la même heure, à ± 2 minutes près). En
  cas de conflit, choisir de conserver l'existant ou de le remplacer.
- Préciser le **fuseau horaire** des dates du fichier : un avertissement s'affiche si les dates
  semblent décalées d'une ou deux heures.

## Options d'affichage

Icône à réglettes en haut de l'écran. Réglages mémorisés sur l'appareil.

- **Taille du texte** et **présentation compacte** (2 colonnes de fiches sur téléphone) : pour voir
  plus d'emplacements à la fois.
- **Grandeurs affichées** et **rendu des courbes**.
- **Flèches de tendance** : période de calcul (1 h par défaut), sensibilité, écart minimal pour
  signaler un pic ou un creux, durée de signalement.

## Partager la maison

**Admin › Partage** (propriétaire de la maison) : saisir l'adresse e-mail de la personne et ses
droits, puis **Inviter**.

| Droits | Peut… |
|---|---|
| **Lecture** | consulter valeurs, courbes, exporter |
| **Gestion** | en plus : capteurs, emplacements, import |
| **Propriétaire** | tout, y compris le partage |

L'application n'envoie pas encore d'e-mail : un message tout prêt s'affiche, à envoyer par
**WhatsApp**, SMS ou e-mail. La personne se connecte avec **cette adresse** (de préférence
« Continuer avec Google ») et voit aussitôt la maison.

## Administrer les capteurs et les emplacements

- **Admin › Emplacements** : créer les pièces et zones. Les ranger les unes dans les autres
  (ex. Jardin › Bosquet) en les **glissant** sur ordinateur, ou avec les **flèches** sur
  téléphone (↑ ↓ ordre, ← sortir du parent, → ranger dans l'emplacement du dessus). Un emplacement
  parent n'a normalement pas de capteur : il sert à regrouper et à faire la moyenne.
- **Admin › Capteurs** : **Ajouter un capteur** avec son identifiant Mobile Alerts (au dos du
  capteur) ; ses canaux (température, humidité…) apparaissent après la première collecte.
  **Affecter** chaque canal à un emplacement, avec la date de début.
- **Déplacer** un capteur : nouvelle affectation à partir d'une date ; l'historique de chaque
  emplacement reste juste.
- **Retirer** un capteur : il n'est plus relevé, son historique est conservé.

## Questions fréquentes

**Une valeur est marquée « ancienne ».** Le capteur n'a rien transmis récemment : vérifier ses
piles et la portée de la passerelle. Les mesures manquantes sont récupérées automatiquement dès
qu'il transmet à nouveau (jusqu'à 90 jours en arrière).

**La courbe fait des marches.** Le capteur arrondit au dixième de degré et n'enregistre qu'aux
changements : choisir le rendu *Simplifié* pour une courbe lisse.

**Je ne vois pas la maison qu'on m'a partagée.** Se connecter avec l'adresse exacte qui a été
invitée ; s'il y a plusieurs maisons, les choisir dans la liste en haut de l'écran.

**L'humidité a disparu.** Elle a été masquée : boutons **Temp. / Hum.** sur la page Maintenant, ou
**Options**.
