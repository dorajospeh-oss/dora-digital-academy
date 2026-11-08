'use client'
import {useEffect,useState} from 'react';import {supabase} from '../../../lib/supabase'
export default function Favorites(){const [d,setD]=useState<any[]>([]);useEffect(()=>{supabase().from('favorites').select('id,product:products(title,slug),course:courses(title,slug)').then(({data})=>setD(data||[]))},[]);return <><h1>Mes favoris</h1><div className="grid">{d.map(x=><div className="card" key={x.id}><h2>{x.product?.title||x.course?.title}</h2></div>)}{!d.length&&<div className="notice">Aucun favori.</div>}</div></>}
