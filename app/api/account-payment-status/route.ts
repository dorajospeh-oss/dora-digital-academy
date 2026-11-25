import { NextRequest, NextResponse } from 'next/server'

function isAllowedHost(host: string) {
  return host === 'dora-digital-academy-1mvr.vercel.app'
    || (host.startsWith('dora-digital-academy-1mvr-') && host.endsWith('-dorajospeh-oss.vercel.app'))
    || host === 'localhost'
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const authorization = request.headers.get('authorization') || ''

  if (!url || !key) {
    return NextResponse.json({ error: 'Configuration du suivi de paiement indisponible.' }, { status: 503 })
  }
  if (!/^Bearer\\s+\\S+$/i.test(authorization)) {
    return NextResponse.json({ error: 'Connectez-vous pour vérifier cette commande.' }, { status: 401 })
  }

  const origin = request.headers.get('origin')
  if (origin) {
    try {
      if (!isAllowedHost(new URL(origin).hostname)) {
        return NextResponse.json({ error: 'Origine non autorisée.' }, { status: 403 })
      }
    } catch {
      return NextResponse.json({ error: 'Origine invalide.' }, { status: 403 })
    }
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  }

  const orderId = String(body.order_id || '')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
    return NextResponse.json({ error: 'Identifiant de commande invalide.' }, { status: 400 })
  }

  try {
    const endpoint = (url.endsWith('/') ? url.slice(0, -1) : url) + '/functions/v1/check-account-payment-status'
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: authorization,
      },
      body: JSON.stringify({ order_id: orderId }),
      cache: 'no-store',
    })
    const data = await response.json().catch(() => ({ error: 'Réponse de suivi illisible.' }))
    return NextResponse.json(data, { status: response.status, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json(
      { error: 'Le service de suivi est momentanément inaccessible.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
