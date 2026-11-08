'use client'
import {useEffect,useMemo,useState} from 'react'
import Link from 'next/link'
import {supabase} from '../../../lib/supabase'

type Notification={id:string;type:string;title:string;message:string;data:any;read_at:string|null;created_at:string}

const icon=(type:string)=>({payment_confirmed:'💳',product_access:'📦',certificate_issued:'🏆',download:'📥'} as Record<string,string>)[type]||'🔔'
const label=(type:string)=>({payment_confirmed:'Paiement',product_access:'Produit',certificate_issued:'Certificat',download:'Téléchargement'} as Record<string,string>)[type]||'Information'

export default function Notifications(){
 const [items,setItems]=useState<Notification[]>([]);const [loading,setLoading]=useState(true);const [msg,setMsg]=useState('');const [filter,setFilter]=useState('all')
 const load=async()=>{setLoading(true);const {data,error}=await supabase().rpc('get_my_notifications',{p_limit:100});if(error)setMsg(error.message);else setItems((data||[]) as Notification[]);setLoading(false)}
 useEffect(()=>{load()},[])
 const unread=useMemo(()=>items.filter(n=>!n.read_at).length,[items])
 const visible=useMemo(()=>filter==='unread'?items.filter(n=>!n.read_at):filter==='read'?items.filter(n=>n.read_at):items,[items,filter])
 const mark=async(id:string)=>{const {error}=await supabase().from('notifications').update({read_at:new Date().toISOString()}).eq('id',id);if(error)setMsg(error.message);else setItems(x=>x.map(n=>n.id===id?{...n,read_at:new Date().toISOString()}:n))}
 const markAll=async()=>{const {data:{user}}=await supabase().auth.getUser();if(!user)return;const {error}=await supabase().from('notifications').update({read_at:new Date().toISOString()}).eq('user_id',user.id).is('read_at',null);if(error)setMsg(error.message);else setItems(x=>x.map(n=>({...n,read_at:n.read_at||new Date().toISOString()})))}
 const target=(n:Notification)=>{if(n.type==='certificate_issued'&&n.data?.certificate_number)return `/certificat/${encodeURIComponent(n.data.certificate_number)}`;if(n.type==='product_access')return '/compte/bibliotheque';if(n.type==='payment_confirmed')return '/compte/commandes';return null}
 return <>
  <div className="account-head"><div><p className="eyebrow">DORA DIGITAL ACADEMY</p><h1>🔔 Notifications</h1><p className="muted">Retrouvez ici les informations importantes concernant votre compte.</p></div><Link className="small-btn" href="/compte">← Mon compte</Link></div>
  <div className="notification-toolbar"><div className="notification-filters"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>Toutes ({items.length})</button><button className={filter==='unread'?'active':''} onClick={()=>setFilter('unread')}>Non lues ({unread})</button><button className={filter==='read'?'active':''} onClick={()=>setFilter('read')}>Lues</button></div>{unread>0&&<button className="btn" onClick={markAll}>Tout marquer comme lu</button>}</div>
  {msg&&<div className="notice">{msg}</div>}
  {loading?<div className="card"><p>Chargement de vos notifications…</p></div>:visible.length===0?<div className="empty card"><div className="empty-icon">🔔</div><h2>Aucune notification</h2><p className="muted">Vous êtes à jour. Les nouvelles informations apparaîtront ici.</p></div>:<div className="notifications-list">{visible.map(n=>{const href=target(n);return <article key={n.id} className={`notification-card ${n.read_at?'read':'unread'}`}><div className="notification-icon">{icon(n.type)}</div><div className="notification-content"><div className="notification-top"><span className="notification-type">{label(n.type)}</span><time>{new Date(n.created_at).toLocaleString('fr-FR')}</time></div><h2>{n.title}</h2><p>{n.message}</p><div className="notification-actions">{href&&<Link className="small-btn" href={href}>Ouvrir</Link>}{!n.read_at&&<button className="small-btn" onClick={()=>mark(n.id)}>Marquer comme lue</button>}</div></div>{!n.read_at&&<span className="unread-dot" aria-label="Non lue"/>}</article>})}</div>}
 </>
}
