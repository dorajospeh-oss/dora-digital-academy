import './globals.css'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: {
    default: 'DORA DIGITAL ACADEMY — Apprenez. Créez. Développez. Réussissez.',
    template: '%s | DORA DIGITAL ACADEMY',
  },
  description: 'Formations, ebooks, prompts IA, outils et ressources numériques pour apprendre, créer et développer vos projets.',
  keywords: ['DORA DIGITAL ACADEMY','formations en ligne','IA','prompts IA','business','marketing digital','ebooks','Afrique francophone'],
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

export default function Layout({children}:{children:React.ReactNode}){
  return <html lang="fr"><body>
    <header>
      <Link href="/" className="brand">DORA DIGITAL ACADEMY</Link>
      <nav aria-label="Navigation principale">
        <Link href="/boutique">Boutique</Link>
        <Link href="/offres">Offres</Link>
        <Link href="/formations">Formations</Link>
        <Link href="/panier">Panier</Link>
        <Link href="/compte">Mon compte</Link>
      </nav>
    </header>
    <main>{children}</main>
    <footer>© 2026 DORA DIGITAL ACADEMY — Apprenez. Créez. Développez. Réussissez. · <Link href="/mentions-legales">Mentions légales</Link></footer>
  </body></html>
}
