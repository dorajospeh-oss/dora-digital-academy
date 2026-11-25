import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const NKAP_API_KEY = Deno.env.get("NKAP_API_KEY") ?? "";
const NKAP_API_SECRET = Deno.env.get("NKAP_API_SECRET") ?? "";
const MONERAILS_API_KEY = Deno.env.get("MONERAILS_API_KEY") ?? "";
const GUEST_TOKEN_ENCRYPTION_KEY = Deno.env.get("GUEST_TOKEN_ENCRYPTION_KEY") ?? "";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") ?? "";
const SITE_URL = "https://dora-digital-academy-1mvr.vercel.app";
const ALLOWED_HOST = "dora-digital-academy-1mvr.vercel.app";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function json(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin || "https://" + ALLOWED_HOST,
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      "vary": "Origin"
    }
  });
}

function allowedOrigin(origin: string) {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === ALLOWED_HOST
      || (host.startsWith("dora-digital-academy-1mvr-") && host.endsWith("-dorajospeh-oss.vercel.app"))
      || host === "localhost";
  } catch { return false; }
}

async function guestDownloadUrl(admin: any, orderId: string, orderNumber: string) {
  if (!GUEST_TOKEN_ENCRYPTION_KEY) return null;
  const { data: tokenRow, error } = await admin
    .from("guest_order_tokens")
    .select("encrypted_token,encryption_iv,expires_at,revoked_at,download_count,max_downloads")
    .eq("order_id", orderId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !tokenRow || tokenRow.revoked_at) return null;
  if (tokenRow.expires_at && Date.parse(String(tokenRow.expires_at)) <= Date.now()) return null;
  if (Number(tokenRow.max_downloads) !== -1 && Number(tokenRow.download_count) >= Number(tokenRow.max_downloads)) return null;
  try {
    const rawKey = Uint8Array.from(atob(GUEST_TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
    const bytes = (s: unknown) => Uint8Array.from(atob(String(s)), c => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(tokenRow.encryption_iv) }, key, bytes(tokenRow.encrypted_token));
    const token = new TextDecoder().decode(plain);
    return SITE_URL + "/?download=guest&order=" + encodeURIComponent(orderNumber) + "&token=" + encodeURIComponent(token);
  } catch {
    return null;
  }
}

async function deliverGuestEmail(admin: any, orderId: string) {
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL || !GUEST_TOKEN_ENCRYPTION_KEY) return false;
  const { data: claimed, error } = await admin.rpc("claim_guest_order_email", { p_order_id: orderId });
  if (error) return false;
  if (!Array.isArray(claimed) || !claimed.length) {
    const { data: token } = await admin.from("guest_order_tokens")
      .select("email_sent_at").eq("order_id", orderId).is("revoked_at", null).limit(1).maybeSingle();
    return Boolean(token?.email_sent_at);
  }
  const item = object(claimed[0]);
  try {
    const keyBytes = Uint8Array.from(atob(GUEST_TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const bytes = (s: unknown) => Uint8Array.from(atob(String(s)), c => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(item.encryption_iv) }, key, bytes(item.encrypted_token));
    const token = new TextDecoder().decode(plain);
    const url = SITE_URL + "/?download=guest&order=" + encodeURIComponent(String(item.order_number)) + "&token=" + encodeURIComponent(token);
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({
        sender: { name: "DORA DIGITAL ACADEMY", email: BREVO_SENDER_EMAIL },
        to: [{ email: String(item.buyer_email) }],
        subject: "Votre achat DORA DIGITAL ACADEMY — lien de téléchargement",
        htmlContent: "<h2>Merci pour votre achat !</h2><p>Votre paiement est confirmé.</p><p>" +
          String(item.product_title ?? "Votre produit") + "</p><p><a href='" + url + "'>Télécharger mon produit</a></p>"
      })
    });
    if (!response.ok) {
      const details = await response.text();
      await admin.rpc("release_guest_order_email_claim", { p_order_id: orderId, p_error: "Brevo HTTP " + response.status + ": " + details.slice(0, 300) });
      console.error("Alternate gateway email failed:", response.status, details.slice(0, 200));
      return false;
    }
    await admin.rpc("mark_guest_order_email_sent", { p_order_id: orderId });
    return true;
  } catch (error) {
    await admin.rpc("release_guest_order_email_claim", {
      p_order_id: orderId,
      p_error: error instanceof Error ? error.message : "Email delivery failed"
    });
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (!allowedOrigin(origin)) return json({ error: "Origine non autorisée." }, 403, origin);
  if (req.method === "OPTIONS") return json({ ok: true }, 200, origin);
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405, origin);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "Configuration Supabase incomplète." }, 503, origin);

  let body: JsonObject;
  try { body = await req.json() as JsonObject; }
  catch { return json({ error: "Requête JSON invalide." }, 400, origin); }

  const orderNumber = String(body.order_number ?? "").trim().toUpperCase();
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^DDA-[A-F0-9]{16}$/.test(orderNumber) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Référence de commande ou adresse e-mail invalide." }, 400, origin);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,order_number,user_id,buyer_email,status")
    .eq("order_number", orderNumber)
    .eq("buyer_email", email)
    .maybeSingle();
  if (orderError || !order) return json({ error: "Commande introuvable pour ces coordonnées." }, 404, origin);

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select("id,order_id,provider,payment_method,transaction_reference,amount,currency,status,provider_response,created_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentError || !payment || !["nkap", "monerails"].includes(String(payment.provider))) {
    return json({ error: "Paiement Nkap/Monerails introuvable." }, 404, origin);
  }

  const stored = object(payment.provider_response);
  if (payment.status === "confirmed" || order.status === "paid") {
    const emailSent = await deliverGuestEmail(admin, String(order.id));
    const url = await guestDownloadUrl(admin, String(order.id), String(order.order_number));
    return json({
      ok: true,
      order_number: order.order_number,
      order_status: "paid",
      payment_status: "confirmed",
      email_sent: emailSent,
      download_url: url,
      message: url ? "Paiement confirmé. Votre téléchargement est prêt." : "Paiement confirmé."
    }, 200, origin);
  }

  const gatewayReference = String(stored.gateway_reference ?? "").trim();
  if (!gatewayReference) {
    return json({
      ok: true,
      order_number: order.order_number,
      order_status: order.status,
      payment_status: payment.status,
      gateway_status: "pending",
      message: "La demande de paiement est en cours de transmission."
    }, 200, origin);
  }

  const lastCheck = Date.parse(String(stored.status_checked_at ?? ""));
  if (Number.isFinite(lastCheck) && Date.now() - lastCheck < 5000) {
    return json({
      ok: true, order_number: order.order_number, order_status: order.status,
      payment_status: payment.status, throttled: true, message: "Vérification déjà effectuée. Réessayez dans quelques secondes."
    }, 200, origin);
  }

  let response: Response;
  let raw: JsonObject;
  try {
    if (payment.provider === "nkap") {
      if (!NKAP_API_KEY || !NKAP_API_SECRET) return json({ error: "Identifiants Nkap manquants dans Supabase." }, 503, origin);
      response = await fetch("https://pay.ltcgroup.site/api/v1/payments/" + encodeURIComponent(gatewayReference), {
        headers: { "X-API-Key": NKAP_API_KEY, "X-API-Secret": NKAP_API_SECRET, "Accept": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15000)
      });
    } else {
      if (!MONERAILS_API_KEY) return json({ error: "Clé Monerails manquante dans Supabase." }, 503, origin);
      response = await fetch("https://api.monerails.com/v1/collections/" + encodeURIComponent(gatewayReference), {
        headers: { "Authorization": "Bearer " + MONERAILS_API_KEY, "Accept": "application/json", "Accept-Language": "fr" },
        cache: "no-store",
        signal: AbortSignal.timeout(15000)
      });
    }
    raw = await response.json().catch(() => ({})) as JsonObject;
  } catch (error) {
    console.error("Alternate gateway status request failed:", error instanceof Error ? error.message : "network");
    return json({ error: "La passerelle est momentanément indisponible. La commande reste en attente.", retryable: true }, 502, origin);
  }

  if (!response.ok) {
    return json({
      error: String(object(raw.error).message ?? raw.detail ?? raw.message ?? "Impossible de vérifier le paiement."),
      retryable: response.status === 429 || response.status >= 500
    }, response.status === 429 || response.status >= 500 ? 502 : 409, origin);
  }

  const data = object(raw.data ?? raw);
  let gatewayStatus = "";
  let gatewayAmount = Number(data.amount);
  let gatewayCurrency = String(data.currency ?? "").toUpperCase();
  let returnedMerchantReference = "";
  let eventId = "";
  let providerReference = gatewayReference;

  if (payment.provider === "nkap") {
    gatewayStatus = String(data.status ?? "").toUpperCase();
    returnedMerchantReference = String(data.merchant_reference ?? "").trim();
    if (String(data.reference ?? "") !== gatewayReference) {
      return json({ error: "Référence Nkap incohérente." }, 409, origin);
    }
    eventId = "nkap-poll:" + gatewayReference + ":" + gatewayStatus + ":" + String(data.updated_at ?? "");
    providerReference = String(data.provider_transaction_id ?? gatewayReference);
  } else {
    gatewayStatus = String(data.status ?? "").toLowerCase();
    returnedMerchantReference = String(data.client_reference ?? "").trim();
    if (String(data.id ?? "") !== gatewayReference) {
      return json({ error: "Référence Monerails incohérente." }, 409, origin);
    }
    eventId = "monerails-poll:" + gatewayReference + ":" + gatewayStatus + ":" + String(data.updated_at ?? "");
  }

  const expectedGatewayAmount = payment.provider === "nkap"
    ? Number(stored.gateway_amount ?? payment.amount)
    : Number(payment.amount);
  if (returnedMerchantReference !== String(payment.transaction_reference)
    || !Number.isFinite(gatewayAmount) || gatewayAmount !== expectedGatewayAmount
    || gatewayCurrency !== String(payment.currency).toUpperCase()) {
    return json({ error: "Montant, devise ou référence marchand non conforme. Aucun accès ne sera délivré." }, 409, origin);
  }

  await admin.from("payments").update({
    provider_response: { ...stored, status_checked_at: new Date().toISOString(), last_status: gatewayStatus }
  }).eq("id", payment.id);

  let confirmed = false;
  let finalFailure = false;
  if (payment.provider === "nkap") {
    confirmed = gatewayStatus === "COMPLETED";
    finalFailure = ["FAILED", "CANCELLED"].includes(gatewayStatus);
    if (gatewayStatus === "EXPIRED") {
      return json({
        ok: true, order_number: order.order_number,
        order_status: order.status, payment_status: payment.status,
        gateway_status: gatewayStatus.toLowerCase(),
        message: "La session Nkap est expirée, mais une confirmation tardive reste possible."
      }, 200, origin);
    }
  } else {
    confirmed = gatewayStatus === "succeeded";
    finalFailure = ["failed", "expired"].includes(gatewayStatus);
  }

  if (confirmed || finalFailure) {
    const eventName = payment.provider === "nkap"
      ? "payment." + gatewayStatus.toLowerCase()
      : "collection." + gatewayStatus;
    const { error: applyError } = await admin.rpc("apply_payment_webhook", {
      p_transaction_reference: payment.transaction_reference,
      p_event_id: eventId,
      p_confirmed: confirmed,
      p_provider_reference: providerReference,
      p_provider_response: { gateway: payment.provider, event: eventName, source: "status_check", data }
    });
    if (applyError) {
      console.error("Could not apply alternate gateway status:", applyError.message);
      return json({ error: "Le statut a été reçu, mais la mise à jour de la commande a échoué." }, 500, origin);
    }
  }

  const { data: latestPayment } = await admin.from("payments").select("status").eq("id", payment.id).maybeSingle();
  const { data: latestOrder } = await admin.from("orders").select("status").eq("id", order.id).maybeSingle();
  const latestPaymentStatus = String(latestPayment?.status ?? payment.status);
  const latestOrderStatus = String(latestOrder?.status ?? order.status);

  const emailSent = confirmed ? await deliverGuestEmail(admin, String(order.id)) : false;
  const url = confirmed ? await guestDownloadUrl(admin, String(order.id), String(order.order_number)) : null;

  return json({
    ok: true,
    order_number: order.order_number,
    order_status: latestOrderStatus,
    payment_status: latestPaymentStatus,
    gateway_status: gatewayStatus,
    download_url: url,
    email_sent: emailSent,
    message: confirmed
      ? url ? "Paiement confirmé. Votre lien de téléchargement est prêt." : "Paiement confirmé. Votre achat est disponible dans votre compte."
      : finalFailure ? "La passerelle a signalé un échec de paiement." : "En attente de confirmation sur votre téléphone."
  }, 200, origin);
});
