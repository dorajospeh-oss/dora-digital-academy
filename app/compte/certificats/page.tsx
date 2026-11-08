'use client'
import {useEffect,useState} from 'react'
import {supabase} from '../../../lib/supabase'

export default function Certificates(){
 const [d,setD]=useState<any[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[msg,setMsg]=useState('')
 useEffect(()=>{supabase().rpc('get_my_certificates').then(({data})=>{setD(data||[]);setLoading(false)})},[])
 async function generate(number:string){
  setBusy(number);setMsg('')
  const {data:{session}}=await supabase().auth.getSession()
  if(!session){setMsg('Veuillez vous reconnecter.');setBusy('');return}
  const res=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-certificate`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({certificate_number:number})})
  const body=await res.json()
  if(!res.ok||!body.url)setMsg(body.error||'Génération impossible.')
  else window.open(body.url,'_blank','noopener,noreferrer')
  setBusy('')
 }
 return <><h1>Mes certificats</h1>{msg&&<div className="notice">{msg}</div>}{loading?<p>Chargement…</p>:<div className="grid">{d.map(x=><div className="card" key={x.id}><h2>{x.course_title}</h2><p>N° {x.certificate_number}</p><p>Score : {x.score}%</p><p>Délivré le : {new Date(x.issued_at).toLocaleDateString('fr-FR')}</p>{x.revoked_at?<p className="notice">Certificat révoqué</p>:<><button className="button" onClick={()=>generate(x.certificate_number)} disabled={busy===x.certificate_number}>{busy===x.certificate_number?'Génération…':'Générer / télécharger le PDF'}</button><a className="button" href={'/certificat/'+x.certificate_number}>Voir le certificat</a></>}</div>)}{!d.length&&<div className="notice">Aucun certificat délivré.</div>}</div>}</>
}
