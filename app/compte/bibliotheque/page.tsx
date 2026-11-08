'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import {supabase} from '../../../lib/supabase'

type Item={access_id:string;product_id:string;title:string;slug:string;cover_url?:string|null;currency:string;granted_at:string;expires_at?:string|null;download_limit:number;download_count:number}

export default function Library(){
 const [items,setItems]=useState<Item[]>([]); const [busy,setBusy]=useState<string|null>(null); const [msg,setMsg]=useState(''); const [loading,setLoading]=useState(true)
 async function load(){setLoading(true);setMsg('');const {data,error}=await supabase().rpc('get_my_library');if(error)setMsg(error.message);else setItems((data||[]) as Item[]);setLoading(false)}
 useEffect(()=>{load()},[])
 async function download(id:string){setBusy(id);setMsg('');try{const {data,error}=await supabase().functions.invoke('secure-download',{body:{product_id:id}});if(error)throw error;if(!data?.url)throw new Error(data?.error||'Téléchargement indisponible');window.location.assign(data.url);setTimeout(load,800)}catch(e:any){setMsg(e.message||'Erreur de téléchargement')}finally{setBusy(null)}}
 function remaining(x:Item){return x.download_limit<0?'Illimité':Math.max(0,x.download_limit-x.download_count)}
 return <main className="container" style={{maxWidth:1000,paddingTop:40,paddingBottom:80}}>
  <div className="account-head"><div><span className="eyebrow">ESPACE CLIENT</span><h1>Ma bibliothèque</h1><p>Retrouvez vos produits achetés et téléchargez-les de façon sécurisée.</p></div><Link className="btn" href="/boutique">Découvrir la boutique</Link></div>
  {msg&&<div className="notice" style={{marginTop:18}}>{msg}</div>}
  {loading?<div className="notice" style={{marginTop:18}}>Chargement de votre bibliothèque…</div>:!items.length&&!msg?<div className="notice" style={{marginTop:18}}>Votre bibliothèque est encore vide.<br/><Link href="/boutique">Découvrir les produits numériques →</Link></div>:<div className="grid" style={{marginTop:24}}>{items.map(x=><article className="card" key={x.access_id}>
   <span className="eyebrow">PRODUIT NUMÉRIQUE</span><h2>{x.title}</h2>
   <p>Accès accordé le {new Date(x.granted_at).toLocaleDateString('fr-FR')}.</p>
   <p>{x.expires_at?`Accès jusqu’au ${new Date(x.expires_at).toLocaleDateString('fr-FR')}.`:'Accès permanent.'}</p>
   <p><strong>Téléchargements restants : {remaining(x)}</strong>{x.download_limit>=0&&<span> sur {x.download_limit}</span>}</p>
   <button className="button primary" disabled={busy===x.product_id||(typeof remaining(x)==='number'&&remaining(x)===0)} onClick={()=>download(x.product_id)}>{busy===x.product_id?'Préparation sécurisée…':'Télécharger le produit'}</button>
  </article>)}</div>}
 </main>
}
