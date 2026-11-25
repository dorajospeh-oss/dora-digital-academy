import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MONERAILS_WEBHOOK_SECRET = Deno.env.get("MONERAILS_WEBHOOK_SECRET") ?? "";
const MONERAILS_API_KEY = Deno.env.get("MONERAILS_API_KEY") ?? "";
const GUEST_TOKEN_ENCRYPTION_KEY = Deno.env.get("GUEST_TOKEN_ENCRYPTION_KEY") ?? "";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") ?? "";
const SITE_URL = "https://dora-digital-academy-1mvr.vercel.app";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifySignature(raw: string, header: string) {
  const fields = (header || "").split(",").map(x => x.trim().split("=", 2));
  const timestamp = fields.find(([k]) => k === "t")?.[1] ?? "";
  const signatures = fields.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length || !MONERAILS_WEBHOOK_SECRET) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(MONERAILS_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const message = new TextEncoder().encode(timestamp + "." + raw);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const expected = [...digest].map(b => b.toString(16).padStart(2, "0")).join("");
  return signatures.some(sig => safeEqual(expected, sig));
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
      console.error("Monerails guest email rejected:", sent.status, details.slice(0, 200));
    } else {
      await admin.rpc("mark_guest_order_email_sent", { p_order_id: orderId });
    }
  } catch (error) {
    await admin.rpc("release_guest_order_email_claim", {
      p_order_id: orderId,
      p_error: error instanceof Error ? error.message : "Monerails guest email failed"
    });
    console.error("Monerails guest email failure:", error instanceof Error ? error.message : "unknown");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !MONERAILS_WEBHOOK_SECRET) {
    console.error("Monerails webhook configuration is incomplete.");
    return new Response("Webhook configuration unavailable", { status: 503 });
  }

  const raw = await req.text();
  const signature = req.headers.get("Monerail-Signature") ?? "";
  if (!await verifySignature(raw, signature)) {
    console.warn("Rejected Monerails webhook: invalid signature or timestamp.");
    return new Response("Invalid signature", { status: 401 });
  }

  let event: JsonObject;
  try { event = JSON.parse(raw) as JsonObject; }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  const type = String(event.type ?? "");
  const acceptedTypes = new Set(["collection.succeeded", "collection.failed", "collection.expired"]);
  if (!acceptedTypes.has(type)) return Response.json({ received: true, ignored: true });

  const data = object(object(event.data).object);
  const reference = String(data.client_reference ?? "").trim();
  const collectionId = String(data.id ?? "").trim();
  const eventId = String(event.id ?? req.headers.get("Monerail-Event-Id") ?? "").trim();
  if (!reference || !collectionId || !eventId) return new Response("Missing identifiers", { status: 400 });

  const liveMode = event.livemode === true;
  const configuredLive = MONERAILS_API_KEY.startsWith("mr_live_");
  if (liveMode !== configuredLive) return new Response("Mode mismatch", { status: 409 });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: payment, error } = await admin
    .from("payments")
    .select("id,order_id,provider,transaction_reference,amount,currency,provider_response,status,payment_method")
    .eq("transaction_reference", reference)
    .maybeSingle();

  if (error || !payment || payment.provider !== "monerails") {
    console.warn("Monerails collection not found:", reference);
    return new Response("Payment not found", { status: 404 });
  }

  const stored = object(payment.provider_response);
  if (String(stored.gateway_reference ?? "") !== collectionId) {
    return new Response("Collection reference mismatch", { status: 409 });
  }
  if (Number(data.amount) !== Number(payment.amount)
    || String(data.currency ?? "").toUpperCase() !== String(payment.currency).toUpperCase()) {
    return new Response("Amount or currency mismatch", { status: 409 });
  }
  const expectedOperator = String(payment.payment_method ?? "").toUpperCase();
  if (String(data.operator ?? "").toUpperCase() !== expectedOperator) {
    return new Response("Operator mismatch", { status: 409 });
  }

  const confirmed = type === "collection.succeeded";
  const { data: applied, error: applyError } = await admin.rpc("apply_payment_webhook", {
    p_transaction_reference: reference,
    p_event_id: eventId,
    p_confirmed: confirmed,
    p_provider_reference: collectionId,
    p_provider_response: { gateway: "monerails", event: type, data }
  });
  if (applyError) {
    console.error("Monerails payment update failed:", applyError.message);
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
