'use client'
import {Suspense,useEffect,useRef,useState} from 'react'
import {useSearchParams} from 'next/navigation'
import Link from 'next/link'
import {supabase} from '../../lib/supabase'

const guestMethods=[['orange','Orange Money'],['airtel','Airtel Money'],['moov','Moov Money']] as const
const accountMethods=[['orange_money','Orange Money'],['airtel_money','Airtel Money'],['moov_money','Moov Money']] as const

function PaymentContent(){
 const params=useSearchParams()
 const productId=params.get('product')
 const orderId=params.get('order')
 const isGuestCheckout=Boolean(productId)&&!orderId

 const [method,setMethod]=useState<'orange'|'airtel'|'moov'>('orange')
 const [email,setEmail]=useState('')
 const [phone,setPhone]=useState('')
 const [busy,setBusy]=useState(false)
 const [message,setMessage]=useState('')
 const [result,setResult]=useState<any>(null)

 const [accountMethod,setAccountMethod]=useState('orange_money')
 const [accountPhone,setAccountPhone]=useState('')
 const [payment,setPayment]=useState<any>(null)
 const [status,setStatus]=useState<any>(null)
 const refreshInFlight=useRef(false)

 async function refreshOrder(){
  if(!orderId||refreshInFlight.current)return
  refreshInFlight.current=true
  try{
   const client=supabase()
   let {data,error}=await client.rpc('get_my_order_status',{p_order_id:orderId})
   if(error){setMessage(error.message);return}
   const paymentStatus=data?.payment?.status
   const hasGatewayTransaction=Boolean(data?.payment?.provider_response?.transaction_id)
   if(data?.order?.status!=='paid'&&paymentStatus!=='confirmed'&&hasGatewayTransaction){
    const {data:{session}}=await client.auth.getSession()
    if(session?.access_token){
     await fetch('/api/account-payment-status',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
      body:JSON.stringify({order_id:orderId}),
      cache:'no-store'
     })
     const refreshed=await client.rpc('get_my_order_status',{p_order_id:orderId})
     if(!refreshed.error)data=refreshed.data
    }
   }
   setStatus(data)
  }finally{
   refreshInFlight.current=false
  }
 }

 useEffect(()=>{
  if(!orderId)return
  void refreshOrder()
  const timer=setInterval(()=>void refreshOrder(),60000)
  return ()=>clearInterval(timer)
 },[orderId])

 async function startGuest(){
  if(!productId)return setMessage('Produit introuvable. Retournez à la boutique.')
  const cleanEmail=email.trim()
  const atPosition=cleanEmail.indexOf('@')
  const lastDot=cleanEmail.lastIndexOf('.')
  if(!cleanEmail||cleanEmail.includes(' ')||atPosition<=0||lastDot<=atPosition+1||lastDot===cleanEmail.length-1)return setMessage('Veuillez saisir une adresse e-mail valide pour recevoir votre eBook.')
  if(!phone.trim())return setMessage('Veuillez saisir le numéro associé à votre compte Mobile Money.')
  setBusy(true);setMessage('');setResult(null)
  try{
   const {data:{session}}=await supabase().auth.getSession()
   const requestHeaders:Record<string,string>={'Content-Type':'application/json'}
   if(session?.access_token)requestHeaders.Authorization='Bearer '+session.access_token
   const response=await fetch('/api/guest-checkout',{method:'POST',headers:requestHeaders,body:JSON.stringify({product_id:productId,provider:method,email:email.trim(),phone:phone.trim()})})
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
  const normalizedPhone=accountPhone.trim().replace(/[\s().-]/g,'')
  if(!/^\+[1-9][0-9]{7,14}$/.test(normalizedPhone))return setMessage('Saisissez un numéro Mobile Money au format international, par exemple +23562123456.')
  setBusy(true);setMessage('');setPayment(null)
  try{
   const {data:{session}}=await supabase().auth.getSession()
   if(!session?.access_token)throw new Error('Votre session a expiré. Reconnectez-vous avec le compte ayant passé cette commande.')
   const response=await fetch('/api/account-payment',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
    body:JSON.stringify({order_id:orderId,provider:accountMethod,phone:normalizedPhone})
   })
   const data=await response.json()
   if(!response.ok)throw new Error(data.error||'Impossible de lancer le paiement.')
   setPayment(data)
   await refreshOrder()
   setMessage(data.message||'Demande de paiement envoyée. Confirmez-la sur votre téléphone.')
   if(data.checkout_url)window.location.assign(data.checkout_url)
  }catch(error){
   setMessage(error instanceof Error?error.message:'Une erreur est survenue pendant le paiement.')
  }finally{setBusy(false)}
 }

 if(isGuestCheckout){
  return <main className="container" style={{maxWidth:760,paddingTop:40,paddingBottom:80}}>
   <span className="eyebrow">ACHAT SANS COMPTE</span><h1>Finaliser votre achat</h1>
   <p>Vous pouvez acheter cet eBook sans créer de compte ni vous abonner à la plateforme.</p>
   <section className="card" style={{marginTop:24}}>
    <h2>Vos coordonnées</h2>
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
    <label style={{display:'grid',gap:6,marginTop:16}}>Téléphone Mobile Money
     <input type="tel" value={accountPhone} onChange={e=>setAccountPhone(e.target.value)} autoComplete="tel" placeholder="+23562123456" required/>
     <small className="muted">Utilisez le numéro du compte Mobile Money qui recevra la demande de confirmation.</small>
    </label>
    <div style={{display:'grid',gap:12,marginTop:16}}>{accountMethods.map(([v,l])=><label key={v} style={{display:'flex',gap:10,alignItems:'center'}}><input type="radio" name="account-method" checked={accountMethod===v} onChange={()=>setAccountMethod(v)}/>{l}</label>)}</div>
    <button onClick={startAccountPayment} disabled={busy||!orderId} style={{marginTop:20}}>{busy?'Envoi…':'Lancer le paiement sécurisé'}</button>
    {message&&<p className="notice" role="alert" style={{marginTop:14}}>{message}</p>}
   </section>
   {payment&&<section className="card" style={{marginTop:20}}><h2>Demande de paiement transmise</h2><p>Commande : <strong>{payment.order_number||status?.order?.order_number||orderId}</strong></p><p>Référence : <strong>{payment.transaction_reference}</strong></p><p>Transaction PayCentral : <strong>{payment.transaction_id||'En cours de confirmation'}</strong></p><p>Statut : <strong>{payment.status||'processing'}</strong></p><p className="muted">Confirmez la demande sur votre téléphone. La confirmation sera vérifiée automatiquement.</p></section>}
   {status?.order&&<section className="card" style={{marginTop:20}}><h2>État de la commande</h2><p>Commande : <strong>{status.order.status}</strong></p><p>Paiement : <strong>{status.payment?.status||'—'}</strong></p>{status.order.status==='paid'?<><p>✓ Paiement confirmé. Vos accès sont disponibles.</p><Link className="btn" href="/compte">Accéder à mon espace</Link></>:status.payment?.status==='failed'?<p>Le prestataire a signalé un échec. La confirmation reste contrôlée automatiquement pendant la période de sécurité avant toute nouvelle tentative.</p>:status.order.status==='cancelled'?<p>La demande a été annulée. L’état du paiement est revérifié pour détecter une éventuelle confirmation tardive.</p>:<p>En attente de confirmation du prestataire. Vérification automatique en cours.</p>}</section>}
   <p style={{marginTop:24}}><Link href="/compte">← Retour à mon compte</Link></p>
  </main>
 }

 return <main className="container" style={{maxWidth:760,paddingTop:40,paddingBottom:80}}><h1>Paiement</h1><p className="notice">Aucun produit ou numéro de commande n’a été fourni.</p><Link href="/boutique">Retour à la boutique</Link></main>
}

export default function PaiementPage(){return <Suspense fallback={<main className="container"><h1>Paiement sécurisé</h1><p className="muted">Chargement…</p></main>}><PaymentContent/></Suspense>}
