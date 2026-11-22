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
    return NextResponse.json({ error: 'Service de téléchargement indisponible.' }, { status: 503 })
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
  const token = String(body.token || '').trim()
  if (!/^DDA-[A-Z0-9]{8,24}$/.test(orderNumber) || !/^[a-f0-9]{64}$/i.test(token)) {
    return NextResponse.json({ error: 'Référence ou code d’accès invalide.' }, { status: 400 })
  }

  try {
    const endpoint = (url.endsWith('/') ? url.slice(0, -1) : url) + '/functions/v1/guest-download'
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify({ order_number: orderNumber, token }),
      cache: 'no-store',
    })
    const data = await response.json().catch(() => ({ error: 'Réponse de téléchargement illisible.' }))
    return NextResponse.json(data, { status: response.status })
  } catch {
    return NextResponse.json(
      { error: 'Le service de téléchargement est momentanément inaccessible.' },
      { status: 502 }
    )
  }
}
