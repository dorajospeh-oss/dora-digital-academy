
'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

export default function Reset() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(true)
  const [msg, setMsg] = useState('Vérification du lien de récupération...')

  useEffect(() => {
    let active = true

    async function prepareRecovery() {
      try {
        const url = new URL(window.location.href)
        const hash = new URLSearchParams(url.hash.slice(1))
        const tokenHash = url.searchParams.get('token_hash')
        const type = url.searchParams.get('type')

        if (tokenHash && type === 'recovery') {
          const { error } = await supabase().auth  .verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          })

          if (error) throw error

          if (active) {
            setReady(true)
            setMsg('Lien vérifié. Vous pouvez choisir un nouveau mot de passe.')
          }
          return
        }

        const accessToken = hash.get('access_token')
        const refreshToken = hash.get('refresh_token')
        const hashType = hash.get('type')

        if (accessToken && refreshToken && hashType === 'recovery') {
          const { error } = await supabase().auth  .setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })

          if (error) throw error

          window.history.replaceState(
            {},
            document.title,
            window.location.pathname
          )

          if (active) {
            setReady(true)
            setMsg('Lien vérifié. Vous pouvez choisir un nouveau mot de passe.')
          }
          return
        }

        const { data, error } = await supabase().auth  .getSession()

        if (error) throw error

        if (active) {
          if (data.session) {
            setReady(true)
            setMsg('Session vérifiée. Vous pouvez choisir un nouveau mot de passe.')
          } else {
            setMsg('Lien de récupération invalide ou expiré. Demandez un nouveau lien.')
          }
        }
      } catch (error) {
        if (active) {
          setMsg(
            error instanceof Error
              ? `Vérification impossible : ${error.message}`
              : 'Impossible de vérifier le lien de récupération.'
          )
        }
      } finally {
        if (active) setBusy(false)
      }
    }

    prepareRecovery()

    return () => {
      active = false
    }
  }, [])

  async function savePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!ready) {
      setMsg('Le lien de récupération doit être vérifié avant de continuer.')
      return
    }

    if (password.length < 8) {
      setMsg('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }

    if (password !== confirm) {
      setMsg('Les deux mots de passe ne correspondent pas.')
      return
    }

    setBusy(true)
    setMsg('')

    try {
      const { error } = await supabase().auth  .updateUser({ password })

      if (error) throw error

      setMsg('Mot de passe modifié avec succès. Redirection vers la connexion...')
      setTimeout(() => router.replace('/compte'), 1500)
    } catch (error) {
      setMsg(
        error instanceof Error
          ? error.message
          : 'La modification du mot de passe a échoué.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h1>Nouveau mot de passe</h1>

      <form onSubmit={savePassword}>
        <label>
          Nouveau mot de passe
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={!ready || busy}
          />
        </label>

        <label>
          Confirmer
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            disabled={!ready || busy}
          />
        </label>

        <button type="submit" disabled={!ready || busy}>
          {busy ? 'Vérification...' : 'Enregistrer'}
        </button>

        {msg && <p className="notice" role="status">{msg}</p>}
      </form>
    </section>
  )
}
