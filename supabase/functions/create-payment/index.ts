import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const PAYCENTRAL_API_KEY = Deno.env.get("PAYCENTRAL_API_KEY") ?? "";
const PAYCENTRAL_WEBHOOK_SECRET = Deno.env.get("PAYCENTRAL_WEBHOOK_SECRET") ?? "";
const GUEST_TOKEN_ENCRYPTION_KEY = Deno.env.get("GUEST_TOKEN_ENCRYPTION_KEY") ?? "";
const PAYCENTRAL_URL = "https://api-paycentral.gabondunumerique.com/api/v1";
const CALLBACK_URL = "https://wtbxjqamwitwogxdrkwd.supabase.co/functions/v1/payment-webhook";
const ALLOWED_ORIGINS = new Set([
  "https://dora-digital-academy-1mvr.vercel.app",
  "https://dora-digital-academy-1mvr-gho3axsu7-dorajospeh-oss.vercel.app",
  "https://dora-digital-academy.vercel.app",
  "https://dda-digital-academy.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001"
]);

const json = (body: unknown, status = 200, origin = "") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin || "https://dora-digital-academy.vercel.app",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      "vary": "Origin"
    }
  });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "Origine non autorisée." }, 403, origin);
  }
  if (req.method === "OPTIONS") return json({ ok: true }, 200, origin);
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405, origin);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return json({ error: "Configuration serveur Supabase incomplète." }, 503, origin);
  }
  if (!GUEST_TOKEN_ENCRYPTION_KEY) return json({ error: "Clé de chiffrement des accès invités absente." }, 503, origin);
  if (!PAYCENTRAL_API_KEY) {
    return json({ error: "Clé de paiement sandbox manquante dans Supabase." }, 503, origin);
  }
  if (!PAYCENTRAL_WEBHOOK_SECRET) {
    return json({ error: "Secret webhook PayCentral manquant. Aucun paiement n'a été créé." }, 503, origin);
  }


  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  let buyerUser: { id: string; email?: string } | null = null;
  let isPublicKey = bearer === ANON_KEY;
  try {
    const publicKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    if (publicKeys.default && bearer === publicKeys.default) isPublicKey = true;
  } catch { /* Optional newer Supabase key environment. */ }
  if (bearer && !isPublicKey) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: "Bearer " + bearer } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Session invalide. Reconnectez-vous ou achetez sans compte." }, 401, origin);
    }
    buyerUser = { id: userData.user.id, email: userData.user.email ?? undefined };
  }

  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return json({ error: "Requête JSON invalide." }, 400, origin);
  }

  const productId = String(input.product_id ?? "").trim();
  const provider = String(input.provider ?? "").trim().toLowerCase();
  const rawPhone = String(input.phone ?? "").trim();
  const buyerEmail = String(input.email ?? buyerUser?.email ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
    return json({ error: "Identifiant de produit invalide." }, 400, origin);
  }
  if (!["orange", "airtel", "moov"].includes(provider)) {
    return json({ error: "Choisissez Orange Money, Airtel Money ou Moov Money." }, 400, origin);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail) || buyerEmail.length > 254) return json({ error: "Saisissez une adresse e-mail valide pour recevoir votre eBook." }, 400, origin);
  // Accept international phone numbers; the buyer enters the country calling code.
  const normalizedPhone = rawPhone.replace(/[\s().-]/g, "");
  const phoneDigits = normalizedPhone.startsWith("+") ? normalizedPhone.slice(1) : normalizedPhone;
  if (!normalizedPhone.startsWith("+") || !/^[1-9][0-9]{7,14}$/.test(phoneDigits)) {
    return json({ error: "Entrez un numéro Mobile Money au format international, avec + et l’indicatif du pays." }, 400, origin);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const clientIp = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const rateDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientIp + "|" + buyerEmail));
  const rateKey = [...new Uint8Array(rateDigest)].map(b => b.toString(16).padStart(2, "0")).join("");
  const { data: allowed, error: rateError } = await admin.rpc("allow_guest_checkout", { p_rate_key: rateKey });
  if (rateError || allowed !== true) return json({ error: "Trop de tentatives. Réessayez dans dix minutes." }, 429, origin);

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id,title,slug,price,sale_price,currency,status,file_path,download_limit")
    .eq("id", productId)
    .eq("status", "published")
    .maybeSingle();

  if (productError || !product) return json({ error: "Cet eBook n'est pas disponible." }, 404, origin);
  if (!product.file_path) return json({ error: "Le fichier de cet eBook n'est pas encore configuré." }, 409, origin);

  const amount = Number(product.sale_price ?? product.price);
  const currency = String(product.currency ?? "XAF");
  if (!Number.isInteger(amount) || amount <= 0 || currency !== "XAF") {
    return json({ error: "Le prix de ce produit n'est pas configuré pour le paiement XAF." }, 409, origin);
  }

  const userId = buyerUser?.id ?? null;
  const orderNumber = "DDA-" + crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
  const { data: order, error: orderError } = await admin.from("orders").insert({
    order_number: orderNumber,
    user_id: userId,
    buyer_email: buyerEmail,
    buyer_phone: normalizedPhone,
    subtotal: amount,
    discount_amount: 0,
    total_amount: amount,
    currency,
    status: "pending"
  }).select("id,order_number,total_amount,currency").single();

  if (orderError || !order) {
    console.error("Creation commande impossible:", orderError?.message);
    return json({ error: "Impossible de créer la commande pour le moment." }, 500, origin);
  }

  const { error: itemError } = await admin.from("order_items").insert({
    order_id: order.id,
    product_id: product.id,
    title_snapshot: product.title,
    unit_price: amount,
    quantity: 1,
    subtotal: amount
  });
  if (itemError) {
    await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    console.error("Creation ligne de commande impossible:", itemError.message);
    return json({ error: "Impossible de préparer la commande." }, 500, origin);
  }

  const internalReference = "DDA-PAY-" + crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
  const dbProvider = provider === "orange" ? "orange_money" : provider === "airtel" ? "airtel_money" : "moov_money";
  const { data: payment, error: paymentError } = await admin.from("payments").insert({
    order_id: order.id,
    user_id: userId,
    provider: dbProvider,
    payment_method: dbProvider,
    transaction_reference: internalReference,
    amount,
    currency,
    status: "pending",
    provider_response: { gateway: "paycentral", mode: "sandbox" }
  }).select("id,transaction_reference,status,amount,currency").single();

  if (paymentError || !payment) {
    await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    console.error("Creation paiement impossible:", paymentError?.message);
    return json({ error: "Impossible de préparer le paiement." }, 500, origin);
  }


  let guestToken: string | null = null;
  {
    try {
      guestToken = [...crypto.getRandomValues(new Uint8Array(32))]
        .map(b => b.toString(16).padStart(2, "0")).join("");
      const tokenDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(guestToken));
      const tokenHash = [...new Uint8Array(tokenDigest)].map(b => b.toString(16).padStart(2, "0")).join("");
      const keyBytes = Uint8Array.from(atob(GUEST_TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
      if (keyBytes.length !== 32) throw new Error("La clé de chiffrement doit contenir 32 octets.");
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const aesKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
      const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, new TextEncoder().encode(guestToken));
      const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
      const { error: tokenError } = await admin.from("guest_order_tokens").insert({
        order_id: order.id,
        token_hash: tokenHash,
        encrypted_token: toBase64(new Uint8Array(encrypted)),
        encryption_iv: toBase64(iv),
        max_downloads: Number(product.download_limit ?? 3)
      });
      if (tokenError) throw tokenError;
    } catch (error) {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
      await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
      console.error("Guest access setup failed:", error instanceof Error ? error.message : "unknown error");
      return json({ error: "Impossible de sécuriser l'accès à votre achat. Aucun paiement n'a été lancé." }, 500, origin);
    }
  }

  let gatewayResponse: Response;
  let gatewayBody: Record<string, unknown>;
  try {
    gatewayResponse = await fetch(PAYCENTRAL_URL + "/payment/initiate", {
      method: "POST",
      headers: {
        "X-Api-Key": PAYCENTRAL_API_KEY,
        "Content-Type": "application/json",
        "Idempotency-Key": internalReference
      },
      body: JSON.stringify({
        amount,
        currency,
        phone: normalizedPhone,
        provider,
        description: "DORA DIGITAL ACADEMY — " + String(product.title).slice(0, 90),
        merchant_reference: internalReference,
        callback_url: CALLBACK_URL,
        success_url: "https://dora-digital-academy-1mvr.vercel.app/?paiement=retour",
        cancel_url: "https://dora-digital-academy-1mvr.vercel.app/?paiement=annule"
      }),
      signal: AbortSignal.timeout(20000)
    });
    gatewayBody = await gatewayResponse.json().catch(() => ({})) as Record<string, unknown>;
  } catch (error) {
    await admin.from("payments").update({
      status: "failed",
      provider_response: { gateway: "paycentral", transport_error: error instanceof Error ? error.message : "Network error" }
    }).eq("id", payment.id);
    await admin.from("orders").update({ status: "failed" }).eq("id", order.id);
    return json({ error: "PayCentral ne répond pas. La commande a été marquée en échec." }, 502, origin);
  }

  // PayCentral may return fields either at the top level or inside "data".
  // Normalize both response shapes so an accepted sandbox initiation is not
  // incorrectly marked as failed just because "data" is absent.
  const gatewayData = (gatewayBody.data && typeof gatewayBody.data === "object")
    ? gatewayBody.data as Record<string, unknown>
    : gatewayBody;
  const transactionId = String(gatewayData.transaction_id ?? gatewayBody.transaction_id ?? "");
  const gatewaySuccess = gatewayResponse.ok && gatewayBody.success === true && transactionId.length > 0;

  if (!gatewaySuccess) {
    await admin.from("payments").update({
      status: "failed",
      provider_response: { gateway: "paycentral", http_status: gatewayResponse.status, response: gatewayBody }
    }).eq("id", payment.id);
    await admin.from("orders").update({ status: "failed" }).eq("id", order.id);
    console.error("PayCentral a refusé l'initiation:", gatewayResponse.status, gatewayBody.message ?? "No message");
    return json({ error: "PayCentral n'a pas pu initier le paiement. Vérifiez la configuration sandbox." }, 502, origin);
  }

  await admin.from("payments").update({
    provider_response: {
      gateway: "paycentral",
      mode: "sandbox",
      transaction_id: transactionId,
      status: String(gatewayData.status ?? "pending"),
      provider: String(gatewayData.provider ?? provider),
      initiation_response: gatewayBody
    }
  }).eq("id", payment.id);

  const checkoutUrlValue = gatewayData.checkout_url ?? gatewayData.redirect_url
    ?? gatewayBody.checkout_url ?? gatewayBody.redirect_url;
  return json({
    ok: true,
    order_number: order.order_number,
    merchant_reference: internalReference,
    transaction_id: transactionId,
    checkout_url: typeof checkoutUrlValue === "string" && /^https:\/\//.test(checkoutUrlValue) ? checkoutUrlValue : null,
    status: String(gatewayData.status ?? gatewayBody.status ?? "pending"),
    provider: String(gatewayData.provider ?? gatewayBody.provider ?? provider),
    amount,
    currency,
    guest: !userId,
    buyer_email: buyerEmail,
    message: "Demande envoyée. Attendez la confirmation PayCentral avant le téléchargement."
  }, 200, origin);
});
