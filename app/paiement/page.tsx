'use client'
import {Suspense,useEffect,useState} from 'react'
import {useSearchParams} from 'next/navigation'
import Link from 'next/link'
import {supabase} from '../../lib/supabase'
const methods=[['orange_money','Orange Money'],['airtel_money','Airtel Money'],['moov_money','Moov Money'],['visa','Visa'],['mastercard','Mastercard']] as const
function PaymentContent(){
 const params=useSearchParams()
 const orderId=params.get('order')
 const [method,setMethod]=useState('orange_money')
 const [payment,setPayment]=useState<any>(null)
 const [status,setStatus]=useState<any>(null)
 const [busy,setBusy]=useState(false)
 const [loading,setLoading]=useState(true)
 const [message,setMessage]=useState('')
 const [fullName,setFullName]=useState('')
 const [email,setEmail]=useState('')
 const [phone,setPhone]=useState('')
 async function refresh(){
  if(!orderId)return
  const {data,error}=await supabase().rpc('get_my_order_status',{p_order_id:orderId})
  if(error)setMessage(error.message);else setStatus(data)
 }
 useEffect(()=>{
  let active=true
  async function load(){
   const client=supabase()
   const {data:{user}}=await client.auth.getUser()
   if(!active)return
   if(user){
    setEmail(user.email||'')
    const {data:profile}=await client.from('profiles').select('full_name,phone').eq('id',user.id).maybeSingle()
    if(active){setFullName(profile?.full_name||String(user.user_metadata?.full_name||''));setPhone(profile?.phone||'')}
   }
   if(orderId)await refresh()
   if(active)setLoading(false)
  }
  load()
  return()=>{active=false}
 },[orderId])
 useEffect(()=>{if(!orderId)return;const t=setInterval(refresh,10000);return()=>clearInterval(t)},[orderId])
 async function start(){
  if(!orderId)return setMessage('Commande introuvable.')
  if(!fullName.trim())return setMessage('Veuillez renseigner votre nom complet.')
  if(!email.trim()||!/^\S+@\S+\.\S+$/.test(email))return setMessage('Veuillez vérifier votre adresse e-mail.')
  if(!phone.trim()||phone.trim().replace(/[\s()+-]/g,'').length<8)return setMessage('Veuillez saisir un numéro de téléphone valide.')
  setBusy(true);setMessage('')
  const client=supabase()
  const {data:{user}}=await client.auth.getUser()
  if(!user){setMessage('Votre session a expiré. Reconnectez-vous.');setBusy(false);return}
  const {error:profileError}=await client.from('profiles').update({full_name:fullName.trim(),phone:phone.trim()}).eq('id',user.id)
  if(profileError){setMessage('Impossible d’enregistrer vos coordonnées : '+profileError.message);setBusy(false);return}
  const {data,error}=await client.rpc('start_payment',{p_order_id:orderId,p_provider:method,p_payment_method:method})
  if(error)setMessage(error.message);else setPayment(data)
  setBusy(false);await refresh()
 }
 return <main className="container" style={{maxWidth:760,paddingTop:40,paddingBottom:80}}>
  <span className="eyebrow">COMMANDE</span><h1>Paiement sécurisé</h1>
  <p>Référence : <strong>{status?.order?.order_number||orderId||'—'}</strong></p>
  <section className="card" style={{marginTop:24}}>
   <h2>Informations du client</h2>
   {loading?<p className="muted">Chargement de vos coordonnées…</p>:<>
    <label style={{display:'grid',gap:6,marginTop:14}}>Nom et prénom
     <input value={fullName} onChange={e=>setFullName(e.target.value)} autoComplete="name" placeholder="Votre nom complet" required/>
    </label>
    <label style={{display:'grid',gap:6,marginTop:14}}>Adresse e-mail
     <input type="email" value={email} readOnly autoComplete="email" aria-readonly="true"/>
     <small className="muted">Adresse liée à votre compte DORA DIGITAL ACADEMY.</small>
    </label>
    <label style={{display:'grid',gap:6,marginTop:14}}>Numéro de téléphone
     <input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} autoComplete="tel" placeholder="Ex. +235 XX XX XX XX" required/>
     <small className="muted">Pour Mobile Money, indiquez le numéro associé à votre compte de paiement.</small>
    </label>
   </>}
  </section>
  <section className="card" style={{marginTop:20}}>
   <h2>Récapitulatif de la commande</h2>
   <p>Référence : <strong>{status?.order?.order_number||orderId||'—'}</strong></p>
   <p>Montant total : <strong>{status?.order?.total_amount!=null?Number(status.order.total_amount).toLocaleString('fr-FR')+' '+(status.order.currency||'XAF'):'—'}</strong></p>
  </section>
  <section className="card" style={{marginTop:20}}>
   <h2>Moyen de paiement</h2>
   <div style={{display:'grid',gap:12,marginTop:16}}>{methods.map(([v,l])=><label key={v} style={{display:'flex',gap:10,alignItems:'center'}}><input type="radio" name="method" checked={method===v} onChange={()=>setMethod(v)}/>{l}</label>)}</div>
   <button onClick={start} disabled={busy||loading||!orderId} style={{marginTop:20}}>{busy?'Préparation…':'Continuer vers le paiement'}</button>
   {message&&<p className="notice" style={{marginTop:14}}>{message}</p>}
  </section>
  {payment&&<section className="card" style={{marginTop:20}}><h2>Référence de paiement</h2><p><strong>{payment.transaction_reference}</strong></p><p>La transaction reste en attente jusqu’à confirmation du prestataire de paiement.</p></section>}
  {status?.order&&<section className="card" style={{marginTop:20}}><h2>État</h2><p>Commande : <strong>{status.order.status}</strong></p><p>Paiement : <strong>{status.payment?.status||payment?.status||'—'}</strong></p>{status.order.status==='paid'?<><p>✓ Paiement confirmé. Vos accès sont disponibles.</p><Link className="btn" href="/compte">Accéder à mon espace</Link></>:<p>En attente de confirmation du prestataire de paiement.</p>}</section>}
 </main>
}
export default function PaiementPage(){return <Suspense fallback={<main className="container"><h1>Paiement sécurisé</h1><p className="muted">Chargement…</p></main>}><PaymentContent/></Suspense>}
