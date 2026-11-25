'use client'
import {useEffect,useState} from 'react'
import {useParams} from 'next/navigation'
import {supabase} from '../../../lib/supabase'
import Link from 'next/link'
import PartagerProduit from '../PartagerProduit'

export default function Product(){
 const params=useParams<{slug:string}>()
 const [p,setP]=useState<any>(); const [reviews,setReviews]=useState<any[]>([]); const [related,setRelated]=useState<any[]>([]); const [msg,setMsg]=useState('');
 useEffect(()=>{(async()=>{const s=supabase();const {data}=await s.from('products').select('*').eq('slug',params.slug).eq('status','published').single();setP(data);if(data){const r=await s.rpc('get_product_reviews',{p_product_id:data.id});setReviews(r.data||[]);const q=await s.rpc('search_catalog',{p_category_slug:null,p_item_type:'product',p_sort:'popular',p_limit:4,p_offset:0});setRelated((q.data||[]).filter((x:any)=>x.id!==data.id).slice(0,3))}})()},[params.slug])
 async function buy(){if(!p)return;window.location.href=`/paiement?product=${encodeURIComponent(p.id)}`}
 if(!p)return <div className="notice">Chargement…</div>
 const price=Number(p.sale_price??p.price),old=p.sale_price?Number(p.price):null
 return <article>
  <section className="product-hero card"><div><p className="eyebrow">RESSOURCE NUMÉRIQUE</p><h1>{p.title}</h1><p>{p.short_description}</p><div className="price">{price.toLocaleString('fr-FR')} {p.currency} {old&&<del className="old-price">{old.toLocaleString('fr-FR')} {p.currency}</del>}</div><div className="inline-actions"><button className="btn" onClick={buy}>Acheter maintenant</button><Link className="small-btn" href="/panier">Voir mon panier</Link></div>{msg&&<p className="notice" role="alert">{msg}</p>}<PartagerProduit title={p.title}/></div><div className="product-cover">{p.cover_url?<img src={p.cover_url} alt={p.title}/>:<span>📘</span>}</div></section>
  <section className="card"><h2>À propos de ce produit</h2><p className="long-copy">{p.description}</p><div className="benefits"><span>✓ Accès sécurisé</span><span>✓ Téléchargement protégé</span><span>✓ Paiement vérifié</span></div></section>
  <section className="card"><h2>Avis clients</h2>{reviews.length?<div className="reviews">{reviews.map((r:any)=><div className="review" key={r.id}><strong>{'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}</strong><h3>{r.title||'Avis client'}</h3><p>{r.comment}</p><span className="muted">{r.reviewer_name||'Client'}</span></div>)}</div>:<p className="muted">Les premiers avis apparaîtront ici après validation.</p>}</section>
  {related.length>0&&<section><h2>Vous pourriez aussi aimer</h2><div className="grid">{related.map((x:any)=><article className="card" key={x.id}><span className="eyebrow">RECOMMANDÉ</span><h3>{x.title}</h3><p>{x.short_description}</p><div className="price">{Number(x.sale_price??x.price).toLocaleString('fr-FR')} {x.currency}</div><Link className="btn" href={`/boutique/${x.slug}`}>Découvrir</Link></article>)}</div></section>}
  <p style={{marginTop:24}}><Link href="/boutique">← Retour à la boutique</Link></p>
 </article>
}
