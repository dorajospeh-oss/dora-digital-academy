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
    return NextResponse.json({ error: 'Configuration du paiement indisponible.' }, { status: 503 })
  }
  if (!/^Bearer\\s+\\S+$/i.test(authorization)) {
    return NextResponse.json({ error: 'Connectez-vous pour payer cette commande.' }, { status: 401 })
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
  const provider = String(body.provider || '')
  const phone = String(body.phone || '')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
    return NextResponse.json({ error: 'Identifiant de commande invalide.' }, { status: 400 })
  }
  if (!['orange_money', 'airtel_money', 'moov_money'].includes(provider)) {
    return NextResponse.json({ error: 'Moyen de paiement non pris en charge.' }, { status: 400 })
  }
  if (!/^\\+[1-9][0-9]{7,14}$/.test(phone)) {
    return NextResponse.json({ error: 'Numéro Mobile Money au format international requis.' }, { status: 400 })
  }

  try {
    const endpoint = (url.endsWith('/') ? url.slice(0, -1) : url) + '/functions/v1/start-account-payment'
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: authorization,
      },
      body: JSON.stringify({ order_id: orderId, provider, phone }),
      cache: 'no-store',
    })
    const data = await response.json().catch(() => ({ error: 'Réponse de paiement illisible.' }))
    return NextResponse.json(data, { status: response.status, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json(
      { error: 'Le service de paiement est momentanément inaccessible. Votre commande reste enregistrée.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
