import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const GUEST_TOKEN_ENCRYPTION_KEY = Deno.env.get("GUEST_TOKEN_ENCRYPTION_KEY") ?? "";

const NKAP_BASE = "https://pay.ltcgroup.site/api/v1";
const NKAP_API_KEY = Deno.env.get("NKAP_API_KEY") ?? "";
const NKAP_API_SECRET = Deno.env.get("NKAP_API_SECRET") ?? "";

const MONERAILS_BASE = "https://api.monerails.com/v1";
const MONERAILS_API_KEY = Deno.env.get("MONERAILS_API_KEY") ?? "";

const SITE_URL = "https://dora-digital-academy-1mvr.vercel.app";
const NKAP_WEBHOOK_URL = "https://wtbxjqamwitwogxdrkwd.supabase.co/functions/v1/nkap-webhook";

type JsonObject = Record<string, unknown>;

function json(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin || SITE_URL,
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      "vary": "Origin"
    }
  });
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function allowedOrigin(origin: string) {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "dora-digital-academy-1mvr.vercel.app"
      || (host.startsWith("dora-digital-academy-1mvr-") && host.endsWith("-dorajospeh-oss.vercel.app"))
      || host === "localhost";
  } catch {
    return false;
  }
}

function providerEnvironment(provider: "nkap" | "monerails") {
  const key = provider === "nkap" ? NKAP_API_KEY : MONERAILS_API_KEY;
  if (provider === "nkap") {
    if (key.startsWith("ltcpay_test_")) return "test";
    if (key.startsWith("ltcpay_live_")) return "live";
  } else {
    if (key.startsWith("mr_test_")) return "test";
    if (key.startsWith("mr_live_")) return "live";
  }
  return "unknown";
}

function safeError(data: JsonObject, fallback: string) {
  const errorObject = object(data.error);
  return String(errorObject.message ?? data.detail ?? data.message ?? fallback).slice(0, 300);
}

async function createGuestToken(admin: any, orderId: string, downloadLimit: number) {
  if (!GUEST_TOKEN_ENCRYPTION_KEY) throw new Error("GUEST_TOKEN_ENCRYPTION_KEY est absent.");

  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  const keyBytes = Uint8Array.from(atob(GUEST_TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
  if (keyBytes.length !== 32) throw new Error("La clé de chiffrement doit contenir 32 octets.");

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

  const { error } = await admin.from("guest_order_tokens").insert({
    order_id: orderId,
    token_hash: tokenHash,
    encrypted_token: base64(new Uint8Array(encrypted)),
    encryption_iv: base64(iv),
    max_downloads: Math.max(1, Math.min(100, downloadLimit || 3))
  });
  if (error) throw error;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (!allowedOrigin(origin)) return json({ error: "Origine non autorisée." }, 403, origin);
  if (req.method === "OPTIONS") return json({ ok: true }, 200, origin);
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405, origin);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return json({ error: "Configuration Supabase incomplète." }, 503, origin);
  }

  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  let userId: string | null = null;
  let buyerEmailFromAuth = "";
  if (bearer && bearer !== ANON_KEY) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: "Bearer " + bearer } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await userClient.auth.getUser();
    if (error || !data.user) return json({ error: "Session invalide. Reconnectez-vous." }, 401, origin);
    userId = data.user.id;
    buyerEmailFromAuth = String(data.user.email ?? "");
  }

  let input: JsonObject;
  try { input = await req.json() as JsonObject; }
  catch { return json({ error: "Requête JSON invalide." }, 400, origin); }

  const productId = String(input.product_id ?? "").trim();
  const providerChoice = String(input.provider ?? "").trim().toLowerCase();
  const email = String(input.email ?? buyerEmailFromAuth).trim().toLowerCase();
  const checkoutRequestId = String(input.checkout_request_id ?? "").trim();
  const rawPhone = String(input.phone ?? "").trim();
  const normalizedPhone = rawPhone.replace(/[\s().-]/g, "");
  const operator = providerChoice === "monerails_airtel" ? "AIRTEL"
    : providerChoice === "monerails_moov" ? "MOOV" : "";
  const gateway: "nkap" | "monerails" | "" = providerChoice === "nkap" ? "nkap"
    : operator ? "monerails" : "";

  if (!gateway) return json({ error: "Sélectionnez Nkap Pay ou Monerails." }, 400, origin);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
    return json({ error: "Identifiant du produit invalide." }, 400, origin);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ error: "Adresse e-mail invalide." }, 400, origin);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutRequestId)) {
    return json({ error: "Session d'achat invalide. Recommencez le paiement." }, 400, origin);
  }
  if (gateway === "monerails" && !/^\+[1-9][0-9]{7,14}$/.test(normalizedPhone)) {
    return json({ error: "Monerails exige un numéro Mobile Money au format international, par exemple +23562123456." }, 400, origin);
  }

  const environment = providerEnvironment(gateway);
  if (environment === "unknown") {
    return json({
      error: gateway === "nkap"
        ? "Configurez NKAP_API_KEY et NKAP_API_SECRET dans les secrets Supabase."
        : "Configurez MONERAILS_API_KEY dans les secrets Supabase.",
      setup_required: true
    }, 503, origin);
  }
  if (environment === "live" && Deno.env.get(gateway === "nkap" ? "NKAP_ALLOW_LIVE" : "MONERAILS_ALLOW_LIVE") !== "true") {
    return json({ error: "Les encaissements réels sont verrouillés. Le mode test doit être validé avant toute activation live." }, 503, origin);
  }
  if (gateway === "nkap" && !Deno.env.get("NKAP_WEBHOOK_SECRET")) {
    return json({ error: "Configurez NKAP_WEBHOOK_SECRET avant de créer un paiement." }, 503, origin);
  }
  if (!GUEST_TOKEN_ENCRYPTION_KEY) {
    return json({ error: "La clé de chiffrement des téléchargements invités est absente." }, 503, origin);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const rateDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode((req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown") + "|" + email)
  );
  const rateKey = [...new Uint8Array(rateDigest)].map(b => b.toString(16).padStart(2, "0")).join("");
  const { data: allowed, error: rateError } = await admin.rpc("allow_guest_checkout", { p_rate_key: rateKey });
  if (rateError || allowed !== true) return json({ error: "Trop de tentatives. Réessayez dans dix minutes." }, 429, origin);

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id,title,price,sale_price,currency,status,file_path,download_limit")
    .eq("id", productId)
    .eq("status", "published")
    .maybeSingle();
  if (productError || !product || !product.file_path) {
    return json({ error: "Ce produit n'est pas disponible à l'achat." }, 404, origin);
  }

  const amount = Math.round(Number(product.sale_price ?? product.price));
  const currency = String(product.currency ?? "XAF").toUpperCase();
  if (!Number.isInteger(amount) || amount < 100 || amount > 5_000_000 || currency !== "XAF") {
    return json({ error: "Le prix du produit doit être un montant entier en XAF compris entre 100 et 5 000 000." }, 409, origin);
  }

  const { data: existingOrder, error: existingError } = await admin
    .from("orders")
    .select("id,order_number,user_id,buyer_email,buyer_phone,status")
    .eq("checkout_request_id", checkoutRequestId)
    .maybeSingle();
  if (existingError) return json({ error: "Impossible de vérifier la session d'achat." }, 500, origin);

  let order: JsonObject;
  let payment: JsonObject;
  let internalReference = "";

  if (existingOrder) {
    if ((existingOrder.user_id ?? null) !== userId
      || String(existingOrder.buyer_email ?? "").toLowerCase() !== email) {
      return json({ error: "Cette session d'achat appartient à une autre commande." }, 409, origin);
    }
    const { data: item } = await admin.from("order_items").select("product_id").eq("order_id", existingOrder.id).limit(1).maybeSingle();
    if (item?.product_id !== productId) return json({ error: "Cette session a déjà été utilisée pour un autre produit." }, 409, origin);

    const { data: priorPayment, error: paymentError } = await admin
      .from("payments")
      .select("id,order_id,provider,payment_method,transaction_reference,amount,currency,status,provider_response,created_at")
      .eq("order_id", existingOrder.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (paymentError || !priorPayment) return json({ error: "Tentative de paiement introuvable." }, 409, origin);
    if (priorPayment.provider !== gateway) return json({ error: "Cette session utilise déjà une autre passerelle." }, 409, origin);
    if (priorPayment.status === "confirmed" || existingOrder.status === "paid") {
      return json({ ok: true, already_paid: true, order_number: existingOrder.order_number, message: "Cette commande est déjà payée." }, 200, origin);
    }
    if (priorPayment.status !== "pending") {
      return json({ error: "La tentative précédente est clôturée. Relancez un nouvel achat.", new_checkout_required: true }, 409, origin);
    }
    const providerResponse = object(priorPayment.provider_response);
    const externalId = String(providerResponse.gateway_reference ?? "").trim();
    if (externalId) {
      return json({
        ok: true,
        already_initiated: true,
        order_number: existingOrder.order_number,
        transaction_reference: priorPayment.transaction_reference,
        checkout_url: String(providerResponse.payment_url ?? providerResponse.redirect_url ?? "") || null,
        gateway_reference: externalId,
        status: String(providerResponse.status ?? "pending"),
        next_action: providerResponse.next_action ?? null,
        requires_otp: providerResponse.requires_otp === true,
        amount,
        currency,
        provider: gateway,
        message: "Cette demande existe déjà. Aucun nouveau paiement n'a été créé."
      }, 200, origin);
    }
    if (providerResponse.initiation_state === "starting" || providerResponse.initiation_state === "unknown") {
      return json({
        error: "Le prestataire n'a pas encore confirmé la création de la demande. Pour éviter un double débit, ne relancez pas une deuxième tentative. Vérifiez l'état de la commande dans quelques instants.",
        retryable: false,
        order_number: existingOrder.order_number,
        transaction_reference: priorPayment.transaction_reference
      }, 409, origin);
    }
    order = existingOrder;
    payment = priorPayment;
    internalReference = String(priorPayment.transaction_reference);
  } else {
    const orderNumber = "DDA-" + crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const buyerPhone = gateway === "monerails" ? normalizedPhone : null;
    const { data: newOrder, error: orderError } = await admin.from("orders").insert({
      order_number: orderNumber,
      checkout_request_id: checkoutRequestId,
      user_id: userId,
      buyer_email: email,
      buyer_phone: buyerPhone,
      subtotal: amount,
      discount_amount: 0,
      total_amount: amount,
      currency,
      status: "pending"
    }).select("id,order_number,user_id,buyer_email,buyer_phone,total_amount,currency,status").single();
    if (orderError || !newOrder) {
      console.error("Alternate gateway order creation failed:", orderError?.message);
      return json({ error: "Impossible de créer la commande. Réessayez sans actualiser la page.", retryable: true }, 500, origin);
    }
    order = newOrder;

    const { error: itemError } = await admin.from("order_items").insert({
      order_id: newOrder.id,
      product_id: product.id,
      title_snapshot: product.title,
      unit_price: amount,
      quantity: 1,
      subtotal: amount
    });
    if (itemError) {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", newOrder.id);
      return json({ error: "Impossible d'ajouter le produit à la commande." }, 500, origin);
    }

    internalReference = "DDA-" + crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase();
    const { data: newPayment, error: newPaymentError } = await admin.from("payments").insert({
      order_id: newOrder.id,
      user_id: userId,
      provider: gateway,
      payment_method: gateway === "nkap" ? "BANK_CARD" : operator,
      transaction_reference: internalReference,
      amount,
      currency,
      status: "pending",
      provider_response: {
        gateway,
        environment,
        merchant_reference: internalReference,
        initiation_state: "starting"
      }
    }).select("id,order_id,provider,transaction_reference,amount,currency,status,provider_response").single();

    if (newPaymentError || !newPayment) {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", newOrder.id);
      return json({ error: "Impossible d'enregistrer la demande de paiement." }, 500, origin);
    }
    payment = newPayment;

    try {
      await createGuestToken(admin, String(newOrder.id), Number(product.download_limit ?? 3));
    } catch (error) {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", newOrder.id);
      await admin.from("payments").update({ status: "failed" }).eq("id", newPayment.id);
      console.error("Alternate guest token creation failed:", error instanceof Error ? error.message : "unknown error");
      return json({ error: "Impossible de préparer l'accès sécurisé au produit." }, 500, origin);
    }
  }

  const paymentId = String(payment.id);
  await admin.from("payments").update({
    provider_response: {
      gateway,
      environment,
      merchant_reference: internalReference,
      initiation_state: "starting",
      initiated_at: new Date().toISOString()
    }
  }).eq("id", paymentId).eq("status", "pending");

  let gatewayResponse: Response;
  let gatewayBody: JsonObject;
  let gatewayReference = "";
  let checkoutUrl: string | null = null;
  let gatewayStatus = "pending";
  let nextAction: JsonObject | null = null;

  try {
    if (gateway === "nkap") {
      gatewayResponse = await fetch(NKAP_BASE + "/payments", {
        method: "POST",
        headers: {
          "X-API-Key": NKAP_API_KEY,
          "X-API-Secret": NKAP_API_SECRET,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          amount,
          currency: "XAF",
          merchant_reference: internalReference,
          description: ("DORA DIGITAL ACADEMY - " + String(product.title)).slice(0, 450),
          payment_method: "BANK_CARD",
          country: "TD",
          customer_info: { email },
          callback_url: NKAP_WEBHOOK_URL,
          return_url: SITE_URL + "/?payment_return=1&order=" + encodeURIComponent(String(order.order_number))
        }),
        signal: AbortSignal.timeout(25000)
      });
      gatewayBody = await gatewayResponse.json().catch(() => ({})) as JsonObject;
      const nkapData = object(gatewayBody.data ?? gatewayBody);
      gatewayReference = String(nkapData.reference ?? "").trim();
      checkoutUrl = String(nkapData.payment_url ?? "").trim() || null;
      gatewayStatus = String(nkapData.status ?? "PENDING").toLowerCase();
      if (!gatewayResponse.ok || !gatewayReference || !checkoutUrl || !/^https:\/\//.test(checkoutUrl)) {
        const message = safeError(gatewayBody, "Nkap n'a pas retourné de page de paiement valide.");
        const definite = gatewayResponse.status >= 400 && gatewayResponse.status < 500;
        if (definite) {
          await admin.from("payments").update({ status: "failed", provider_response: { gateway, environment, merchant_reference: internalReference, error: message, http_status: gatewayResponse.status } }).eq("id", paymentId);
          await admin.from("orders").update({ status: "failed" }).eq("id", order.id);
        } else {
          await admin.from("payments").update({ provider_response: { gateway, environment, merchant_reference: internalReference, initiation_state: "unknown", error: message, http_status: gatewayResponse.status } }).eq("id", paymentId);
        }
        return json({ error: message, order_number: order.order_number, retryable: !definite, new_checkout_required: definite }, definite ? 422 : 502, origin);
      }

      const stored = {
        gateway, environment, merchant_reference: internalReference,
        gateway_reference: gatewayReference, payment_url: checkoutUrl,
        status: gatewayStatus, provider_response: gatewayBody,
        initiation_state: "initiated"
      };
      await admin.from("payments").update({ provider_response: stored }).eq("id", paymentId).eq("status", "pending");
      return json({
        ok: true,
        provider: gateway,
        order_number: order.order_number,
        transaction_reference: internalReference,
        gateway_reference: gatewayReference,
        checkout_url: checkoutUrl,
        status: gatewayStatus,
        amount, currency,
        message: "Ouverture de la page Nkap Pay. Le client y choisira son moyen de paiement."
      }, 200, origin);
    }

    const operatorResponse = await fetch(MONERAILS_BASE + "/operators?currency=XAF&country=TD", {
      headers: { "Authorization": "Bearer " + MONERAILS_API_KEY, "Accept": "application/json", "Accept-Language": "fr" },
      signal: AbortSignal.timeout(15000)
    });
    const operatorBody = await operatorResponse.json().catch(() => ({})) as JsonObject;
    const operatorData = object(operatorBody.data ?? operatorBody);
    const operatorList = Array.isArray(operatorBody) ? operatorBody : Array.isArray(operatorData.operators) ? operatorData.operators : [];
    const operatorEntry = operatorList.find((entry: unknown) => String(object(entry).code ?? "").toUpperCase() === operator);
    if (!operatorResponse.ok || !operatorEntry || object(operatorEntry).available === false) {
      const message = safeError(operatorBody, operator + " n'est pas ouvert sur votre compte Monerails pour le Tchad.");
      await admin.from("payments").update({ status: "failed", provider_response: { gateway, environment, merchant_reference: internalReference, error: message } }).eq("id", paymentId);
      await admin.from("orders").update({ status: "failed" }).eq("id", order.id);
      return json({ error: message, new_checkout_required: true }, 422, origin);
    }

    gatewayResponse = await fetch(MONERAILS_BASE + "/collections", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + MONERAILS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Language": "fr",
        "Idempotency-Key": internalReference
      },
      body: JSON.stringify({
        amount,
        currency: "XAF",
        phone: normalizedPhone.slice(1),
        operator,
        country: "TD",
        customer: { name: "Client DORA" },
        description: ("DORA DIGITAL ACADEMY - " + String(product.title)).slice(0, 450),
        client_reference: internalReference,
        metadata: { order_id: order.id, payment_id: paymentId, source: "dda_site" }
      }),
      signal: AbortSignal.timeout(25000)
    });
    gatewayBody = await gatewayResponse.json().catch(() => ({})) as JsonObject;
    const collection = object(gatewayBody.data ?? gatewayBody);
    gatewayReference = String(collection.id ?? "").trim();
    gatewayStatus = String(collection.status ?? "pending").toLowerCase();
    nextAction = object(collection.next_action);
    const accepted = (gatewayResponse.status === 201 || gatewayResponse.status === 202)
      && Boolean(gatewayReference);

    if (!accepted) {
      const message = safeError(gatewayBody, "Monerails n'a pas pu créer l'encaissement.");
      const definite = gatewayResponse.status >= 400 && gatewayResponse.status < 500 && gatewayResponse.status !== 429;
      if (definite) {
        await admin.from("payments").update({ status: "failed", provider_response: { gateway, environment, merchant_reference: internalReference, error: message, http_status: gatewayResponse.status } }).eq("id", paymentId);
        await admin.from("orders").update({ status: "failed" }).eq("id", order.id);
      } else {
        await admin.from("payments").update({ provider_response: { gateway, environment, merchant_reference: internalReference, initiation_state: "unknown", error: message, http_status: gatewayResponse.status } }).eq("id", paymentId);
      }
      return json({ error: message, order_number: order.order_number, retryable: !definite, new_checkout_required: definite }, definite ? 422 : 502, origin);
    }

    const redirect = String(nextAction?.url ?? "").trim();
    const requiresOtp = gatewayStatus === "requires_otp" || String(nextAction?.type ?? "") === "otp";
    const stored = {
      gateway, environment, merchant_reference: internalReference,
      gateway_reference: gatewayReference, status: gatewayStatus,
      next_action: nextAction, provider_response: gatewayBody,
      requires_otp: requiresOtp,
      redirect_url: /^https:\/\//.test(redirect) ? redirect : null,
      initiation_state: "initiated"
    };
    await admin.from("payments").update({ provider_response: stored }).eq("id", paymentId).eq("status", "pending");

    return json({
      ok: true,
      provider: gateway,
      order_number: order.order_number,
      transaction_reference: internalReference,
      gateway_reference: gatewayReference,
      checkout_url: stored.redirect_url,
      status: gatewayStatus,
      next_action: nextAction,
      requires_otp: requiresOtp,
      amount, currency,
      message: String(nextAction?.message ?? "Demande envoyée. Validez le paiement sur votre téléphone.")
    }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur réseau inconnue";
    await admin.from("payments").update({
      provider_response: {
        gateway, environment, merchant_reference: internalReference,
        initiation_state: "unknown", network_error: message
      }
    }).eq("id", paymentId).eq("status", "pending");
    console.error("Alternate gateway initiation error:", message);
    return json({
      error: "La passerelle n'a pas confirmé la création de la demande. Votre commande est conservée ; ne relancez pas un nouveau paiement avant vérification.",
      retryable: false,
      order_number: order.order_number,
      transaction_reference: internalReference
    }, 502, origin);
  }
});
