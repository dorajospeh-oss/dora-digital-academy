'use client'

import { FormEvent, Suspense, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Turnstile } from '@marsidev/react-turnstile'
import { supabase } from '../../lib/supabase'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') || '/compte'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaKey, setCaptchaKey] = useState(0)

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  async function go(e: FormEvent) {
    e.preventDefault()
    setMsg('')

    if (!siteKey) {
      setMsg('Configuration CAPTCHA indisponible.')
      return
    }

    if (!captchaToken) {
      setMsg('Veuillez effectuer la vérification CAPTCHA.')
      return
    }

    setBusy(true)

    try {
      const { error } = await supabase().auth.signInWithPassword({
        email: email.trim(),
        password,
        options: {
          captchaToken,
        },
      })

      if (error) {
        setMsg(error.message)
        return
      }

      const destination =
        next.startsWith('/') && !next.startsWith('//')
          ? next
          : '/compte'

      router.replace(destination)
      router.refresh()
    } catch {
      setMsg('Une erreur est survenue pendant la connexion.')
    } finally {
      setBusy(false)
      setCaptchaToken('')
      setCaptchaKey(previous => previous + 1)
    }
  }

  return (
    <section>
      <h1>Connexion</h1>

      <p className="muted">
        Accédez à vos achats, formations, certificats et notifications.
      </p>

      <form onSubmit={go}>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </label>

        <label>
          Mot de passe
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </label>

        {siteKey ? (
          <div style={{ margin: '20px 0' }}>
            <Turnstile
              key={captchaKey}
              siteKey={siteKey}
              onSuccess={token => {
                setCaptchaToken(token)
                setMsg('')
              }}
              onExpire={() => {
                setCaptchaToken('')
                setMsg('La vérification a expiré. Veuillez recommencer.')
              }}
              onError={() => {
                setCaptchaToken('')
                setMsg('Erreur de vérification CAPTCHA.')
              }}
            />
          </div>
        ) : (
          <p className="notice" role="alert">
            Configuration CAPTCHA indisponible.
          </p>
        )}

        <button
          className="btn"
          disabled={busy || !captchaToken || !siteKey}
        >
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>

        {msg && (
          <p className="notice" role="alert">
            {msg}
          </p>
        )}

        <p>
          <Link href="/mot-de-passe-oublie">
            Mot de passe oublié ?
          </Link>
        </p>

        <p>
          Pas encore de compte ?{' '}
          <Link href="/inscription">Créer un compte</Link>
        </p>
      </form>
    </section>
  )
}

export default function Login() {
  return (
    <Suspense
      fallback={
        <section>
          <h1>Connexion</h1>
          <p>Chargement…</p>
        </section>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
