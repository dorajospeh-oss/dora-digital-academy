# DORA DIGITAL ACADEMY — Déploiement Vercel V1.1

## 1. Importer le projet
Importer ce dossier dans Vercel comme projet Next.js.

## 2. Variables d’environnement
Créer uniquement ces variables côté Vercel :

- `NEXT_PUBLIC_SUPABASE_URL` = `https://wtbxjqamwitwogxdrkwd.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = votre clé **publishable** Supabase

Ne jamais ajouter `SUPABASE_SERVICE_ROLE_KEY` dans les variables `NEXT_PUBLIC_*` ni dans le navigateur.

## 3. Build
- Install: `npm install`
- Build: `npm run build`
- Framework: Next.js

## 4. Domaine
Après le premier déploiement, Vercel fournit une URL `*.vercel.app`. Un domaine personnalisé peut ensuite être ajouté dans Project → Settings → Domains.

## 5. Production
Tester : accueil, boutique, formations, panier, connexion, compte, bibliothèque, notifications, certificats et vérification publique.

## 6. Important
Les paiements réels nécessitent encore les identifiants marchands des opérateurs concernés. Le fichier ebook doit également être présent dans le bucket privé `digital-files` avant de tester le téléchargement réel.
