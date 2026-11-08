'use client'
import {useEffect,useState} from 'react'
import {useParams} from 'next/navigation'

export default function Certificate(){
 const p=useParams<{number:string}>()
 const [c,setC]=useState<any>(null)
 const [loading,setLoading]=useState(true)
 useEffect(()=>{
  if(!p.number)return
  const url=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/verify-certificate?certificate=${encodeURIComponent(p.number)}`
  fetch(url,{cache:'no-store'}).then(r=>r.json()).then(x=>setC(x)).catch(()=>setC({valid:false})).finally(()=>setLoading(false))
 },[p.number])
 if(loading)return <div className="card" style={{maxWidth:900,margin:'40px auto',textAlign:'center'}}>Vérification du certificat…</div>
 if(!c?.valid)return <div className="card" style={{maxWidth:700,margin:'40px auto',textAlign:'center'}}><h1>Certificat non valide</h1><p>Ce certificat est introuvable, invalide ou révoqué.</p><a className="btn" href="/verification-certificat">Nouvelle vérification</a></div>
 return <main className="card certificate-print" style={{maxWidth:900,margin:'40px auto',textAlign:'center',padding:'clamp(30px,6vw,70px)'}}>
  <p className="eyebrow">DORA DIGITAL ACADEMY</p>
  <h1>Certificat de réussite</h1>
  <div className="certificate-seal">✓</div>
  <p>Ce certificat atteste de la réussite de la formation :</p>
  <h2>{c.course_title}</h2>
  <div className="certificate-grid">
   <div><span>Numéro</span><strong>{c.certificate_number}</strong></div>
   <div><span>Score</span><strong>{c.score}%</strong></div>
   <div><span>Date d'émission</span><strong>{new Date(c.issued_at).toLocaleDateString('fr-FR')}</strong></div>
   <div><span>Statut</span><strong className="valid-label">✓ Valide</strong></div>
  </div>
  <p className="muted">Authenticité vérifiable publiquement depuis DORA DIGITAL ACADEMY.</p>
  <p className="no-print inline-actions" style={{justifyContent:'center'}}>
   <button className="btn" onClick={()=>window.print()}>Imprimer / PDF</button>
   <a className="btn secondary" href={`/verification-certificat?certificate=${encodeURIComponent(c.certificate_number)}`}>Vérifier</a>
  </p>
 </main>
}
