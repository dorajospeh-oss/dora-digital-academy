'use client'
import {Suspense,useEffect,useState} from 'react'
import {useSearchParams} from 'next/navigation'

function VerificationForm(){
 const params=useSearchParams(); const [number,setNumber]=useState(params.get('certificate')||''); const [token,setToken]=useState(params.get('token')||''); const [r,setR]=useState<any>(null); const [busy,setBusy]=useState(false)
 useEffect(()=>{if(params.get('certificate')) verify(params.get('certificate')!,params.get('token')||'')},[])
 async function verify(n=number,t=token){
  if(!n.trim())return
  setBusy(true);setR(null)
  try{const u=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/verify-certificate?certificate=${encodeURIComponent(n.trim())}${t?'&token='+encodeURIComponent(t.trim()):''}`;const res=await fetch(u,{cache:'no-store'});setR(await res.json())}catch{setR({valid:false})}finally{setBusy(false)}
 }
 return <><h1>Vérifier un certificat</h1><p className="muted">Contrôlez l'authenticité d'un certificat DORA DIGITAL ACADEMY.</p><form onSubmit={e=>{e.preventDefault();verify()}}>
  <label>Numéro du certificat<input value={number} onChange={e=>setNumber(e.target.value)} placeholder="DDA-2026-XXXXXXXXXX" required/></label>
  <label>Token QR <span className="muted">(optionnel)</span><input value={token} onChange={e=>setToken(e.target.value)} placeholder="Token de vérification"/></label>
  <button className="btn" disabled={busy}>{busy?'Vérification…':'Vérifier le certificat'}</button>
 </form>
 {r&&<div className="card verification-card">{!r.valid?<><h2>✕ Certificat non valide</h2><p>Le certificat est introuvable, invalide ou révoqué.</p></>:<><div className="verification-status">✓ Certificat valide</div><h2>{r.course_title}</h2><p><strong>N° {r.certificate_number}</strong></p><p>Score : <strong>{r.score}%</strong></p><p>Émis le {new Date(r.issued_at).toLocaleDateString('fr-FR')}</p><a className="btn" href={`/certificat/${encodeURIComponent(r.certificate_number)}`}>Voir le certificat</a></>}</div>}
 </>
}

export default function Verify(){return <Suspense fallback={<main><h1>Vérifier un certificat</h1><p className="muted">Chargement…</p></main>}><VerificationForm/></Suspense>}
