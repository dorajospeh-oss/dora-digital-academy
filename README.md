# DORA DIGITAL ACADEMY — Frontend V15

V15 ajoute la gestion administrative des quiz : configuration du quiz, score de réussite, durée, tentatives et gestion des questions.

## Supabase
Le frontend utilise uniquement la clé publishable côté navigateur. Les opérations administrateur passent par des fonctions RPC protégées côté serveur.

## Développement
npm install
npm run typecheck
npm run build
npm run dev

## V23 — Certificats intégrés
- Génération du certificat PDF depuis l'espace apprenant via Edge Function sécurisée.
- Téléchargement par URL signée temporaire.
- Vérification publique via Edge Function `verify-certificate`.
- Le token QR reste optionnel pour la vérification manuelle et n'expose aucune donnée personnelle.


## V1.1 — Production Vercel
- Configuration `vercel.json` ajoutée.
- Exemple de variables `.env.example`.
- Guide `VERCEL_DEPLOY.md`.
- Base prête pour import dans Vercel.

## V1.5 — Authentification professionnelle
Le frontend utilise désormais les cookies SSR Supabase, un proxy Next.js 16 pour le renouvellement/protection des sessions, l’inscription, la connexion, la récupération et la réinitialisation du mot de passe, ainsi que la déconnexion.

## V1.6 — Commerce et paiement
- Panier connecté au RPC sécurisé `get_my_cart`.
- Modification des quantités et suppression d'articles.
- Création de commande via `create_cart_order` avec prix recalculés côté serveur.
- Redirection vers le paiement.
- Création de référence via `start_payment`.
- Suivi de commande via `get_my_order_status`.
- Rafraîchissement de statut toutes les 10 secondes.
- Aucune confirmation de paiement côté client.
- Les accès sont accordés uniquement après confirmation serveur/webhook.

## V1.9 — Certificats
- Vérification publique via Edge Function
- Page certificat professionnelle
- Recherche par numéro et token
- Génération PDF sécurisée conservée côté backend
