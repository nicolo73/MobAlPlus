# Mise en ligne de l'application (Cloudflare Pages)

L'application est un site statique : Cloudflare Pages la construit et l'héberge gratuitement à
chaque `git push`, en HTTPS (obligatoire pour une PWA).

## 1. Créer le site

1. Créer un compte gratuit sur <https://dash.cloudflare.com/sign-up>.
2. **Workers & Pages > Create > Pages > Connect to Git**, autoriser GitHub, choisir le dépôt `MobAlPlus`.
3. Paramètres de build :

   | Champ | Valeur |
   |---|---|
   | Production branch | `main` (ou la branche de travail) |
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory (avancé) | `web` |

4. **Environment variables** (Production et Preview) :

   | Nom | Valeur |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | clé publique *anon* / *publishable* du projet Supabase |
   | `NODE_VERSION` | `22` |

   Sans les deux variables Supabase, l'application démarre en **mode démo** (données fictives) :
   pratique pour l'essayer avant que le projet Supabase soit prêt.

5. **Save and Deploy**. L'adresse est du type `https://mobalplus.pages.dev`.

La clé *anon* est publique par nature : la protection des données repose sur la connexion et la
Row Level Security de la base.

## 2. Déclarer l'adresse dans Supabase

Supabase > **Authentication > URL Configuration** > *Site URL* : l'adresse Cloudflare
(utile pour les e-mails de réinitialisation de mot de passe).

## 3. Installer l'application sur le téléphone

- **Android (Chrome)** : ouvrir l'adresse, menu ⋮ > **Installer l'application**.
- **iPhone (Safari)** : bouton Partager > **Sur l'écran d'accueil**.

L'application se met à jour automatiquement à chaque nouvelle version publiée.

## Plus tard : Play Store

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
