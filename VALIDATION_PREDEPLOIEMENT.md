# Rapport de validation préalable — DORA DIGITAL ACADEMY

## Contrôles réalisés

- Intégrité et contenu de l’archive contrôlés.
- Tous les fichiers source, la configuration Next.js/Vercel et les variables d’environnement d’exemple inspectés.
- Imports relatifs vérifiés après extraction.
- Configuration JSON vérifiée.
- Correctifs de compatibilité Next.js 16 appliqués : `Suspense` pour les pages utilisant `useSearchParams`, accès dynamique au slug produit, et script de vérification TypeScript.

## Limitation de cet environnement

L’installation des dépendances a été tentée avec `pnpm`, puis avec une installation locale de `npm`. L’environnement de validation ne peut pas résoudre `registry.npmjs.org` (`ENOTFOUND`) et le cache npm local ne contient pas les paquets requis (`ENOTCACHED`). Aucun package n’a donc été installé et le build `next build` ne peut pas être exécuté ici.

## Avant tout nouveau déploiement

Dans un environnement ayant accès au registre npm, lancer successivement :

```bash
npm install
npm run typecheck
npm run build
```

Ne pas déployer si l’une de ces commandes échoue. Les variables Vercel requises sont `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et `NEXT_PUBLIC_SITE_URL`.
