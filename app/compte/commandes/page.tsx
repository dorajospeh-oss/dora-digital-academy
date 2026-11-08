'use client'
import {useEffect,useState} from 'react';import {supabase} from '../../../lib/supabase'
export default function Orders(){const [d,setD]=useState<any[]>([]);useEffect(()=>{supabase().rpc('get_my_orders').then(({data})=>setD(data||[]))},[]);return <><h1>Mes commandes</h1><div className="grid">{d.map(x=><div className="card" key={x.id}><h2>{x.order_number}</h2><p>{Number(x.total_amount).toLocaleString('fr-FR')} {x.currency}</p><p>Statut : {x.status}</p></div>)}{!d.length&&<div className="notice">Aucune commande.</div>}</div></>}
