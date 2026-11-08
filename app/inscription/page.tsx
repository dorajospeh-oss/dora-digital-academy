'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { Turnstile } from '@marsidev/react-turnstile'
import { supabase } from '../../lib/supabase'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
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
      const { data, error } = await supabase().auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: name.trim(),
          },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/compte`,
          captchaToken,
        },
      })

      if (error) {
        setMsg(error.message)
        return
      }

      setMsg(
        data.session
          ? 'Compte créé. Vous êtes connecté.'
          : 'Compte créé. Vérifiez votre adresse email pour activer votre compte.'
      )
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
      <h1>Créer un compte</h1>

      <p className="muted">
        Créez votre espace personnel DORA DIGITAL ACADEMY.
      </p>

      <form onSubmit={go}>
        <label>
          Nom complet
          <input
            autoComplete="name"
            value={name}
            onChange={e => setName(e.target.value)}
            minLength={2}
            required
          />
        </label>

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
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <small className="muted">8 caractères minimum.</small>
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
          {busy ? 'Création…' : 'Créer mon compte'}
        </button>

        {msg && (
          <p className="notice" role="status">
            {msg}
          </p>
        )}

        <p>
          Déjà inscrit ? <Link href="/connexion">Se connecter</Link>
        </p>
      </form>
    </section>
  )
}