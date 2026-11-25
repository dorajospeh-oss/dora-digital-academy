import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MONERAILS_KEY = Deno.env.get("MONERAILS_API_KEY") ?? "";
const SITE_HOST = "dora-digital-academy-1mvr.vercel.app";

function reply(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: {
    "content-type":"application/json", "cache-control":"no-store",
    "access-control-allow-origin":origin || "https://" + SITE_HOST,
    "access-control-allow-headers":"authorization, apikey, content-type",
    "access-control-allow-methods":"POST, OPTIONS", "vary":"Origin"
  }});
}
function allowed(origin:string) {
  if(!origin) return true;
  try { const h=new URL(origin).hostname; return h===SITE_HOST || h==="localhost" || (h.startsWith("dora-digital-academy-1mvr-")&&h.endsWith("-dorajospeh-oss.vercel.app")); } catch { return false; }
}
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};

Deno.serve(async req=>{
 const origin=req.headers.get("origin")||"";
 if(!allowed(origin)) return reply({error:"Origine non autorisée."},403,origin);
 if(req.method==="OPTIONS") return reply({ok:true},200,origin);
 if(req.method!=="POST") return reply({error:"Méthode non autorisée."},405,origin);
 if(!URL||!SERVICE_KEY||!MONERAILS_KEY) return reply({error:"Configuration Monerails incomplète."},503,origin);
 if(MONERAILS_KEY.startsWith("mr_live_")&&Deno.env.get("MONERAILS_ALLOW_LIVE")!=="true") return reply({error:"Les validations de paiement réelles sont verrouillées."},503,origin);
 let input:Record<string,unknown>;
 try{input=await req.json()}catch{return reply({error:"JSON invalide."},400,origin)}
 const orderNo=String(input.order_number||"").trim().toUpperCase();
 const email=String(input.email||"").trim().toLowerCase();
 const code=String(input.code||"").trim();
 if(!/^DDA-[A-F0-9]{16}$/.test(orderNo)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({error:"Référence ou e-mail invalide."},400,origin);
 if(!/^\d{4,8}$/.test(code)) return reply({error:"Le code doit contenir de 4 à 8 chiffres."},400,origin);
 const admin=createClient(URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:order}=await admin.from("orders").select("id,order_number,status").eq("order_number",orderNo).eq("buyer_email",email).maybeSingle();
 if(!order) return reply({error:"Commande introuvable."},404,origin);
 const {data:payment}=await admin.from("payments").select("id,provider,status,provider_response").eq("order_id",order.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(!payment||payment.provider!=="monerails") return reply({error:"Paiement Monerails introuvable."},404,origin);
 if(payment.status==="confirmed"||order.status==="paid") return reply({ok:true,status:"succeeded"},200,origin);
 if(payment.status!=="pending") return reply({error:"Cette tentative n'est plus en attente."},409,origin);
 const stored=obj(payment.provider_response);
 const id=String(stored.gateway_reference||"");
 if(!id) return reply({error:"La référence de paiement n'est pas encore disponible."},409,origin);
 if(String(stored.status||"").toLowerCase()!=="requires_otp"&&stored.requires_otp!==true) return reply({error:"Cette opération ne demande pas de code SMS."},409,origin);
 const attempts=Number(stored.otp_attempts||0);
 if(attempts>=3) return reply({error:"Trois essais de code ont été utilisés. Contactez le support."},429,origin);
 let res:Response; let body:Record<string,unknown>;
 try {
   res=await fetch("https://api.monerails.com/v1/collections/"+encodeURIComponent(id)+"/authorize",{method:"POST",headers:{"Authorization":"Bearer "+MONERAILS_KEY,"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({otp:code}),signal:AbortSignal.timeout(15000)});
   body=await res.json().catch(()=>({})) as Record<string,unknown>;
 } catch { return reply({error:"Monerails est momentanément indisponible. Réessayez sans relancer un nouvel achat."},502,origin); }
 if(!res.ok) {
   const errorCode=String(obj(body.error).code||"");
   const invalidCode=response.status===400||response.status===402||errorCode==="otp_invalid";
   if(invalidCode) {
     await admin.from("payments").update({provider_response:{...stored,otp_attempts:attempts+1,last_otp_error:errorCode||"otp_invalid"}}).eq("id",payment.id);
   }
   return reply({error:String(obj(body.error).message||body.message||"La validation Monerails a échoué.").slice(0,200),attempts_remaining:invalidCode?Math.max(0,2-attempts):3},invalidCode?422:(response.status>=500?502:409),origin);
 }
 const data=obj(body.data||body), next=obj(data.next_action), status=String(data.status||"processing").toLowerCase();
 await admin.from("payments").update({provider_response:{...stored,status,next_action:next,requires_otp:status==="requires_otp",otp_attempts:attempts+1}}).eq("id",payment.id).eq("status","pending");
 return reply({ok:true,status,next_action:next,message:String(next.message||"Code accepté. Attendez la confirmation de l'opérateur.")},200,origin);
});
