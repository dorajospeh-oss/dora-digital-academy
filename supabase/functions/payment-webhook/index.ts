import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("PAYCENTRAL_WEBHOOK_SECRET") ?? "";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") ?? "";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

type Obj = Record<string, unknown>;
const asObj = (value: unknown): Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};

function first(objects: Obj[], keys: string[]): unknown {
  for (const item of objects) {
    for (const key of keys) {
      const value = item[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
  }
  return undefined;
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(rawBody: string, signature: string, secret: string) {
  const received = signature.trim().replace(/^sha256=/i, "").toLowerCase();
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(received, expected);
}

function normalizeProvider(value: string) {
  const v = value.toLowerCase().replace(/[^a-z]/g, "");
  if (v.includes("orange")) return "orange";
  if (v.includes("airtel")) return "airtel";
  if (v.includes("mtn")) return "mtn";
  if (v.includes("moov")) return "moov";
  return v;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "Server configuration incomplete" }, 503);
  if (!WEBHOOK_SECRET) return json({ error: "PayCentral webhook secret not configured" }, 503);

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > 256 * 1024) return json({ error: "Payload too large" }, 413);

  const signature = req.headers.get("x-paycentral-signature") ?? "";
  if (!signature || !(await verifySignature(rawBody, signature, WEBHOOK_SECRET))) {
    console.warn("PayCentral webhook rejected: invalid signature or missing signature header");
    return json({ error: "Invalid webhook signature" }, 401);
  }

  let event: Obj;
  try {
    event = JSON.parse(rawBody) as Obj;
  } catch {
    console.warn("PayCentral webhook rejected: invalid JSON");
    return json({ error: "Invalid JSON" }, 400);
  }

  const eventName = String(event.event ?? event.type ?? event.event_name ?? "").trim().toLowerCase();
  const rootData = asObj(event.data ?? event.payload);
  const nestedData = asObj(rootData.transaction ?? rootData.payment ?? rootData.data);
  const objects = [nestedData, rootData, asObj(event)];
  const supportedEvents = ["payment.success", "payment.failed", "payment.cancelled"];

  if (!supportedEvents.includes(eventName)) {
    // Acknowledge other signed events so they do not trigger useless retries.
    console.log("PayCentral webhook acknowledged as unsupported event", { eventName: eventName || "missing" });
    return json({ received: true, ignored: true, event: eventName || "unknown" }, 200);
  }

  const transactionId = String(first(objects, ["transaction_id", "transactionId", "payment_id", "paymentId", "id"]) ?? "").trim();
  const merchantReference = String(first(objects, ["merchant_reference", "merchantReference", "order_reference", "orderReference", "reference"]) ?? "").trim();
  const status = String(first(objects, ["status", "payment_status", "paymentStatus"]) ?? eventName.replace("payment.", "")).trim().toLowerCase();
  const amountRaw = first(objects, ["amount", "total_amount", "totalAmount"]);
  const amount = Number(amountRaw);
  const currency = String(first(objects, ["currency"]) ?? "").trim().toUpperCase();
  const provider = String(first(objects, ["provider", "operator", "payment_method", "paymentMethod"]) ?? "").trim();

  if (!merchantReference && !transactionId) {
    console.warn("PayCentral webhook missing lookup identifiers", {
      eventName, rootKeys: Object.keys(event), dataKeys: Object.keys(rootData), nestedKeys: Object.keys(nestedData)
    });
    return json({ error: "Payment reference and transaction ID are missing" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let payment: {
    id: string; transaction_reference: string; amount: number; currency: string; provider: string; status: string
  } | null = null;

  if (merchantReference) {
    const lookup = await admin.from("payments")
      .select("id,transaction_reference,amount,currency,provider,status")
      .eq("transaction_reference", merchantReference)
      .maybeSingle();
    if (lookup.error) console.error("PayCentral payment lookup error", lookup.error.message);
    payment = lookup.data;
  }

  // Fallback for signed webhook variants that include the gateway transaction ID
  // but omit merchant_reference. Match against the ID saved at initiation time.
  if (!payment && transactionId) {
    const lookup = await admin.from("payments")
      .select("id,transaction_reference,amount,currency,provider,status")
      .filter("provider_response->>transaction_id", "eq", transactionId)
      .maybeSingle();
    if (lookup.error) console.error("PayCentral transaction-ID lookup error", lookup.error.message);
    payment = lookup.data;
  }

  if (!payment) {
    console.warn("PayCentral webhook payment not found", {
      eventName, hasMerchantReference: Boolean(merchantReference), hasTransactionId: Boolean(transactionId)
    });
    return json({ error: "Payment reference not found" }, 404);
  }

  // Use the reference stored in our database after a successful lookup.
  const canonicalReference = payment.transaction_reference;
  if (amountRaw === undefined || !Number.isFinite(amount)) {
    console.warn("PayCentral webhook amount missing or invalid", { eventName, hasAmount: amountRaw !== undefined });
    return json({ error: "Payment amount missing or invalid" }, 400);
  }
  if (!currency) {
    console.warn("PayCentral webhook currency missing", { eventName });
    return json({ error: "Payment currency missing" }, 400);
  }
  if (amount !== Number(payment.amount) || currency !== String(payment.currency).toUpperCase()) {
    console.warn("PayCentral webhook amount/currency mismatch", {
      eventName, amountMatches: amount === Number(payment.amount),
      currencyMatches: currency === String(payment.currency).toUpperCase()
    });
    return json({ error: "Payment amount or currency mismatch" }, 400);
  }

  const expectedProvider = normalizeProvider(
    payment.provider === "orange_money" ? "orange"
      : payment.provider === "airtel_money" ? "airtel"
      : payment.provider
  );
  if (provider && normalizeProvider(provider) !== expectedProvider) {
    console.warn("PayCentral webhook provider mismatch", {
      eventName, expectedProvider, receivedProvider: normalizeProvider(provider)
    });
    return json({ error: "Payment provider mismatch" }, 400);
  }

  const successStatuses = ["success", "succeeded", "paid", "completed"];
  const confirmed = eventName === "payment.success" && successStatuses.includes(status);
  if (eventName === "payment.success" && !confirmed) {
    console.warn("PayCentral success event has unexpected status", { eventName, status });
    return json({ error: "Unexpected status for success event" }, 400);
  }

  const eventId = (transactionId || canonicalReference) + ":" + eventName;
  const providerReference = first(objects, ["provider_reference", "providerReference", "operator_reference", "operatorReference"])
    ?? (transactionId || canonicalReference);

  const { data: applied, error: applyError } = await admin.rpc("apply_payment_webhook", {
    p_transaction_reference: canonicalReference,
    p_event_id: eventId,
    p_confirmed: confirmed,
    p_provider_reference: providerReference,
    p_provider_response: event
  });

  if (applyError) {
    const latest = await admin.from("payments")
      .select("status,webhook_event_id")
      .eq("transaction_reference", canonicalReference)
      .maybeSingle();
    if (latest.data?.webhook_event_id === eventId) {
      console.log("Duplicate PayCentral webhook acknowledged", { eventId });
    } else if (confirmed && latest.data?.status === "confirmed") {
      console.log("Payment already confirmed; continuing email delivery", { eventId });
    } else {
      console.error("Webhook database processing failed", applyError.message);
      return json({ error: "Payment confirmation processing failed" }, 500);
    }
  }


  // Deliver the guest download link only after the database confirms payment.
  // The raw token is stored encrypted at rest and decrypted only for this email.
  if (confirmed) {
    const { data: orderRow, error: orderLookupError } = await admin
      .from("orders")
      .select("id,user_id,order_number,buyer_email")
      .eq("id", (await admin.from("payments").select("order_id").eq("transaction_reference", canonicalReference).single()).data?.order_id ?? "")
      .maybeSingle();

    if (orderLookupError) console.error("Guest email order lookup failed", orderLookupError.message);
    if (orderRow && orderRow.buyer_email) {
      if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
        console.error("Guest email not sent: BREVO_API_KEY or BREVO_SENDER_EMAIL secret missing");
      } else {
        const { data: claimed, error: claimError } = await admin.rpc("claim_guest_order_email", { p_order_id: orderRow.id });
        if (claimError) {
          console.error("Guest email claim failed", claimError.message);
        } else if (Array.isArray(claimed) && claimed.length) {
          const item = claimed[0] as Record<string, unknown>;
          try {
            const keyRaw = Deno.env.get("GUEST_TOKEN_ENCRYPTION_KEY") ?? "";
            const keyBytes = Uint8Array.from(atob(keyRaw), c => c.charCodeAt(0));
            if (keyBytes.length !== 32) throw new Error("Invalid guest encryption key");
            const aesKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
            const b64 = (value: unknown) => Uint8Array.from(atob(String(value)), c => c.charCodeAt(0));
            const plain = await crypto.subtle.decrypt(
              { name: "AES-GCM", iv: b64(item.encryption_iv) },
              aesKey,
              b64(item.encrypted_token)
            );
            const token = new TextDecoder().decode(plain);
            const downloadUrl = "https://dora-digital-academy-1mvr.vercel.app/?download=guest&order=" +
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
                  "<p>Ce lien est personnel. Ne le partagez pas. Il est soumis à une limite de téléchargements.</p>" +
                  "<p>Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>" + downloadUrl + "</p>" +
                  "<p>DORA DIGITAL ACADEMY</p></div>"
              })
            });
            if (!mailResponse.ok) {
              const details = await mailResponse.text();
              await admin.rpc("release_guest_order_email_claim", { p_order_id: orderRow.id, p_error: "Brevo HTTP " + mailResponse.status + ": " + details.slice(0, 300) });
              console.error("Brevo email failed", mailResponse.status, details.slice(0, 300));
            } else {
              await admin.rpc("mark_guest_order_email_sent", { p_order_id: orderRow.id });
              console.log("Guest download email sent", { order: item.order_number });
            }
          } catch (emailError) {
            const message = emailError instanceof Error ? emailError.message : "Unknown email error";
            await admin.rpc("release_guest_order_email_claim", { p_order_id: orderRow.id, p_error: message });
            console.error("Guest email delivery error", message);
          }
        }
      }
    }
  }

  console.log("PayCentral webhook applied", {
    eventName, paymentStatus: applied?.status ?? (confirmed ? "confirmed" : "failed")
  });
  return json({ received: true, payment_status: applied?.status ?? (confirmed ? "confirmed" : "failed") }, 200);
});
