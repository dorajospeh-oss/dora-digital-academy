# Corrections avant redéploiement — DORA DIGITAL ACADEMY

Cette archive inclut les corrections suivantes pour Next.js 16 :

1. `app/admin/page.tsx` : correction de la syntaxe JSX dans la section Certificats et suppression d’un élément bloc imbriqué dans un `span`.
2. `app/paiement/page.tsx` et `app/verification-certificat/page.tsx` : ajout d’une frontière `Suspense` autour de `useSearchParams`, obligatoire lors d’un build de production statique.
3. `app/boutique/[slug]/page.tsx` : remplacement de l’ancienne prop `params` synchrone par `useParams` côté client, compatible avec Next.js 16.
4. `package.json` : remplacement de la commande supprimée `next lint` par `npm run typecheck` (`tsc --noEmit`).
5. Les imports Supabase corrigés dans la révision précédente sont conservés.

## Variables d’environnement nécessaires dans Vercel

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SITE_URL` (URL du site de test)

Les valeurs doivent correspondre à votre projet Supabase. Ne publiez jamais une clé secrète/service-role dans une variable `NEXT_PUBLIC_*`.

## Validation à effectuer avant Vercel

Exécutez localement ou dans une intégration continue avec accès au registre npm :

1. `npm install`
2. `npm run typecheck`
3. `npm run build`

Le build Vercel ne doit être lancé qu’après réussite de ces trois commandes.
