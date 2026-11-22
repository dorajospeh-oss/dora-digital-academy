import { NextRequest, NextResponse } from 'next/server'

function isAllowedHost(host: string) {
  return host === 'dora-digital-academy-1mvr.vercel.app'
    || /^dora-digital-academy-1mvr-[a-z0-9-]+-dorajospeh-oss\\.vercel\\.app$/.test(host)
    || host === 'localhost'
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    return NextResponse.json({ error: 'Configuration du paiement indisponible.' }, { status: 503 })
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

  const authorization = request.headers.get('authorization') || ''
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: key,
  }
  // A visitor without an account is intentionally sent as a guest.
  // For authenticated buyers, forward only the user's access token.
  if (/^Bearer\\s+\\S+$/i.test(authorization)) {
    headers.Authorization = authorization
  }

  try {
    const response = await fetch(
      url.replace(/\\/$/, '') + '/functions/v1/create-payment',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store',
      }
    )
    const data = await response.json().catch(() => ({ error: 'Réponse de paiement illisible.' }))
    return NextResponse.json(data, { status: response.status })
  } catch {
    return NextResponse.json(
      { error: 'Le service de paiement est momentanément inaccessible.' },
      { status: 502 }
    )
  }
}
