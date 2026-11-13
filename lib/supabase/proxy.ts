import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const protectedPrefixes = ['/compte', '/apprentissage', '/admin']

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  const path = request.nextUrl.pathname
  const isProtected = protectedPrefixes.some(prefix => path === prefix || path.startsWith(prefix + '/'))

  if (isProtected && !claims?.sub) {
    const url = request.nextUrl.clone()
    url.pathname = '/connexion'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
