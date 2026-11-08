'use client'

import { FormEvent, Suspense, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') || '/compte'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function go(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      setMsg(error.message)
      return
    }
    router.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/compte')
    router.refresh()
  }

  return (
    <section>
      <h1>Connexion</h1>
      <p className="muted">Accédez à vos achats, formations, certificats et notifications.</p>
      <form onSubmit={go}>
        <label>Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        <button className="btn" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        {msg && <p className="notice" role="alert">{msg}</p>}
        <p><Link href="/mot-de-passe-oublie">Mot de passe oublié ?</Link></p>
        <p>Pas encore de compte ? <Link href="/inscription">Créer un compte</Link></p>
      </form>
    </section>
  )
}

export default function Login() {
  return (
    <Suspense fallback={<section><h1>Connexion</h1><p>Chargement…</p></section>}>
      <LoginForm />
    </Suspense>
  )
}
