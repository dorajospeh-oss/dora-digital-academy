'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { Turnstile } from '@marsidev/react-turnstile'
import { supabase } from '../../lib/supabase'

export default function Forgot() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaKey, setCaptchaKey] = useState(0)

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  async function go(e: FormEvent) {
    e.preventDefault()
    setMsg('')

    if (!siteKey) {
      setMsg('Configuration CAPTCHA manquante.')
      return
    }

    if (!captchaToken) {
      setMsg('Veuillez valider la vérification de sécurité.')
      return
    }

    setBusy(true)

    try {
      const { error } = await supabase().auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: `${window.location.origin}/auth/reset-password`,
          captchaToken,
        }
      )

      if (error) {
        setMsg(error.message)
      } else {
        setMsg(
          'Si cette adresse correspond à un compte, un email de récupération vient d’être envoyé.'
        )
      }
    } catch {
      setMsg('Une erreur est survenue. Veuillez réessayer.')
    } finally {
      setBusy(false)
      setCaptchaToken('')
      setCaptchaKey(key => key + 1)
    }
  }

  return (
    <section>
      <h1>Mot de passe oublié</h1>

      <p className="muted">
        Saisissez votre email pour recevoir un lien sécurisé de réinitialisation.
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
          {busy ? 'Envoi…' : 'Recevoir le lien'}
        </button>

        {msg && (
          <p className="notice" role="status">
            {msg}
          </p>
        )}

        <p>
          <Link href="/connexion">Retour à la connexion</Link>
        </p>
      </form>
    </section>
  )
}