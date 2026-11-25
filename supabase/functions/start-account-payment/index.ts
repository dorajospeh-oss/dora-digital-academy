import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const PAYCENTRAL_API_KEY = Deno.env.get("PAYCENTRAL_API_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("PAYCENTRAL_WEBHOOK_SECRET") ?? "";
const PAYCENTRAL_URL = "https://api-paycentral.gabondunumerique.com/api/v1";
const CALLBACK_URL = "https://wtbxjqamwitwogxdrkwd.supabase.co/functions/v1/payment-webhook";
const PRODUCTION_HOST = "dora-digital-academy-1mvr.vercel.app";

type JsonObject = Record<string, unknown>;

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
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      "vary": "Origin"
    }
  });
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function safeMessage(value: unknown, fallback: string) {
  const message = String(value ?? "").trim();
  return message.length > 0 ? message.slice(0, 240) : fallback;
}

function payCentralEnvironment() {
  if (PAYCENTRAL_API_KEY.startsWith("sk_live_")) return "live";
  if (PAYCENTRAL_API_KEY.startsWith("sk_sandbox_")) return "sandbox";
  return "unknown";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (!allowedOrigin(origin)) return json({ error: "Origine non autorisée." }, 403, origin);
  if (req.method === "OPTIONS") return json({ ok: true }, 200, origin);
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405, origin);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return json({ error: "Configuration serveur Supabase incomplète." }, 503, origin);
  }
  if (!PAYCENTRAL_API_KEY || payCentralEnvironment() === "unknown") {
    return json({ error: "Clé API PayCentral absente ou de format non reconnu." }, 503, origin);
  }
  if (!WEBHOOK_SECRET) {
    return json({ error: "Le secret du webhook PayCentral n'est pas configuré." }, 503, origin);
  }

  const authorization = req.headers.get("authorization") ?? "";
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const bearer = bearerMatch?.[1]?.trim() ?? "";
  if (!bearer) return json({ error: "Connectez-vous avec le compte ayant passé la commande." }, 401, origin);

  let input: JsonObject;
  try {
    input = await req.json() as JsonObject;
  } catch {
    return json({ error: "Requête JSON invalide." }, 400, origin);
  }

  const orderId = String(input.order_id ?? "").trim();
  const requestedProvider = String(input.provider ?? "").trim().toLowerCase();
  const rawPhone = String(input.phone ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
    return json({ error: "Identifiant de commande invalide." }, 400, origin);
  }
  if (!["orange_money", "airtel_money", "moov_money"].includes(requestedProvider)) {
    return json({ error: "Choisissez Orange Money, Airtel Money ou Moov Money." }, 400, origin);
  }

  const normalizedPhone = rawPhone.replace(/[\s().-]/g, "");
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalizedPhone)) {
    return json({ error: "Entrez un numéro Mobile Money au format international, avec + et l'indicatif du pays." }, 400, origin);
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: "Bearer " + bearer } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(bearer);
  if (userError || !userData.user) {
    return json({ error: "Session invalide. Reconnectez-vous." }, 401, origin);
  }
  const user = userData.user;

  // This RPC locks the order and creates or reuses one pending payment attempt.
  // Repeated requests therefore receive the same payment row and reference.
  const { data: startedData, error: startError } = await userClient.rpc("start_payment", {
    p_order_id: orderId,
    p_provider: requestedProvider,
    p_payment_method: requestedProvider
  });
  if (startError) {
    const msg = startError.message || "Impossible de préparer le paiement.";
    return json({ error: msg }, /introuvable|non payable|déjà en cours|authentification/i.test(msg) ? 409 : 400, origin);
  }

  const startedPayment = Array.isArray(startedData) ? startedData[0] : startedData;
  const paymentId = String(asObject(startedPayment).id ?? "");
  if (!paymentId) return json({ error: "La base de données n'a pas retourné de référence de paiement." }, 500, origin);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select("id,order_id,user_id,provider,transaction_reference,amount,currency,status,provider_response")
    .eq("id", paymentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (paymentError || !payment) {
    console.error("Account payment lookup failed:", paymentError?.message ?? "payment not found");
    return json({ error: "Impossible de retrouver votre tentative de paiement." }, 500, origin);
  }
  if (payment.order_id !== orderId || payment.user_id !== user.id) {
    return json({ error: "Cette commande ne correspond pas à votre compte." }, 403, origin);
  }
  if (payment.status !== "pending") {
    return json({ error: "Cette tentative de paiement n'est plus en attente." }, 409, origin);
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,order_number,user_id,total_amount,currency,status,buyer_email,buyer_phone")
    .eq("id", orderId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (orderError || !order) {
    console.error("Account order lookup failed:", orderError?.message ?? "order not found");
    return json({ error: "Commande introuvable pour ce compte." }, 404, origin);
  }
  if (["failed", "cancelled"].includes(String(order.status))) {
    // start_payment() creates a replacement attempt only after the late-success
    // protection window has passed (or the old attempt never reached PayCentral).
    const { data: reopenedOrder, error: reopenError } = await admin
      .from("orders")
      .update({ status: "pending" })
      .eq("id", orderId)
      .eq("user_id", user.id)
      .eq("status", order.status)
      .select("id,order_number,user_id,total_amount,currency,status,buyer_email,buyer_phone")
      .maybeSingle();

    if (reopenError || !reopenedOrder) {
      const { data: latestOrder } = await admin
        .from("orders")
        .select("status")
        .eq("id", orderId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (latestOrder?.status !== "pending") {
        return json({ error: "La commande a changé d'état. Actualisez la page avant de payer." }, 409, origin);
      }
      order.status = "pending";
    } else {
      Object.assign(order, reopenedOrder);
    }
  }

  if (order.status !== "pending") {
    return json({ error: "Cette commande n'est pas payable." }, 409, origin);
  }

  const amount = Number(order.total_amount);
  const paymentAmount = Number(payment.amount);
  const currency = String(order.currency ?? "").toUpperCase();
  if (!Number.isInteger(amount) || amount < 100 || amount > 10_000_000 || amount !== paymentAmount || currency !== "XAF" || String(payment.currency).toUpperCase() !== currency) {
    return json({ error: "Le montant ou la devise de cette commande ne peut pas être transmis à PayCentral." }, 409, origin);
  }

  const { data: orderItems, error: itemsError } = await admin
    .from("order_items")
    .select("id")
    .eq("order_id", orderId)
    .limit(1);
  if (itemsError || !orderItems?.length) {
    return json({ error: "Cette commande ne contient aucun article payable." }, 409, origin);
  }

  const buyerEmail = String(order.buyer_email ?? user.email ?? "").trim().toLowerCase();
  const { error: contactError } = await admin
    .from("orders")
    .update({ buyer_email: buyerEmail || null, buyer_phone: normalizedPhone })
    .eq("id", orderId)
    .eq("user_id", user.id);
  if (contactError) {
    console.error("Could not save account checkout contact:", contactError.message);
    return json({ error: "Impossible d'enregistrer les coordonnées de paiement." }, 500, origin);
  }

  const dbProvider = String(payment.provider ?? "").toLowerCase();
  const providerMap: Record<string, string> = {
    orange_money: "orange",
    airtel_money: "airtel",
    moov_money: "moov"
  };
  const provider = providerMap[dbProvider];
  if (!provider) return json({ error: "Prestataire de paiement non pris en charge." }, 409, origin);

  const existingResponse = asObject(payment.provider_response);
  const existingTransactionId = String(existingResponse.transaction_id ?? "").trim();
  if (existingTransactionId) {
    const storedRedirect = existingResponse.redirect_url ?? existingResponse.checkout_url ?? null;
    return json({
      ok: true,
      order_number: order.order_number,
      transaction_reference: payment.transaction_reference,
      transaction_id: existingTransactionId,
      checkout_url: typeof storedRedirect === "string" && storedRedirect.startsWith("https://") ? storedRedirect : null,
      status: String(existingResponse.status ?? "processing"),
      provider,
      amount,
      currency,
      environment: String(existingResponse.environment ?? payCentralEnvironment()),
      message: "Cette demande de paiement a déjà été transmise. Confirmez-la sur votre téléphone."
    }, 200, origin);
  }

  const merchantReference = String(payment.transaction_reference ?? "").trim();
  if (!merchantReference || merchantReference.length > 100) {
    return json({ error: "Référence interne de paiement invalide." }, 409, origin);
  }

  const environment = payCentralEnvironment();
  const initiatedAt = new Date().toISOString();
  const { error: markError } = await admin
    .from("payments")
    .update({
      provider_response: {
        ...existingResponse,
        gateway: "paycentral",
        environment,
        merchant_reference: merchantReference,
        initiation_started_at: initiatedAt
      }
    })
    .eq("id", payment.id)
    .eq("status", "pending");

  if (markError) {
    console.error("Could not mark account payment initiation:", markError.message);
    return json({ error: "Impossible de préparer la demande auprès du prestataire." }, 500, origin);
  }

  let gatewayResponse: Response;
  let gatewayBody: JsonObject;
  try {
    gatewayResponse = await fetch(PAYCENTRAL_URL + "/payment/initiate", {
      method: "POST",
      headers: {
        "X-Api-Key": PAYCENTRAL_API_KEY,
        "Idempotency-Key": merchantReference,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount,
        currency,
        phone: normalizedPhone,
        provider,
        description: "DORA DIGITAL ACADEMY — " + String(order.order_number).slice(0, 80),
        merchant_reference: merchantReference,
        callback_url: CALLBACK_URL,
        expires_in: 60,
        metadata: {
          order_id: orderId,
          payment_id: payment.id,
          user_id: user.id,
          source: "dda_account_checkout"
        }
      }),
      signal: AbortSignal.timeout(20000)
    });
    gatewayBody = await gatewayResponse.json().catch(() => ({})) as JsonObject;
  } catch (error) {
    const transportError = error instanceof Error ? error.message : "Network error";
    await admin.from("payments").update({
      provider_response: {
        gateway: "paycentral",
        environment,
        merchant_reference: merchantReference,
        initiation_state: "unknown",
        last_transport_error: transportError,
        last_attempt_at: initiatedAt
      }
    }).eq("id", payment.id);
    // Keep the attempt pending. A retry uses the same merchant reference and
    // Idempotency-Key, so a late gateway response cannot cause a second charge.
    return json({
      error: "La réponse de PayCentral est incertaine. Votre commande est conservée; relancez la vérification sans recréer la commande.",
      retryable: true,
      transaction_reference: merchantReference
    }, 502, origin);
  }

  const gatewayData = gatewayBody.data && typeof gatewayBody.data === "object"
    ? gatewayBody.data as JsonObject
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
    const gatewayMessage = safeMessage(gatewayBody.message, "PayCentral n'a pas pu initier le paiement.");
    const definiteClientRejection = gatewayResponse.status >= 400
      && gatewayResponse.status < 500
      && gatewayResponse.status !== 409;

    if (definiteClientRejection) {
      const { error: updateError } = await admin.from("payments").update({
        status: "failed",
        provider_response: {
          gateway: "paycentral",
          environment,
          merchant_reference: merchantReference,
          http_status: gatewayResponse.status,
          response: gatewayBody
        }
      }).eq("id", payment.id);
      if (updateError) console.error("Could not save rejected payment:", updateError.message);
    } else {
      // A gateway timeout/5xx/ambiguous 409 is not proof that no transaction
      // exists. Keep it pending and retry only with this same reference.
      const { error: updateError } = await admin.from("payments").update({
        provider_response: {
          gateway: "paycentral",
          environment,
          merchant_reference: merchantReference,
          initiation_state: "unknown",
          http_status: gatewayResponse.status,
          response: gatewayBody
        }
      }).eq("id", payment.id);
      if (updateError) console.error("Could not save uncertain payment state:", updateError.message);
    }

    return json({
      error: gatewayMessage,
      retryable: !definiteClientRejection,
      transaction_reference: merchantReference
    }, definiteClientRejection ? 422 : 502, origin);
  }

  const redirectValue = gatewayData.redirect_url ?? gatewayData.checkout_url
    ?? gatewayBody.redirect_url ?? gatewayBody.checkout_url;
  const redirectUrl = typeof redirectValue === "string" && redirectValue.startsWith("https://")
    ? redirectValue
    : null;
  const providerReference = gatewayData.provider_reference ?? gatewayBody.provider_reference ?? null;

  const { error: saveError } = await admin
    .from("payments")
    .update({
      provider_response: {
        gateway: "paycentral",
        environment,
        merchant_reference: merchantReference,
        transaction_id: transactionId,
        provider_reference: providerReference,
        status: gatewayStatus,
        provider,
        redirect_url: redirectUrl,
        initiation_response: gatewayBody
      }
    })
    .eq("id", payment.id)
    .eq("status", "pending");

  if (saveError) {
    console.error("PayCentral payment accepted but transaction ID save failed:", saveError.message);
    return json({
      error: "PayCentral a accepté la demande, mais son enregistrement doit être vérifié. Ne relancez pas un nouvel achat.",
      retryable: true,
      transaction_reference: merchantReference,
      transaction_id: transactionId
    }, 502, origin);
  }

  return json({
    ok: true,
    order_number: order.order_number,
    transaction_reference: merchantReference,
    transaction_id: transactionId,
    checkout_url: redirectUrl,
    status: gatewayStatus,
    provider,
    amount,
    currency,
    environment,
    message: safeMessage(gatewayData.message ?? gatewayBody.message, "Demande envoyée. Confirmez le paiement sur votre téléphone.")
  }, 200, origin);
});
