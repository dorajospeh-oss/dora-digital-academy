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

  const checkoutRequestId = String(input.checkout_request_id ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutRequestId)) {
    return json({ error: "Référence de session d'achat invalide." }, 400, origin);
  }

  const userId = buyerUser?.id ?? null;
  const dbProvider = provider === "orange" ? "orange_money" : provider === "airtel" ? "airtel_money" : "moov_money";
  const gatewayEnvironment = PAYCENTRAL_API_KEY.startsWith("sk_sandbox_")
    ? "sandbox"
    : PAYCENTRAL_API_KEY.startsWith("sk_live_") ? "live" : "unknown";

  let order: Record<string, unknown>;
  let payment: Record<string, unknown>;
  let product: Record<string, unknown>;
  let amount = 0;
  let currency = "XAF";
  let previousProviderResponse: Record<string, unknown> = {};
  let isExistingCheckout = false;

  const ensureGuestToken = async (orderId: string, downloadLimit: number) => {
    const { data: tokenRow, error: tokenLookupError } = await admin
      .from("guest_order_tokens")
      .select("id")
      .eq("order_id", orderId)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();

    if (tokenLookupError) throw tokenLookupError;
    if (tokenRow) return;

    const guestToken = [...crypto.getRandomValues(new Uint8Array(32))]
      .map(b => b.toString(16).padStart(2, "0")).join("");
    const tokenDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(guestToken));
    const tokenHash = [...new Uint8Array(tokenDigest)].map(b => b.toString(16).padStart(2, "0")).join("");
    const keyBytes = Uint8Array.from(atob(GUEST_TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
    if (keyBytes.length !== 32) throw new Error("La clé de chiffrement doit contenir 32 octets.");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aesKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, new TextEncoder().encode(guestToken));
    const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    const { error: tokenInsertError } = await admin.from("guest_order_tokens").insert({
      order_id: orderId,
      token_hash: tokenHash,
      encrypted_token: toBase64(new Uint8Array(encrypted)),
      encryption_iv: toBase64(iv),
      max_downloads: Math.max(1, Math.min(100, downloadLimit || 3))
    });
    if (tokenInsertError) throw tokenInsertError;
  };

  // Reuse a prior checkout intent after refresh, double-click, or a network
  // interruption. The unique database key is the final guard against races.
  const { data: foundOrder, error: foundOrderError } = await admin
    .from("orders")
    .select("id,order_number,user_id,buyer_email,buyer_phone,total_amount,currency,status")
    .eq("checkout_request_id", checkoutRequestId)
    .maybeSingle();

  if (foundOrderError) {
    console.error("Guest checkout idempotency lookup failed:", foundOrderError.message);
    return json({ error: "Impossible de vérifier votre commande précédente." }, 500, origin);
  }

  if (foundOrder) {
    isExistingCheckout = true;
    if ((foundOrder.user_id ?? null) !== userId
      || String(foundOrder.buyer_email ?? "").toLowerCase() !== buyerEmail
      || String(foundOrder.buyer_phone ?? "") !== normalizedPhone) {
      return json({ error: "Cette session d'achat est déjà liée à d'autres coordonnées. Démarrez une nouvelle session." }, 409, origin);
    }

    if (foundOrder.status === "paid") {
      return json({
        ok: true,
        already_paid: true,
        order_number: foundOrder.order_number,
        amount: Number(foundOrder.total_amount),
        currency: foundOrder.currency,
        message: "Cette commande est déjà payée. Consultez votre e-mail pour accéder à votre produit."
      }, 200, origin);
    }

    if (!["pending", "failed", "cancelled"].includes(String(foundOrder.status))) {
      return json({ error: "Cette commande n'est plus payable." }, 409, origin);
    }

    const { data: existingItem, error: itemLookupError } = await admin
      .from("order_items")
      .select("product_id,title_snapshot")
      .eq("order_id", foundOrder.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (itemLookupError || !existingItem?.product_id) {
      console.error("Existing guest checkout item lookup failed:", itemLookupError?.message);
      return json({ error: "La commande précédente ne contient plus son article." }, 409, origin);
    }

    const { data: existingProduct, error: existingProductError } = await admin
      .from("products")
      .select("id,title,slug,download_limit")
      .eq("id", existingItem.product_id)
      .maybeSingle();
    if (existingProductError || !existingProduct) {
      return json({ error: "Le produit de cette commande n'est plus disponible." }, 409, origin);
    }

    const { data: existingPayment, error: existingPaymentError } = await admin
      .from("payments")
      .select("id,order_id,transaction_reference,provider,amount,currency,status,provider_response")
      .eq("order_id", foundOrder.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingPaymentError || !existingPayment) {
      console.error("Existing guest checkout payment lookup failed:", existingPaymentError?.message);
      return json({ error: "La tentative de paiement précédente est introuvable." }, 409, origin);
    }

    if (existingPayment.provider !== dbProvider) {
      return json({ error: "Une demande de paiement existe déjà avec un autre opérateur. Terminez-la avant de changer de moyen de paiement." }, 409, origin);
    }
    if (existingPayment.status === "confirmed") {
      return json({
        ok: true,
        already_paid: true,
        order_number: foundOrder.order_number,
        amount: Number(existingPayment.amount),
        currency: existingPayment.currency,
        message: "Votre paiement est déjà confirmé. Consultez votre e-mail pour télécharger le produit."
      }, 200, origin);
    }
    if (existingPayment.status !== "pending") {
      return json({
        error: "La tentative précédente a été refusée ou clôturée. Vous pouvez démarrer une nouvelle session de paiement.",
        new_checkout_required: true
      }, 409, origin);
    }

    order = foundOrder;
    payment = existingPayment;
    product = existingProduct;
    amount = Number(existingPayment.amount);
    currency = String(existingPayment.currency ?? "XAF");
    previousProviderResponse = existingPayment.provider_response && typeof existingPayment.provider_response === "object"
      ? existingPayment.provider_response as Record<string, unknown>
      : {};

    const existingTransactionId = String(previousProviderResponse.transaction_id ?? "").trim();
    if (existingTransactionId) {
      const storedRedirect = previousProviderResponse.redirect_url ?? previousProviderResponse.checkout_url ?? null;
      return json({
        ok: true,
        already_initiated: true,
        order_number: foundOrder.order_number,
        merchant_reference: existingPayment.transaction_reference,
        transaction_id: existingTransactionId,
        checkout_url: typeof storedRedirect === "string" && storedRedirect.startsWith("https://") ? storedRedirect : null,
        status: String(previousProviderResponse.status ?? "processing"),
        provider,
        amount,
        currency,
        guest: !userId,
        buyer_email: buyerEmail,
        message: "Cette demande existe déjà. Confirmez-la sur votre téléphone ; aucun nouveau paiement n'a été créé."
      }, 200, origin);
    }

    if (foundOrder.status !== "pending") {
      return json({
        error: "La commande est en cours de clôture. Vérifiez son statut avant une nouvelle tentative.",
        new_checkout_required: false
      }, 409, origin);
    }

    try {
      await ensureGuestToken(String(foundOrder.id), Number(existingProduct.download_limit ?? 3));
    } catch (error) {
      console.error("Existing guest token recovery failed:", error instanceof Error ? error.message : "unknown error");
      return json({ error: "Impossible de rétablir la sécurité du téléchargement." }, 500, origin);
    }
  } else {
    const clientIp = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    const rateDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientIp + "|" + buyerEmail));
    const rateKey = [...new Uint8Array(rateDigest)].map(b => b.toString(16).padStart(2, "0")).join("");
    const { data: allowed, error: rateError } = await admin.rpc("allow_guest_checkout", { p_rate_key: rateKey });
    if (rateError || allowed !== true) return json({ error: "Trop de tentatives. Réessayez dans dix minutes." }, 429, origin);

    const { data: availableProduct, error: productError } = await admin
      .from("products")
      .select("id,title,slug,price,sale_price,currency,status,file_path,download_limit")
      .eq("id", productId)
      .eq("status", "published")
      .maybeSingle();

    if (productError || !availableProduct) return json({ error: "Cet eBook n'est pas disponible." }, 404, origin);
    if (!availableProduct.file_path) return json({ error: "Le fichier de cet eBook n'est pas encore configuré." }, 409, origin);

    product = availableProduct;
    amount = Number(availableProduct.sale_price ?? availableProduct.price);
    currency = String(availableProduct.currency ?? "XAF");
    if (!Number.isInteger(amount) || amount < 100 || amount > 10_000_000 || currency !== "XAF") {
      return json({ error: "Le prix de ce produit n'est pas configuré pour le paiement XAF." }, 409, origin);
    }

    const orderNumber = "DDA-" + crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const { data: newOrder, error: orderError } = await admin.from("orders").insert({
      order_number: orderNumber,
      checkout_request_id: checkoutRequestId,
      user_id: userId,
      buyer_email: buyerEmail,
      buyer_phone: normalizedPhone,
      subtotal: amount,
      discount_amount: 0,
      total_amount: amount,
      currency,
      status: "pending"
    }).select("id,order_number,total_amount,currency,user_id,buyer_email,buyer_phone,status").single();

    if (orderError || !newOrder) {
      // A simultaneous request with this same key may have won the unique
      // index race. Ask the browser to retry the same key; it will reuse it.
      console.error("Guest order creation failed:", orderError?.message);
      return json({
        error: "La session d'achat est en cours de création. Relancez exactement la même demande.",
        retryable: true
      }, orderError?.code === "23505" ? 409 : 500, origin);
    }
    order = newOrder;

    const { error: itemError } = await admin.from("order_items").insert({
      order_id: newOrder.id,
      product_id: availableProduct.id,
      title_snapshot: availableProduct.title,
      unit_price: amount,
      quantity: 1,
      subtotal: amount
    });
    if (itemError) {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", newOrder.id);
      console.error("Guest order item creation failed:", itemError.message);
      return json({ error: "Impossible de préparer l'article de cette commande." }, 500, origin);
    }

    const internalReference = "DDA-PAY-" + crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const { data: newPayment, error: paymentError } = await admin.from("payments").insert({
      order_id: newOrder.id,
      user_id: userId,
      provider: dbProvider,
      payment_method: dbProvider,
      transaction_reference: internalReference,
      amount,
      currency,
      status: "pending",
      provider_response: { gateway: "paycentral", environment: gatewayEnvironment }
    }).select("id,order_id,transaction_reference,provider,amount,currency,status,provider_response").single();

    if (paymentError || !newPayment) {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", newOrder.id);
      console.error("Guest payment creation failed:", paymentError?.message);
      return json({ error: "Impossible de préparer le paiement." }, 500, origin);
    }
    payment = newPayment;

    try {
      await ensureGuestToken(String(newOrder.id), Number(availableProduct.download_limit ?? 3));
    } catch (error) {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", newOrder.id);
      await admin.from("payments").update({ status: "failed" }).eq("id", newPayment.id);
      console.error("Guest access setup failed:", error instanceof Error ? error.message : "unknown error");
      return json({ error: "Impossible de sécuriser l'accès à votre achat. Aucun paiement n'a été lancé." }, 500, origin);
    }
  }

  if (!Number.isInteger(amount) || amount < 100 || amount > 10_000_000 || currency !== "XAF") {
    return json({ error: "Le montant de cette commande n'est pas valable pour PayCentral." }, 409, origin);
  }

  const internalReference = String(payment.transaction_reference ?? "").trim();
  if (!internalReference) return json({ error: "Référence de paiement manquante." }, 409, origin);
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
    // A lost response does not prove PayCentral did not create the payment.
    // Keep the order pending and allow a retry using this same reference/key.
    await admin.from("payments").update({
      provider_response: {
        ...previousProviderResponse,
        gateway: "paycentral",
        environment: gatewayEnvironment,
        merchant_reference: internalReference,
        initiation_state: "unknown",
        last_transport_error: error instanceof Error ? error.message : "Network error"
      }
    }).eq("id", payment.id).eq("status", "pending");
    return json({
      error: "PayCentral ne répond pas. La commande est conservée ; relancez la même demande sans recréer l'achat.",
      retryable: true,
      order_number: order.order_number,
      transaction_reference: internalReference
    }, 502, origin);
  }

  // PayCentral returns HTTP 201 for a new operation, HTTP 200 for an
  // idempotent replay, and HTTP 409 when the merchant reference already exists.
  // All three can safely identify the same transaction.
  const gatewayData = gatewayBody.data && typeof gatewayBody.data === "object"
    ? gatewayBody.data as Record<string, unknown>
    : gatewayBody;
  const transactionId = String(gatewayData.transaction_id ?? gatewayBody.transaction_id ?? "").trim();
  const gatewayStatus = String(gatewayData.status ?? gatewayBody.status ?? "processing").toLowerCase();
  const duplicateAccepted = gatewayResponse.status === 409
    && Boolean(transactionId)
    && ["pending", "processing", "success", "succeeded", "paid", "completed"].includes(gatewayStatus);
  const idempotentReplay = gatewayResponse.status === 200
    && gatewayBody.idempotent_replay === true
    && Boolean(transactionId);
  const gatewayAccepted = (gatewayResponse.ok && gatewayBody.success === true && Boolean(transactionId))
    || duplicateAccepted
    || idempotentReplay;

  if (!gatewayAccepted) {
    const gatewayMessage = String(gatewayBody.message ?? "PayCentral n'a pas pu initier le paiement.").slice(0, 240);
    const definiteRejection = [400, 401, 402, 403, 404, 422].includes(gatewayResponse.status);
    if (definiteRejection) {
      await admin.from("payments").update({
        status: "failed",
        provider_response: {
          ...previousProviderResponse,
          gateway: "paycentral",
          environment: gatewayEnvironment,
          merchant_reference: internalReference,
          http_status: gatewayResponse.status,
          response: gatewayBody
        }
      }).eq("id", payment.id).eq("status", "pending");
      await admin.from("orders").update({ status: "failed" }).eq("id", order.id).eq("status", "pending");
    } else {
      // A timeout, 429, 409 without a transaction ID, or 5xx is uncertain.
      // Keep the order pending and repeat with the exact same Idempotency-Key.
      await admin.from("payments").update({
        provider_response: {
          ...previousProviderResponse,
          gateway: "paycentral",
          environment: gatewayEnvironment,
          merchant_reference: internalReference,
          initiation_state: "unknown",
          http_status: gatewayResponse.status,
          response: gatewayBody
        }
      }).eq("id", payment.id).eq("status", "pending");
    }

    return json({
      error: gatewayMessage,
      retryable: !definiteRejection,
      new_checkout_required: definiteRejection,
      order_number: order.order_number,
      transaction_reference: internalReference
    }, definiteRejection ? 422 : 502, origin);
  }

  const redirectValue = gatewayData.redirect_url ?? gatewayData.checkout_url
    ?? gatewayBody.redirect_url ?? gatewayBody.checkout_url;
  const redirectUrl = typeof redirectValue === "string" && redirectValue.startsWith("https://")
    ? redirectValue
    : null;
  const providerReference = gatewayData.provider_reference ?? gatewayBody.provider_reference ?? null;
  const nextProviderResponse = {
    ...previousProviderResponse,
    gateway: "paycentral",
    environment: gatewayEnvironment,
    merchant_reference: internalReference,
    transaction_id: transactionId,
    provider_reference: providerReference,
    status: gatewayStatus,
    provider,
    redirect_url: redirectUrl,
    initiation_response: gatewayBody
  };

  const { error: saveError } = await admin.from("payments").update({
    provider_response: nextProviderResponse
  }).eq("id", payment.id).eq("status", "pending");

  if (saveError) {
    console.error("PayCentral accepted payment but transaction ID save failed:", saveError.message);
    return json({
      error: "PayCentral a accepté la demande, mais son enregistrement doit être vérifié. Ne recréez pas la commande.",
      retryable: true,
      order_number: order.order_number,
      transaction_reference: internalReference,
      transaction_id: transactionId
    }, 502, origin);
  }

  const checkoutUrlValue = gatewayData.checkout_url ?? gatewayData.redirect_url
    ?? gatewayBody.checkout_url ?? gatewayBody.redirect_url;
  return json({
    ok: true,
    order_number: order.order_number,
    merchant_reference: internalReference,
    already_initiated: Boolean(duplicateAccepted || idempotentReplay),
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
