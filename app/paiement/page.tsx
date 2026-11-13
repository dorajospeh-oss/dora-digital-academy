'use client'
import {Suspense,useEffect,useState} from 'react'
import {useSearchParams} from 'next/navigation'
import Link from 'next/link'
import {supabase} from '../../lib/supabase'

const guestMethods=[['orange','Orange Money'],['airtel','Airtel Money']] as const
const accountMethods=[['orange_money','Orange Money'],['airtel_money','Airtel Money'],['moov_money','Moov Money'],['visa','Visa'],['mastercard','Mastercard']] as const

function PaymentContent(){
 const params=useSearchParams()
 const productId=params.get('product')
 const orderId=params.get('order')
 const isGuestCheckout=Boolean(productId)&&!orderId

 const [method,setMethod]=useState<'orange'|'airtel'>('orange')
 const [fullName,setFullName]=useState('')
 const [email,setEmail]=useState('')
 const [phone,setPhone]=useState('')
 const [busy,setBusy]=useState(false)
 const [message,setMessage]=useState('')
 const [result,setResult]=useState<any>(null)

 const [accountMethod,setAccountMethod]=useState('orange_money')
 const [payment,setPayment]=useState<any>(null)
 const [status,setStatus]=useState<any>(null)

 async function refreshOrder(){
  if(!orderId)return
  const {data,error}=await supabase().rpc('get_my_order_status',{p_order_id:orderId})
  if(error)setMessage(error.message)
  else setStatus(data)
 }

 useEffect(()=>{
  if(!orderId)return
  refreshOrder()
  const timer=setInterval(refreshOrder,10000)
  return ()=>clearInterval(timer)
 },[orderId])

 async function startGuest(){
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

 async function startAccountPayment(){
  if(!orderId)return setMessage('Commande introuvable.')
  setBusy(true);setMessage('')
  try{
   const {data,error}=await supabase().rpc('start_payment',{p_order_id:orderId,p_provider:accountMethod,p_payment_method:accountMethod})
   if(error)throw error
   setPayment(data)
   await refreshOrder()
  }catch(error){
   setMessage(error instanceof Error?error.message:'Impossible de préparer le paiement.')
  }finally{setBusy(false)}
 }

 if(isGuestCheckout){
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
    <div style={{display:'grid',gap:12,marginTop:16}}>{guestMethods.map(([v,l])=><label key={v} style={{display:'flex',gap:10,alignItems:'center'}}><input type="radio" name="guest-method" checked={method===v} onChange={()=>setMethod(v)}/>{l}</label>)}</div>
    <button onClick={startGuest} disabled={busy||!productId} style={{marginTop:20}}>{busy?'Préparation…':'Continuer vers le paiement'}</button>
    {message&&<p className="notice" role="alert" style={{marginTop:14}}>{message}</p>}
   </section>
   {result&&<section className="card" style={{marginTop:20}}><h2>Commande préparée</h2><p>Référence : <strong>{result.order_number}</strong></p><p>Montant : <strong>{Number(result.amount).toLocaleString('fr-FR')} {result.currency}</strong></p><p>Un e-mail contenant votre lien de téléchargement sera envoyé après confirmation du paiement.</p></section>}
   <p style={{marginTop:24}}><Link href="/boutique">← Retour à la boutique</Link></p>
  </main>
 }

 if(orderId){
  return <main className="container" style={{maxWidth:760,paddingTop:40,paddingBottom:80}}>
   <span className="eyebrow">COMMANDE CLIENT</span><h1>Paiement sécurisé</h1>
   <p>Référence : <strong>{status?.order?.order_number||orderId}</strong></p>
   <section className="card" style={{marginTop:24}}>
    <h2>Moyen de paiement</h2>
    <p className="muted">Ce parcours concerne une commande déjà créée dans votre compte. Connectez-vous avec le compte ayant passé la commande pour consulter son état et payer.</p>
    <div style={{display:'grid',gap:12,marginTop:16}}>{accountMethods.map(([v,l])=><label key={v} style={{display:'flex',gap:10,alignItems:'center'}}><input type="radio" name="account-method" checked={accountMethod===v} onChange={()=>setAccountMethod(v)}/>{l}</label>)}</div>
    <button onClick={startAccountPayment} disabled={busy||!orderId} style={{marginTop:20}}>{busy?'Préparation…':'Préparer le paiement'}</button>
    {message&&<p className="notice" role="alert" style={{marginTop:14}}>{message}</p>}
   </section>
   {payment&&<section className="card" style={{marginTop:20}}><h2>Référence de paiement</h2><p><strong>{payment.transaction_reference}</strong></p><p>La confirmation du paiement est effectuée côté serveur.</p></section>}
   {status?.order&&<section className="card" style={{marginTop:20}}><h2>État de la commande</h2><p>Commande : <strong>{status.order.status}</strong></p><p>Paiement : <strong>{status.payment?.status||'—'}</strong></p>{status.order.status==='paid'?<><p>✓ Paiement confirmé. Vos accès sont disponibles.</p><Link className="btn" href="/compte">Accéder à mon espace</Link></>:<p>En attente de confirmation du prestataire de paiement.</p>}</section>}
   <p style={{marginTop:24}}><Link href="/compte">← Retour à mon compte</Link></p>
  </main>
 }

 return <main className="container" style={{maxWidth:760,paddingTop:40,paddingBottom:80}}><h1>Paiement</h1><p className="notice">Aucun produit ou numéro de commande n’a été fourni.</p><Link href="/boutique">Retour à la boutique</Link></main>
}

export default function PaiementPage(){return <Suspense fallback={<main className="container"><h1>Paiement sécurisé</h1><p className="muted">Chargement…</p></main>}><PaymentContent/></Suspense>}
