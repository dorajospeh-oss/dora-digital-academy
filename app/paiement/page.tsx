'use client'
import {Suspense,useState} from 'react'
import {useSearchParams} from 'next/navigation'
import Link from 'next/link'

const methods=[['orange','Orange Money'],['airtel','Airtel Money']] as const
function PaymentContent(){
 const params=useSearchParams()
 const productId=params.get('product')
 const [method,setMethod]=useState<'orange'|'airtel'>('orange')
 const [fullName,setFullName]=useState('')
 const [email,setEmail]=useState('')
 const [phone,setPhone]=useState('')
 const [busy,setBusy]=useState(false)
 const [message,setMessage]=useState('')
 const [result,setResult]=useState<any>(null)
 async function start(){
  if(!productId)return setMessage('Produit introuvable. Retournez à la boutique.')
  if(!fullName.trim())return setMessage('Veuillez renseigner votre nom complet.')
  if(!email.trim()||!/^\\S+@\\S+\\.\\S+$/.test(email))return setMessage('Veuillez saisir une adresse e-mail valide pour recevoir votre eBook.')
  if(!phone.trim())return setMessage('Veuillez saisir le numéro associé à votre compte Mobile Money.')
  setBusy(true);setMessage('');setResult(null)
  try{
   const response=await fetch('/api/guest-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product_id:productId,provider:method,email:email.trim(),phone:phone.trim(),full_name:fullName.trim()})})
   const data=await response.json()
   if(!response.ok)throw new Error(data.error||'Impossible de préparer le paiement.')
   setResult(data)
   if(data.checkout_url)window.location.assign(data.checkout_url)
   else setMessage(data.message||'Demande envoyée. Consultez votre téléphone pour la suite du paiement.')
  }catch(error){setMessage(error instanceof Error?error.message:'Une erreur est survenue.')}
  finally{setBusy(false)}
 }
 return <main className="container" style={{maxWidth:760,paddingTop:40,paddingBottom:80}}>
  <span className="eyebrow">ACHAT SANS COMPTE</span><h1>Finaliser votre achat</h1>
  <p>Vous pouvez acheter cet eBook sans créer de compte ni vous abonner à la plateforme.</p>
  <section className="card" style={{marginTop:24}}>
   <h2>Vos coordonnées</h2>
   <label style={{display:'grid',gap:6,marginTop:14}}>Nom et prénom
    <input value={fullName} onChange={e=>setFullName(e.target.value)} autoComplete="name" placeholder="Votre nom complet" required/>
   </label>
   <label style={{display:'grid',gap:6,marginTop:14}}>Adresse e-mail
    <input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="exemple@email.com" required/>
    <small className="muted">Votre lien de téléchargement sera envoyé à cette adresse après confirmation du paiement.</small>
   </label>
   <label style={{display:'grid',gap:6,marginTop:14}}>Téléphone Mobile Money
    <input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} autoComplete="tel" placeholder="Ex. +235 XX XX XX XX" required/>
    <small className="muted">Indiquez le numéro associé au compte Mobile Money utilisé pour payer, avec l’indicatif du pays.</small>
   </label>
  </section>
  <section className="card" style={{marginTop:20}}>
   <h2>Moyen de paiement</h2>
   <div style={{display:'grid',gap:12,marginTop:16}}>{methods.map(([v,l])=><label key={v} style={{display:'flex',gap:10,alignItems:'center'}}><input type="radio" name="method" checked={method===v} onChange={()=>setMethod(v)}/>{l}</label>)}</div>
   <button onClick={start} disabled={busy||!productId} style={{marginTop:20}}>{busy?'Préparation…':'Continuer vers le paiement'}</button>
   {message&&<p className="notice" role="alert" style={{marginTop:14}}>{message}</p>}
  </section>
  {result&&<section className="card" style={{marginTop:20}}><h2>Commande préparée</h2><p>Référence : <strong>{result.order_number}</strong></p><p>Montant : <strong>{Number(result.amount).toLocaleString('fr-FR')} {result.currency}</strong></p><p>Un e-mail contenant votre lien de téléchargement sera envoyé après confirmation du paiement.</p></section>}
  <p style={{marginTop:24}}><Link href="/boutique">← Retour à la boutique</Link></p>
 </main>
}
export default function PaiementPage(){return <Suspense fallback={<main className="container"><h1>Paiement sécurisé</h1><p className="muted">Chargement…</p></main>}><PaymentContent/></Suspense>}
