import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYCENTRAL_API_KEY = Deno.env.get("PAYCENTRAL_API_KEY") ?? "";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") ?? "";
const GUEST_TOKEN_ENCRYPTION_KEY = Deno.env.get("GUEST_TOKEN_ENCRYPTION_KEY") ?? "";
const PAYCENTRAL_URL = "https://api-paycentral.gabondunumerique.com/api/v1";
const PRODUCTION_HOST = "dora-digital-academy-1mvr.vercel.app";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function allowedOrigin(origin: string) {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === PRODUCTION_HOST
      || (host.startsWith("dora-digital-academy-1mvr-") && host.endsWith("-dorajospeh-oss.vercel.app"))
      || host === "localhost";
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin || "https://" + PRODUCTION_HOST,
      "access-control-allow-headers": "apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      "vary": "Origin"
    }
  });
}

function providerName(provider: string) {
  const p = provider.toLowerCase();
  if (p === "orange_money") return "orange";
  if (p === "airtel_money") return "airtel";
  if (p === "moov_money") return "moov";
  return p;
}

async function getGuestDownloadUrl(admin: any, orderId: string, orderNumber: string) {
  if (!GUEST_TOKEN_ENCRYPTION_KEY) return null;

  const { data: tokenRow, error } = await admin
    .from("guest_order_tokens")
    .select("encrypted_token,encryption_iv,expires_at,download_count,max_downloads,revoked_at")
    .eq("order_id", orderId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !tokenRow || tokenRow.revoked_at) return null;
  if (tokenRow.expires_at && Date.parse(String(tokenRow.expires_at)) <= Date.now()) return null;
  if (Number(tokenRow.max_downloads) !== -1
    && Number(tokenRow.download_count) >= Number(tokenRow.max_downloads)) return null;

  try {
    const keyBytes = Uint8Array.from(atob(GUEST_TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
    if (keyBytes.length !== 32) throw new Error("Invalid guest encryption key");
    const aesKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const b64 = (value: unknown) => Uint8Array.from(atob(String(value)), c => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64(tokenRow.encryption_iv) },
      aesKey,
      b64(tokenRow.encrypted_token)
    );
    const token = new TextDecoder().decode(plain);
    return "https://" + PRODUCTION_HOST + "/?download=guest&order=" +
      encodeURIComponent(orderNumber) + "&token=" + encodeURIComponent(token);
  } catch (error) {
    console.error("Guest download link recovery failed:", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

async function deliverGuestEmail(admin: any, orderId: string) {
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL || !GUEST_TOKEN_ENCRYPTION_KEY) {
    return { sent: false, reason: "delivery_secrets_missing" };
  }

  const { data: claimed, error: claimError } = await admin.rpc("claim_guest_order_email", { p_order_id: orderId });
  if (claimError) {
    console.error("Guest status email claim failed:", claimError.message);
    return { sent: false, reason: "claim_failed" };
  }
  if (!Array.isArray(claimed) || !claimed.length) {
    const { data: existingToken } = await admin
      .from("guest_order_tokens")
      .select("email_sent_at")
      .eq("order_id", orderId)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();
    return { sent: Boolean(existingToken?.email_sent_at), reason: existingToken?.email_sent_at ? "already_sent" : "not_claimed" };
  }

  const item = object(claimed[0]);
  try {
    const keyBytes = Uint8Array.from(atob(GUEST_TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
    if (keyBytes.length !== 32) throw new Error("Invalid guest encryption key");
    const aesKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const b64 = (value: unknown) => Uint8Array.from(atob(String(value)), c => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64(item.encryption_iv) },
      aesKey,
      b64(item.encrypted_token)
    );
    const token = new TextDecoder().decode(plain);
    const downloadUrl = "https://" + PRODUCTION_HOST + "/?download=guest&order=" +
      encodeURIComponent(String(item.order_number)) + "&token=" + encodeURIComponent(token);

    const mailResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "accept": "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: { name: "DORA DIGITAL ACADEMY", email: BREVO_SENDER_EMAIL },
        to: [{ email: String(item.buyer_email) }],
        subject: "Votre achat DORA DIGITAL ACADEMY — lien de téléchargement",
        htmlContent: "<div style='font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#243047'>" +
          "<h2>Merci pour votre achat !</h2><p>Votre paiement a été confirmé.</p>" +
          "<p>Produit : <strong>" + String(item.product_title ?? "Votre produit") + "</strong></p>" +
          "<p>Commande : <strong>" + String(item.order_number) + "</strong></p>" +
          "<p><a href='" + downloadUrl + "' style='display:inline-block;padding:14px 22px;background:#164e8b;color:white;text-decoration:none;border-radius:8px'>Télécharger mon produit</a></p>" +
          "<p>Ce lien est personnel et soumis à une limite de téléchargements.</p>" +
          "<p>DORA DIGITAL ACADEMY</p></div>"
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!mailResponse.ok) {
      const details = await mailResponse.text();
      const message = "Brevo HTTP " + mailResponse.status + ": " + details.slice(0, 240);
      await admin.rpc("release_guest_order_email_claim", { p_order_id: orderId, p_error: message });
      console.error("Brevo email failed during status fallback:", mailResponse.status, details.slice(0, 240));
      return { sent: false, reason: "brevo_rejected" };
    }

    const { error: markedError } = await admin.rpc("mark_guest_order_email_sent", { p_order_id: orderId });
    if (markedError) {
      console.error("Could not mark guest email sent:", markedError.message);
      return { sent: false, reason: "email_sent_mark_failed" };
    }
    console.log("Guest email delivered by payment-status fallback", { order: item.order_number });
    return { sent: true, reason: "sent" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email error";
    await admin.rpc("release_guest_order_email_claim", { p_order_id: orderId, p_error: message });
    console.error("Guest status email delivery error:", message);
    return { sent: false, reason: "email_delivery_failed" };
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (!allowedOrigin(origin)) return json({ error: "Origine non autorisée." }, 403, origin);
  if (req.method === "OPTIONS") return json({ ok: true }, 200, origin);
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405, origin);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !PAYCENTRAL_API_KEY) {
    return json({ error: "Configuration serveur du suivi de paiement incomplète." }, 503, origin);
  }

  let body: JsonObject;
  try {
    body = await req.json() as JsonObject;
  } catch {
    return json({ error: "Requête JSON invalide." }, 400, origin);
  }

  const orderNumber = String(body.order_number ?? "").trim().toUpperCase();
  const buyerEmail = String(body.email ?? "").trim().toLowerCase();
  if (!/^DDA-[A-F0-9]{16}$/.test(orderNumber) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    return json({ error: "Référence de commande ou adresse e-mail invalide." }, 400, origin);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  }) as any;

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,order_number,buyer_email,status")
    .eq("order_number", orderNumber)
    .eq("buyer_email", buyerEmail)
    .maybeSingle();

  // A random order number and the matching purchaser e-mail are both required.
  if (orderError || !order) return json({ error: "Commande introuvable pour ces coordonnées." }, 404, origin);

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select("id,transaction_reference,provider,amount,currency,status,provider_response,created_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (paymentError) {
    console.error("Guest payment lookup failed:", paymentError.message);
    return json({ error: "Impossible de vérifier le paiement." }, 500, origin);
  }
  if (!payment) {
    return json({ ok: true, order_status: order.status, payment_status: "not_started", email_sent: false }, 200, origin);
  }

  const providerResponse = object(payment.provider_response);
  const transactionId = String(providerResponse.transaction_id ?? "").trim();
  let paymentStatus = String(payment.status);
  let orderStatus = String(order.status);

  if (paymentStatus === "confirmed" || orderStatus === "paid") {
    const email = await deliverGuestEmail(admin, String(order.id));
    const downloadUrl = await getGuestDownloadUrl(admin, String(order.id), String(order.order_number));
    return json({
      ok: true,
      order_number: order.order_number,
      order_status: "paid",
      payment_status: "confirmed",
      email_sent: email.sent,
      download_url: downloadUrl,
      message: downloadUrl
        ? "Paiement confirmé. Votre lien personnel de téléchargement est disponible."
        : email.sent
          ? "Paiement confirmé et lien de téléchargement envoyé."
          : "Paiement confirmé. La livraison par e-mail est en cours de vérification."
    }, 200, origin);
  }

  if (!transactionId) {
    return json({
      ok: true,
      order_number: order.order_number,
      order_status: orderStatus,
      payment_status: paymentStatus,
      email_sent: false,
      message: "La demande n'a pas encore retourné de référence PayCentral."
    }, 200, origin);
  }

  const lastCheck = Date.parse(String(providerResponse.status_checked_at ?? ""));
  if (Number.isFinite(lastCheck) && Date.now() - lastCheck < 60_000) {
    return json({
      ok: true,
      order_number: order.order_number,
      order_status: orderStatus,
      payment_status: paymentStatus,
      email_sent: false,
      throttled: true,
      message: "La vérification vient d'être effectuée. Réessayez dans une minute."
    }, 200, origin);
  }

  let gatewayResponse: Response;
  let gatewayBody: JsonObject;
  try {
    gatewayResponse = await fetch(PAYCENTRAL_URL + "/payment/" + encodeURIComponent(transactionId) + "/status", {
      method: "GET",
      headers: { "X-Api-Key": PAYCENTRAL_API_KEY, "Accept": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });
    gatewayBody = await gatewayResponse.json().catch(() => ({})) as JsonObject;
  } catch (error) {
    console.error("Guest PayCentral status request failed:", error instanceof Error ? error.message : "Network error");
    return json({ error: "PayCentral est momentanément injoignable.", retryable: true }, 502, origin);
  }

  if (!gatewayResponse.ok || gatewayBody.success !== true) {
    return json({
      error: String(gatewayBody.message ?? "Le statut PayCentral n'est pas disponible."),
      retryable: gatewayResponse.status === 429 || gatewayResponse.status >= 500
    }, gatewayResponse.status === 429 || gatewayResponse.status >= 500 ? 502 : 409, origin);
  }

  const gatewayData = object(gatewayBody.transaction ?? object(gatewayBody.data).transaction ?? gatewayBody.data ?? gatewayBody);
  const receivedId = String(gatewayData.id ?? gatewayData.transaction_id ?? "").trim();
  const merchantReference = String(gatewayData.merchant_reference ?? "").trim();
  const amount = Number(gatewayData.amount);
  const currency = String(gatewayData.currency ?? "").toUpperCase();
  const receivedProvider = String(gatewayData.provider ?? "").toLowerCase();
  const expectedProvider = providerName(String(payment.provider));
  const status = String(gatewayData.status ?? "").toLowerCase();

  if ((receivedId && receivedId !== transactionId)
    || merchantReference !== String(payment.transaction_reference)
    || !Number.isFinite(amount) || amount !== Number(payment.amount)
    || currency !== String(payment.currency).toUpperCase()
    || currency !== "XAF"
    || receivedProvider !== expectedProvider) {
    console.error("Guest PayCentral status validation failed", { orderNumber, receivedIdMatch: !receivedId || receivedId === transactionId, merchantReferenceMatch: merchantReference === payment.transaction_reference, amountMatch: amount === Number(payment.amount), currencyMatch: currency === String(payment.currency).toUpperCase(), providerMatch: receivedProvider === expectedProvider });
    return json({ error: "Les informations renvoyées par PayCentral ne correspondent pas à cette commande." }, 409, origin);
  }

  await admin.from("payments").update({
    provider_response: {
      ...providerResponse,
      gateway: "paycentral",
      transaction_id: transactionId,
      status_checked_at: new Date().toISOString(),
      last_status_response: gatewayData
    }
  }).eq("id", payment.id);

  if (!["success", "failed", "cancelled", "expired"].includes(status)) {
    return json({
      ok: true,
      order_number: order.order_number,
      order_status: orderStatus,
      payment_status: paymentStatus,
      gateway_status: status || "processing",
      email_sent: false,
      message: "Le paiement attend encore la confirmation du simulateur."
    }, 200, origin);
  }

  const eventName = status === "success" ? "payment.success" : status === "cancelled" ? "payment.cancelled" : "payment.failed";
  const eventId = transactionId + ":" + eventName;
  const confirmed = status === "success";
  const { data: applied, error: applyError } = await admin.rpc("apply_payment_webhook", {
    p_transaction_reference: payment.transaction_reference,
    p_event_id: eventId,
    p_confirmed: confirmed,
    p_provider_reference: gatewayData.provider_reference ?? transactionId,
    p_provider_response: { event: eventName, source: "paycentral_guest_status_check", data: gatewayData }
  });

  if (applyError) {
    const { data: latest } = await admin.from("payments")
      .select("status,webhook_event_id")
      .eq("id", payment.id)
      .maybeSingle();
    if (latest?.webhook_event_id !== eventId && !(confirmed && latest?.status === "confirmed")) {
      console.error("Could not apply guest PayCentral status:", applyError.message);
      return json({ error: "Le statut a été reçu, mais la mise à jour de la commande a échoué." }, 500, origin);
    }
  }

  const [{ data: latestOrder }, { data: latestPayment }] = await Promise.all([
    admin.from("orders").select("status").eq("id", order.id).maybeSingle(),
    admin.from("payments").select("status").eq("id", payment.id).maybeSingle()
  ]);
  orderStatus = String(latestOrder?.status ?? orderStatus);
  paymentStatus = String(latestPayment?.status ?? applied?.status ?? paymentStatus);

  let emailSent = false;
  let downloadUrl: string | null = null;
  if (confirmed && paymentStatus === "confirmed") {
    const delivery = await deliverGuestEmail(admin, String(order.id));
    emailSent = delivery.sent;
    downloadUrl = await getGuestDownloadUrl(admin, String(order.id), String(order.order_number));
  }

  return json({
    ok: true,
    order_number: order.order_number,
    order_status: orderStatus,
    payment_status: paymentStatus,
    email_sent: emailSent,
    download_url: downloadUrl,
    message: confirmed
      ? downloadUrl
        ? "Paiement confirmé. Votre lien personnel de téléchargement est disponible."
        : emailSent
          ? "Paiement confirmé et lien de téléchargement envoyé."
          : "Paiement confirmé. La livraison par e-mail est en cours de vérification."
      : status === "cancelled" ? "Le paiement a été annulé." : "Le prestataire a signalé un échec de paiement."
  }, 200, origin);
});
