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

  if (!url || !key) {
    return NextResponse.json({ error: 'Configuration du suivi de commande indisponible.' }, { status: 503 })
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

  const orderNumber = String(body.order_number || '').trim().toUpperCase()
  const email = String(body.email || '').trim().toLowerCase()
  if (!/^DDA-[A-F0-9]{16}$/.test(orderNumber) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Référence de commande ou adresse e-mail invalide.' }, { status: 400 })
  }

  try {
    const endpoint = (url.endsWith('/') ? url.slice(0, -1) : url) + '/functions/v1/check-guest-payment-status'
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
      },
      body: JSON.stringify({ order_number: orderNumber, email }),
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
