# Mise en place du projet Supabase

Compter 20 à 30 minutes. Tout se fait depuis le navigateur ; seule la reprise de l'historique
(étape 7) demande Python sur ton PC.

> Les valeurs marquées 🔒 sont secrètes : ne jamais les mettre dans le dépôt Git, ni les publier.

## 1. Créer le compte et le projet

1. Aller sur <https://supabase.com> > **Start your project** > **Continue with GitHub**
   (le compte GitHub existant suffit).
2. Créer une **organisation** : nom libre, type *Personal*, plan **Free**.
3. **New project** :
   - Name : `mobalplus`
   - Database Password 🔒 : cliquer sur *Generate a password* et **le conserver** (gestionnaire de
     mots de passe) : il sert au déploiement et à l'import.
   - Region : **West EU (Paris)** ou **Central EU (Frankfurt)**
   - Plan : Free
4. Attendre ~2 minutes que le projet soit prêt.

## 2. Relever les informations du projet

Dans le tableau de bord du projet :

| Information | Où la trouver | Usage |
|---|---|---|
| **Project ref** | Project Settings > General > *Project ID* (16 lettres) | déploiement |
| **Project URL** | Project Settings > Data API (`https://<ref>.supabase.co`) | PWA, collecte |
| **Clé publique** (*anon* / *publishable*) | Project Settings > API Keys | PWA (publique par nature) |
| **Chaîne de connexion** 🔒 | bouton **Connect** (en haut) > *Session pooler* > URI | import depuis le PC |

La clé *service_role* / *secret* 🔒 n'est utilisée que par l'Edge Function, qui la reçoit
automatiquement : il n'y a pas à la copier.

## 3. Créer un jeton d'accès pour le déploiement

supabase.com > avatar (en haut à droite) > **Account preferences > Access Tokens** >
*Generate new token* (nom : `github-mobalplus`). Copier le jeton 🔒.

## 4. Déployer depuis GitHub (sans rien installer)

1. Sur GitHub, dans le dépôt `MobAlPlus` : **Settings > Secrets and variables > Actions >
   New repository secret**, créer :
   - `SUPABASE_ACCESS_TOKEN` : le jeton de l'étape 3
   - `SUPABASE_PROJECT_REF` : le *Project ref*
   - `SUPABASE_DB_PASSWORD` : le mot de passe de la base
2. Onglet **Actions** > **Déploiement Supabase** > **Run workflow**.

Le workflow crée les tables et fonctions, planifie la collecte toutes les 10 minutes et la
maintenance de nuit, puis déploie l'Edge Function `collect`. Il peut être relancé à chaque
évolution du code.

> Alternative en local : `npx supabase login`, `npx supabase link --project-ref <ref>`,
> `npx supabase db push`, `npx supabase functions deploy collect`.

## 5. Secrets de la collecte

Dans **SQL Editor** > *New query*, remplacer `<ref>` puis exécuter :

```sql
select vault.create_secret('https://<ref>.supabase.co', 'mobalplus_project_url');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'mobalplus_collect_token');
select decrypted_secret from vault.decrypted_secrets where name = 'mobalplus_collect_token';
```

Le dernier résultat est le jeton de collecte 🔒. Puis **Edge Functions > Secrets** (ou
*Project Settings > Edge Functions*), ajouter :

| Nom | Valeur |
|---|---|
| `MA_VENDOR_ID` 🔒 | le *vendorid* Mobile Alerts (celui du script Apps Script) |
| `COLLECT_TOKEN` 🔒 | le jeton affiché ci-dessus |

## 6. Déclarer les capteurs

Depuis le PC (Python 3.10+) :

```bash
cd backend && pip install -e . && cd ..
cp .env.example .env                                  # coller la chaîne de connexion dans DATABASE_URL
cp config/devices.example.yaml config/devices.yaml    # remplacer les XXXXXXXX par les vrais ID
python -m mobalplus load-config config/devices.yaml
```

Dans les 10 minutes, la collecte démarre : elle remonte progressivement jusqu'à 90 jours en arrière
(10 jours par passage). Vérifier dans SQL Editor :

```sql
select d.ma_id, d.ma_name, s.status, s.last_ts, s.message
from device d left join device_sync s on s.device_id = d.id order by 1;
```

(L'interface d'administration remplacera ces requêtes.)

## 7. Reprendre l'historique des tableurs

Exporter chaque Google Sheet en `.xlsx` (*Fichier > Télécharger > Microsoft Excel*) dans `data/`, puis :

```bash
python -m mobalplus import-sheets data/*.xlsx
```

L'import compacte au fur et à mesure (la base reste sous le quota) et peut être relancé sans créer
de doublons.

## 8. Créer le compte administrateur de l'application

1. **Authentication > Users > Add user > Create new user** : ton e-mail et un mot de passe.
2. SQL Editor :
   ```sql
   insert into app_user (user_id, email, role)
   select id, email, 'admin' from auth.users where email = 'ton@email';
   ```

Ce compte servira à se connecter à la PWA. D'autres comptes en lecture seule peuvent être ajoutés
avec le rôle `viewer`.

## Bon à savoir

- **Mise en pause** : un projet gratuit inactif pendant une semaine est mis en pause. La collecte
  toutes les 10 minutes devrait suffire à le garder actif ; à surveiller les premières semaines
  (un projet en pause se relance d'un clic depuis le tableau de bord).
- **Tâches planifiées** : visibles dans *Integrations > Cron* (`mobalplus-collect`,
  `mobalplus-resync`, `mobalplus-maintenance`).
- **Journaux de la collecte** : *Edge Functions > collect > Logs*.
- **Volume** : `select stats();` dans SQL Editor (taille de la base, nombre de valeurs par niveau).
