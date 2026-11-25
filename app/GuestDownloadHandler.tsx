'use client'

import { useEffect, useState } from 'react'

type GuestDownloadResult = {
  ok?: boolean
  url?: string
  error?: string
  product_title?: string
}

export default function GuestDownloadHandler() {
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const currentUrl = new URL(window.location.href)
    if (currentUrl.searchParams.get('download') !== 'guest') return

    const orderNumber = currentUrl.searchParams.get('order') || ''
    const token = currentUrl.searchParams.get('token') || ''

    // Retire le jeton de l'adresse visible avant toute requête réseau.
    window.history.replaceState({}, document.title, currentUrl.pathname + currentUrl.hash)
    setVisible(true)

    if (!orderNumber || !token) {
      setMessage('Lien incomplet ou invalide. Vérifiez votre e-mail.')
      return
    }

    let cancelled = false
    setLoading(true)
    setMessage('Vérification sécurisée de votre achat…')

    ;(async () => {
      try {
        const response = await fetch('/api/guest-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_number: orderNumber, token }),
          cache: 'no-store',
        })
        const data = await response.json() as GuestDownloadResult
        if (!response.ok || !data.ok || !data.url) {
          throw new Error(data.error || 'Impossible de préparer le téléchargement.')
        }
        if (cancelled) return
        setTitle(data.product_title || 'Votre ressource numérique')
        setDownloadUrl(data.url)
        setMessage('Votre achat est confirmé. Le lien sécurisé est valable cinq minutes.')
      } catch (error) {
        if (cancelled) return
        setMessage(error instanceof Error ? error.message : 'Une erreur empêche le téléchargement.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [])

  if (!visible) return null

  return (
    <div className="guest-download-backdrop" role="presentation">
      <section
        className="guest-download-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-download-title"
      >
        <p className="eyebrow">DORA DIGITAL ACADEMY</p>
        <h2 id="guest-download-title">Votre téléchargement sécurisé</h2>
        {title && <p><strong>{title}</strong></p>}
        <p role="status" aria-live="polite">{loading ? 'Préparation en cours…' : message}</p>
        {downloadUrl && (
          <a className="btn" href={downloadUrl}>
            Télécharger mon eBook
          </a>
        )}
      </section>
    </div>
  )
}
