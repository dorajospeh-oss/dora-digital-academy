import type { MetadataRoute } from 'next'
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  return ['/', '/boutique', '/offres', '/formations', '/connexion', '/inscription', '/mentions-legales', '/verification-certificat'].map((path) => ({ url: `${base}${path}`, lastModified: new Date() }))
}
