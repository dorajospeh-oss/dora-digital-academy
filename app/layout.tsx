import './globals.css'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: {
    default: 'DORA DIGITAL ACADEMY — Apprenez. Créez. Développez. Réussissez.',
    template: '%s | DORA DIGITAL ACADEMY',
  },
  description: 'Formations, ebooks, prompts IA, outils et ressources numériques pour apprendre, créer et développer vos projets.',
  keywords: ['DORA DIGITAL ACADEMY', 'formations en ligne', 'IA', 'business', 'marketing digital', 'ebooks'],
  authors: [{ name: 'DORA DIGITAL ACADEMY' }],
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  openGraph: {
    title: 'DORA DIGITAL ACADEMY',
    description: 'Apprenez. Créez. Développez. Réussissez.',
    type: 'website',
    locale: 'fr_FR',
    siteName: 'DORA DIGITAL ACADEMY',
  },
  robots: { index: true, follow: true },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <header className="dda-site-header">
          <div className="dda-header-inner">
            <Link href="/" className="dda-brand">
              <span className="dda-brand-mark">D</span>
              <span className="dda-brand-copy">
                <strong>DORA DIGITAL ACADEMY</strong>
                <small>APPRENDRE • CRÉER • RÉUSSIR</small>
              </span>
            </Link>

            <nav className="dda-nav" aria-label="Navigation principale">
              <Link href="/#accueil">Accueil</Link>
              <Link href="/#formations">Formations</Link>
              <Link href="/#bibliotheque">Bibliothèque</Link>
              <Link href="/boutique">Boutique eBooks</Link>
              <Link href="/#espace">Mon espace</Link>
            </nav>

            <div className="dda-header-actions">
              <Link href="/panier" className="dda-cart-link">Panier</Link>
              <Link href="/connexion" className="dda-nav-auth">
                Se connecter
              </Link>
            </div>
          </div>
        </header>

        <main>{children}</main>

        <footer className="dda-site-footer">
          <div className="dda-footer-inner">
            <div>
              <strong>DORA DIGITAL ACADEMY</strong>
              <p>Apprenez. Créez. Développez. Réussissez.</p>
            </div>

            <nav aria-label="Navigation de pied de page">
              <Link href="/formations">Formations</Link>
              <Link href="/boutique">Boutique</Link>
              <Link href="/mentions-legales">Mentions légales</Link>
            </nav>

            <small>© 2026 DORA DIGITAL ACADEMY. Tous droits réservés.</small>
          </div>
        </footer>
      </body>
    </html>
  )
}
