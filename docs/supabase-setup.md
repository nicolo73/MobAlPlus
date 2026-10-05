# Mise en place du projet Supabase

Trois endroits interviennent. Chaque étape indique où elle se fait :

| Repère | Où | Pour quoi |
|---|---|---|
| 🟩 **Supabase** | <https://supabase.com/dashboard> : le tableau de bord du projet | base de données, secrets, comptes |
| ⬛ **GitHub** | le dépôt `MobAlPlus` sur github.com | déploiement automatique du code vers Supabase |
| 💻 **PC** | ton ordinateur, avec Python | uniquement la reprise de l'historique des Google Sheets |

> Les valeurs marquées 🔒 sont secrètes : ne jamais les mettre dans le dépôt Git, ni les envoyer
> par message.

Dans les liens ci-dessous, remplacer `<ref>` par l'identifiant du projet (*Project ID*, 20 lettres,
visible dans l'adresse du tableau de bord : `supabase.com/dashboard/project/<ref>`).

## Vue d'ensemble

| # | Étape | Où |
|---|---|---|
| 1 | Créer le compte et le projet | 🟩 Supabase |
| 2 | Créer un jeton d'accès pour GitHub | 🟩 Supabase |
| 3 | Donner ce jeton à GitHub et déployer | ⬛ GitHub |
| 4 | Créer les secrets de la collecte (2 requêtes SQL + 2 secrets) | 🟩 Supabase |
| 5 | Créer ton compte administrateur | 🟩 Supabase |
| 6 | Mettre l'application en ligne ([deploiement-web.md](deploiement-web.md)) | Cloudflare |
| 7 | Déclarer les capteurs (dans l'application, onglet Admin) | 📱 application |
| 8 | Reprendre l'historique des Google Sheets | 💻 PC |

---

## 1. 🟩 Créer le compte et le projet

1. <https://supabase.com> > **Start your project** > **Continue with GitHub**.
2. Créer une **organisation** : nom libre, type *Personal*, plan **Free**.
3. **New project** :
   - Name : `mobalplus`
   - Database Password 🔒 : *Generate a password*, et **le conserver** (gestionnaire de mots de passe)
   - Region : **West EU (Paris)** ou **Central EU (Frankfurt)**
4. Attendre ~2 minutes que le projet soit prêt.

## 2. 🟩 Créer un jeton d'accès pour GitHub

Lien direct : <https://supabase.com/dashboard/account/tokens>
(ou avatar en haut à droite > *Account preferences* > *Access Tokens*).

*Generate new token*, nom `github-mobalplus`, copier le jeton 🔒 (`sbp_…`).

## 3. ⬛ Donner le jeton à GitHub et déployer

1. Dépôt `MobAlPlus` sur GitHub > **Settings** > **Secrets and variables** > **Actions** >
   **New repository secret**. Créer trois secrets :

   | Nom | Valeur |
   |---|---|
   | `SUPABASE_ACCESS_TOKEN` | le jeton de l'étape 2 🔒 |
   | `SUPABASE_PROJECT_REF` | l'identifiant du projet (`<ref>`) |
   | `SUPABASE_DB_PASSWORD` | le mot de passe de la base 🔒 |

2. Onglet **Actions** > **Déploiement Supabase** (colonne de gauche) > **Run workflow**.
3. Attendre la coche verte (1 à 2 minutes).

✔️ Vérification 🟩 : **Table Editor** affiche les tables (`device`, `place`, `reading`…) et
**Edge Functions** affiche la fonction `collect`.

Ce workflow est à relancer à chaque évolution du code de la base ou du collecteur.

## 4. 🟩 Créer les secrets de la collecte

La collecte a besoin de quatre informations, rangées à deux endroits de Supabase.

### 4a. Dans la base (Vault) : 2 secrets, par SQL

**SQL Editor** (lien direct : `https://supabase.com/dashboard/project/<ref>/sql/new`).
Remplacer `<ref>` dans la première ligne, puis **Run** :

```sql
select vault.create_secret('https://<ref>.supabase.co', 'mobalplus_project_url');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'mobalplus_collect_token');
select name, decrypted_secret from vault.decrypted_secrets where name like 'mobalplus%';
```

Le résultat affiche deux lignes : l'URL du projet, et le **jeton de collecte** 🔒 (64 caractères),
à copier pour l'étape 4b.

> **Erreur de saisie ?** `create_secret` ne peut pas être rejoué (*duplicate key*). Corriger avec
> `update_secret`, puis relancer la dernière ligne pour vérifier :
> ```sql
> select vault.update_secret((select id from vault.secrets where name = 'mobalplus_project_url'),
>                            'https://<ref>.supabase.co');
> ```

### 4b. Dans les Edge Functions : 2 secrets, par formulaire

Lien direct : `https://supabase.com/dashboard/project/<ref>/functions/secrets`
(menu de gauche **Edge Functions** > sous-menu **Secrets**).

Dans *Add or replace secrets*, ajouter deux lignes puis **Save** :

| Name | Value |
|---|---|
| `MA_VENDOR_ID` | le *vendorid* Mobile Alerts 🔒 (celui du script Apps Script, format `xxxxxxxx-xxxx-…`) |
| `COLLECT_TOKEN` | le jeton de collecte affiché à l'étape 4a 🔒 |

Les autres secrets déjà listés (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`…) sont fournis par
Supabase : ne pas y toucher.

✔️ Vérification : **Integrations** > **Cron** affiche trois tâches `mobalplus-collect` (toutes les
10 min), `mobalplus-resync` et `mobalplus-maintenance` (la nuit). Tant qu'aucun capteur n'est
déclaré, la collecte tourne à vide : c'est normal.

## 5. 🟩 Créer ton compte administrateur

1. **Authentication** > **Users** > **Add user** > **Create new user** : ton e-mail et un mot de
   passe (cocher *Auto Confirm User*).
2. **SQL Editor**, remplacer l'e-mail puis **Run** :
   ```sql
   insert into app_user (user_id, email, role)
   select id, email, 'admin' from auth.users where email = 'ton@email';
   ```

C'est ce compte qui se connecte à l'application. Les droits sont rattachés à l'**adresse e-mail** :
supprimer / recréer l'utilisateur, ou se connecter avec Google, conserve le rôle. Pour autoriser
une autre personne, même avant sa première connexion :
```sql
insert into app_user (email, role) values ('adresse@exemple.fr', 'viewer');   -- ou 'admin'
```

## 5 bis. Partager une maison (famille, amis)

Les données sont rangées par **maison** (les capteurs existants sont dans « Ma maison », dont tu es
propriétaire). Chaque compte ne voit que les maisons qui lui sont partagées.

| Droits | Peut… |
|---|---|
| **Propriétaire** | tout, y compris inviter, retirer, changer les droits |
| **Gestion** | gérer capteurs, emplacements, corrections ; lancer une collecte de ses capteurs |
| **Lecture** | consulter valeurs et courbes |

Dans l'application : **Admin** > **Partage** > saisir l'e-mail de la personne et ses droits >
**Inviter**. Elle se connecte ensuite avec cette adresse et voit la maison immédiatement.

Pour que la personne puisse se connecter :
- **avec Google** (le plus simple) : activer le fournisseur Google (voir
  [deploiement-web.md](deploiement-web.md), section 3) ;
- **avec e-mail et mot de passe** : elle crée son compte depuis l'écran de connexion
  (« Pas encore de compte ? »). ⚠️ Le service d'e-mail fourni par défaut par Supabase n'envoie les
  e-mails de confirmation qu'aux membres de l'équipe du projet : pour la famille, configurer un
  service d'envoi (🟩 **Authentication** > **Emails** > **SMTP Settings**, par exemple Resend ou
  Brevo, offres gratuites), ou créer le compte toi-même (**Authentication** > **Users** >
  **Add user**, en cochant *Auto Confirm User*) et lui transmettre le mot de passe.

Laisser activée l'option **Confirm email** (🟩 **Authentication** > **Sign In / Providers** >
**Email**) : c'est elle qui garantit qu'une adresse appartient bien à la personne qui se connecte.

## 6. Mettre l'application en ligne

Voir [deploiement-web.md](deploiement-web.md) (Cloudflare Pages, une dizaine de minutes).
Il faut l'URL du projet et la **clé publique** (`sb_publishable_…`), visible dans
🟩 **Project Settings** > **API Keys**.

## 7. 📱 Déclarer les capteurs

Dans l'application, connecté avec le compte de l'étape 5 :

1. **Admin** > **Emplacements** : créer les pièces et zones (Salon, Extérieur, Cave…).
2. **Admin** > **Capteurs** > *Ajouter un capteur* : saisir l'identifiant Mobile Alerts. Une
   première collecte est lancée aussitôt et détecte les canaux (température, humidité…).
3. Pour chaque canal : **affecter** à un emplacement.

La collecte automatique remonte ensuite jusqu'à 90 jours en arrière, par tranches de 10 jours
toutes les 10 minutes. **Admin** > **Tableau de bord** montre l'état de chaque capteur.

> Variante 💻 : déclarer tous les capteurs d'un coup depuis le PC avec le fichier
> `config/devices.yaml` (`python -m mobalplus load-config config/devices.yaml`, voir étape 8 pour
> la préparation du PC).

## 8. 💻 Reprendre l'historique des Google Sheets

1. Récupérer la **chaîne de connexion** 🟩 : bouton **Connect** (en haut du tableau de bord) >
   onglet *Connection string* > méthode **Session pooler** > copier l'URI
   (`postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`) et y
   remplacer `[YOUR-PASSWORD]` par le mot de passe de la base 🔒.
   Ne pas prendre la *Direct connection* (`db.<ref>.supabase.co`) : elle ne fonctionne qu'en IPv6.
2. Sur le PC (Python 3.10+), dans une copie du dépôt :
   ```bash
   cd backend && pip install -e . && cd ..
   cp .env.example .env          # puis coller la chaîne de connexion dans DATABASE_URL
   ```
3. Exporter chaque Google Sheet en `.xlsx` (*Fichier* > *Télécharger* > *Microsoft Excel*) dans
   un dossier `data/`, puis :
   ```bash
   python -m mobalplus import-sheets data/*.xlsx
   ```

Les capteurs inconnus sont créés automatiquement (il restera à affecter leurs canaux dans
l'application). L'import compacte au fur et à mesure, la base reste sous le quota, et il peut être
relancé sans créer de doublons.

---

## Bon à savoir

| Besoin | Où regarder 🟩 |
|---|---|
| La collecte fonctionne-t-elle ? | **Edge Functions** > `collect` > **Logs** ; ou l'application, Admin > Tableau de bord |
| Tâches planifiées | **Integrations** > **Cron** |
| Volume de la base | **SQL Editor** : `select stats();` ; ou l'application, Admin > Tableau de bord |
| Changer une clé | **Project Settings** > **API Keys** |

- **Mise en pause** : un projet gratuit inactif pendant une semaine est mis en pause. La collecte
  toutes les 10 minutes devrait suffire à le garder actif ; à surveiller les premières semaines
  (un projet en pause se relance d'un clic depuis le tableau de bord).
- **Alternative au déploiement GitHub** (étape 3), depuis un PC avec Node.js :
  `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push`,
  `npx supabase functions deploy collect`.
