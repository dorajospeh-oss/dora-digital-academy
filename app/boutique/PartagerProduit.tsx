'use client'
import {useState} from 'react'

export default function PartagerProduit({title}:{title:string}){
 const [msg,setMsg]=useState('')
 const share=async()=>{
  const url=window.location.href
  try{
   if(navigator.share){await navigator.share({title, text:`Découvrez ${title} sur DORA DIGITAL ACADEMY`,url});setMsg('Partage lancé.')} 
   else {await navigator.clipboard.writeText(url);setMsg('Lien copié.')} 
  }catch{setMsg('Partage annulé.')}
 }
 return <div className="share-box"><button className="small-btn" onClick={share}>↗ Partager</button><a className="small-btn" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Découvrez ${title} sur DORA DIGITAL ACADEMY : ${typeof window!=='undefined'?window.location.href:''}`)}`}>WhatsApp</a>{msg&&<span className="muted">{msg}</span>}</div>
}
