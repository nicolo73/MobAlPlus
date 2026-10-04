# Mise en ligne de l'application (Cloudflare Pages)

L'application est un site statique : Cloudflare Pages la construit et l'héberge gratuitement à
chaque `git push`, en HTTPS (obligatoire pour une PWA).

## 1. Créer le site

1. Créer un compte gratuit sur <https://dash.cloudflare.com/sign-up>.
2. Ouvrir la création d'un projet **Pages** :
   - lien direct : <https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/pages> ;
   - ou, dans le menu de gauche, **Compute (Workers)** (parfois **Build > Compute**) > **Workers & Pages**
     > bouton **Create** > onglet **Pages** (ou lien *Looking to deploy Pages? Get started* en bas
     de page).

   ⚠️ Bien choisir **Pages**, pas *Workers* : l'écran propose Workers par défaut.
3. **Connect to Git** (ou *Import an existing Git repository*) > **Connect GitHub** : autoriser
   Cloudflare (accès au seul dépôt `MobAlPlus` suffit), choisir le dépôt, **Begin setup**.
4. Paramètres de build :

   | Champ | Valeur |
   |---|---|
   | Production branch | la branche où se trouve le code (`ccr-38f7ce98-sk714f` tant qu'elle n'est pas fusionnée dans `main`) |
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory (avancé) | `web` |

5. **Environment variables** (Production et Preview) :

   | Nom | Valeur |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | clé publique *anon* / *publishable* du projet Supabase |
   | `NODE_VERSION` | `22` |

   Sans les deux variables Supabase, l'application démarre en **mode démo** (données fictives) :
   pratique pour l'essayer avant que le projet Supabase soit prêt.

6. **Save and Deploy**. L'adresse est du type `https://mobalplus.pages.dev`.

La clé *anon* est publique par nature : la protection des données repose sur la connexion et la
Row Level Security de la base.

## 2. Déclarer l'adresse dans Supabase

Supabase > **Authentication > URL Configuration** > *Site URL* : l'adresse Cloudflare
(utile pour les e-mails de réinitialisation de mot de passe).

## 3. (Option) Connexion « avec Google »

Le compte Google est reconnu par son adresse e-mail : il obtient les mêmes droits que l'entrée
correspondante de la table `app_user`.

1. **Google Cloud** : <https://console.cloud.google.com> > créer un projet `mobalplus`.
   - **APIs & Services** > **OAuth consent screen** (ou *Google Auth Platform*) : nom de
     l'application `MobAlPlus`, e-mail d'assistance, audience **External**. En mode *Testing*,
     ajouter ton adresse dans **Test users** (ou cliquer sur *Publish app*).
   - **Clients** (ou *Credentials*) > **Create client** > type **Web application** :
     - *Authorized JavaScript origins* : `https://mobalplus.pages.dev`
     - *Authorized redirect URIs* : `https://<ref>.supabase.co/auth/v1/callback`
   - Copier le **Client ID** et le **Client secret** 🔒.
2. **Supabase** : **Authentication** > **Sign In / Providers** > **Google** : activer, coller le
   Client ID et le Client secret, **Save**.
3. **Supabase** : **Authentication** > **URL Configuration** :
   - *Site URL* : `https://mobalplus.pages.dev`
   - *Redirect URLs* > **Add URL** : `https://mobalplus.pages.dev/**`
4. **Cloudflare** : projet `mobalplus` > **Settings** > **Variables and Secrets** : ajouter
   `VITE_AUTH_GOOGLE` = `true`, puis **Deployments** > dernier déploiement > **Retry deployment**
   (la variable est lue à la construction du site).

Le bouton **Continuer avec Google** apparaît alors sur la page de connexion.

## 4. Installer l'application sur le téléphone

- **Android (Chrome)** : ouvrir l'adresse, menu ⋮ > **Installer l'application**.
- **iPhone (Safari)** : bouton Partager > **Sur l'écran d'accueil**.

L'application se met à jour automatiquement à chaque nouvelle version publiée.

## 5. Plus tard : Play Store

La PWA peut être encapsulée en application Android (TWA) avec <https://www.pwabuilder.com> :
saisir l'adresse du site, générer le paquet Android, puis le publier depuis un compte développeur
Google Play (ou installer directement l'APK).

## Développement local

```bash
cd web
npm install
cp .env.example .env.local   # facultatif : sans ce fichier, mode démo
npm run dev                  # http://localhost:5173
```
