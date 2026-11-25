import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("NKAP_WEBHOOK_SECRET") ?? "";
const GUEST_TOKEN_ENCRYPTION_KEY = Deno.env.get("GUEST_TOKEN_ENCRYPTION_KEY") ?? "";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") ?? "";
const SITE_URL = "https://dora-digital-academy-1mvr.vercel.app";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function equalHex(a: string, b: string) {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifySignature(rawBody: string, signature: string) {
  if (!WEBHOOK_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = [...digest].map(b => b.toString(16).padStart(2, "0")).join("");
  return equalHex(expected, signature.trim().replace(/^sha256=/i, ""));
}

async function deliverGuestEmail(admin: any, orderId: string) {
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL || !GUEST_TOKEN_ENCRYPTION_KEY) return;
  const { data: claimed, error } = await admin.rpc("claim_guest_order_email", { p_order_id: orderId });
  if (error || !Array.isArray(claimed) || !claimed.length) return;
  const item = object(claimed[0]);
  try {
    const keyBytes = Uint8Array.from(atob(GUEST_TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const bytes = (s: unknown) => Uint8Array.from(atob(String(s)), c => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(item.encryption_iv) }, key, bytes(item.encrypted_token));
    const token = new TextDecoder().decode(plain);
    const url = SITE_URL + "/?download=guest&order=" + encodeURIComponent(String(item.order_number)) + "&token=" + encodeURIComponent(token);
    const sent = await fetch("https://api.brevo.com/v3/smtp/email", {
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
    if (!sent.ok) {
      const details = await sent.text();
      await admin.rpc("release_guest_order_email_claim", { p_order_id: orderId, p_error: "Brevo HTTP " + sent.status + ": " + details.slice(0, 300) });
      console.error("Nkap guest email rejected:", sent.status, details.slice(0, 200));
    } else {
      await admin.rpc("mark_guest_order_email_sent", { p_order_id: orderId });
    }
  } catch (error) {
    await admin.rpc("release_guest_order_email_claim", {
      p_order_id: orderId,
      p_error: error instanceof Error ? error.message : "Nkap guest email failed"
    });
    console.error("Nkap guest email failure:", error instanceof Error ? error.message : "unknown");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !WEBHOOK_SECRET) {
    console.error("Nkap webhook secrets are missing.");
    return new Response("Webhook configuration unavailable", { status: 503 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("X-LtcPay-Signature") ?? "";
  if (!await verifySignature(rawBody, signature)) {
    console.warn("Rejected Nkap webhook: invalid signature.");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: JsonObject;
  try { payload = JSON.parse(rawBody) as JsonObject; }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  if (String(payload.event ?? "") !== "payment.status_changed") {
    return Response.json({ received: true, ignored: true });
  }

  const data = object(payload.data);
  const reference = String(data.merchant_reference ?? "").trim();
  const gatewayReference = String(data.reference ?? "").trim();
  const gatewayStatus = String(data.status ?? "").toUpperCase();
  const amount = Number(data.amount);
  const currency = String(data.currency ?? "").toUpperCase();
  const eventId = req.headers.get("X-LtcPay-Delivery-Id")
    || gatewayReference + ":" + gatewayStatus + ":" + String(payload.timestamp ?? payload.event ?? "");

  if (!reference || !gatewayReference || !eventId) return new Response("Missing payment identifiers", { status: 400 });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: payment, error } = await admin
    .from("payments")
    .select("id,order_id,provider,transaction_reference,amount,currency,provider_response,status")
    .eq("transaction_reference", reference)
    .maybeSingle();

  if (error || !payment || payment.provider !== "nkap") {
    console.warn("Nkap webhook payment not found:", reference);
    return new Response("Payment not found", { status: 404 });
  }

  const stored = object(payment.provider_response);
  if (String(stored.gateway_reference ?? "") !== gatewayReference) {
    return new Response("Gateway reference mismatch", { status: 409 });
  }
  const expectedAmount = Number(stored.gateway_amount ?? payment.amount);
  if (!Number.isFinite(amount) || amount !== expectedAmount || currency !== String(payment.currency).toUpperCase()) {
    return new Response("Amount or currency mismatch", { status: 409 });
  }

  if (gatewayStatus === "EXPIRED") {
    // Nkap may send a late COMPLETED verdict after EXPIRED. Never close the order on EXPIRED alone.
    return Response.json({ received: true, payment_status: payment.status, note: "expired is non-final" });
  }

  const confirmed = gatewayStatus === "COMPLETED";
  if (!confirmed && !["FAILED", "CANCELLED"].includes(gatewayStatus)) {
    return Response.json({ received: true, ignored: true, gateway_status: gatewayStatus });
  }

  const { data: applied, error: applyError } = await admin.rpc("apply_payment_webhook", {
    p_transaction_reference: reference,
    p_event_id: String(eventId),
    p_confirmed: confirmed,
    p_provider_reference: String(data.provider_transaction_id ?? gatewayReference),
    p_provider_response: { gateway: "nkap", event: payload.event, data }
  });

  if (applyError) {
    console.error("Nkap payment update failed:", applyError.message);
    return new Response("Payment update failed", { status: 500 });
  }

  if (confirmed) {
    await admin.rpc("notify_payment_confirmed", { p_order_id: payment.order_id });
    await deliverGuestEmail(admin, String(payment.order_id));
  }

  return Response.json({
    received: true,
    payment_status: applied?.status ?? (confirmed ? "confirmed" : "failed")
  });
});
