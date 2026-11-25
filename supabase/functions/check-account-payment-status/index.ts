import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const PAYCENTRAL_API_KEY = Deno.env.get("PAYCENTRAL_API_KEY") ?? "";
const PRODUCTION_HOST = "dora-digital-academy-1mvr.vercel.app";
const PAYCENTRAL_URL = "https://api-paycentral.gabondunumerique.com/api/v1";

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

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (!allowedOrigin(origin)) return json({ error: "Origine non autorisée." }, 403, origin);
  if (req.method === "OPTIONS") return json({ ok: true }, 200, origin);
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405, origin);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return json({ error: "Configuration serveur Supabase incomplète." }, 503, origin);
  }
  if (!PAYCENTRAL_API_KEY) {
    return json({ error: "Clé API PayCentral absente." }, 503, origin);
  }

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return json({ error: "Connectez-vous pour vérifier cette commande." }, 401, origin);

  let input: JsonObject;
  try {
    input = await req.json() as JsonObject;
  } catch {
    return json({ error: "Requête JSON invalide." }, 400, origin);
  }

  const orderId = String(input.order_id ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
    return json({ error: "Identifiant de commande invalide." }, 400, origin);
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: "Bearer " + bearer } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: authError } = await userClient.auth.getUser(bearer);
  if (authError || !userData.user) return json({ error: "Session invalide. Reconnectez-vous." }, 401, origin);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const userId = userData.user.id;

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,order_number,user_id,total_amount,currency,status")
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();
  if (orderError || !order) return json({ error: "Commande introuvable pour ce compte." }, 404, origin);

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select("id,order_id,user_id,provider,transaction_reference,amount,currency,status,provider_response,created_at")
    .eq("order_id", orderId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentError) return json({ error: "Impossible de lire le paiement." }, 500, origin);
  if (!payment) {
    return json({ ok: true, order_status: order.status, payment_status: "not_started", message: "Aucun paiement n'a encore été lancé." }, 200, origin);
  }
  if (payment.status === "confirmed") {
    return json({ ok: true, order_status: order.status, payment_status: payment.status, message: "Paiement déjà confirmé." }, 200, origin);
  }

  const storedResponse = object(payment.provider_response);
  const transactionId = String(storedResponse.transaction_id ?? "").trim();
  if (!transactionId) {
    return json({
      ok: true,
      order_status: order.status,
      payment_status: payment.status,
      awaiting_gateway_reference: true,
      message: "La demande est en cours d'enregistrement chez le prestataire. Réessayez dans quelques instants."
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
    console.error("PayCentral status query failed:", error instanceof Error ? error.message : "Network error");
    return json({ error: "PayCentral est momentanément injoignable. Le paiement n'a pas été modifié.", retryable: true }, 502, origin);
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
  const gatewayProvider = String(gatewayData.provider ?? "").toLowerCase();
  const expectedAmount = Number(payment.amount);
  const expectedCurrency = String(payment.currency ?? "").toUpperCase();
  const expectedProvider: Record<string, string> = {
    orange_money: "orange",
    airtel_money: "airtel",
    moov_money: "moov"
  };
  const status = String(gatewayData.status ?? "").toLowerCase();

  if (receivedId && receivedId !== transactionId) {
    return json({ error: "Identifiant de transaction incohérent. Aucun statut n'a été appliqué." }, 409, origin);
  }
  if (!merchantReference || merchantReference !== payment.transaction_reference) {
    return json({ error: "Référence marchand incohérente. Aucun statut n'a été appliqué." }, 409, origin);
  }
  if (!Number.isFinite(amount) || amount !== expectedAmount || currency !== expectedCurrency || expectedCurrency !== "XAF") {
    return json({ error: "Le montant ou la devise PayCentral ne correspond pas à la commande." }, 409, origin);
  }
  if (expectedProvider[payment.provider] && gatewayProvider !== expectedProvider[payment.provider]) {
    return json({ error: "L'opérateur confirmé par PayCentral ne correspond pas au moyen choisi." }, 409, origin);
  }

  if (!["success", "failed", "cancelled"].includes(status)) {
    return json({
      ok: true,
      order_status: order.status,
      payment_status: status || "processing",
      message: "Le paiement est toujours en attente de confirmation."
    }, 200, origin);
  }

  const eventName = "payment." + status;
  const eventId = transactionId + ":" + eventName;
  const confirmed = status === "success";
  const { data: applied, error: applyError } = await admin.rpc("apply_payment_webhook", {
    p_transaction_reference: payment.transaction_reference,
    p_event_id: eventId,
    p_confirmed: confirmed,
    p_provider_reference: gatewayData.provider_reference ?? transactionId,
    p_provider_response: { event: eventName, source: "paycentral_status_check", data: gatewayData }
  });

  if (applyError) {
    const { data: latest } = await admin
      .from("payments")
      .select("status,webhook_event_id")
      .eq("id", payment.id)
      .maybeSingle();
    if (latest?.webhook_event_id !== eventId && !(confirmed && latest?.status === "confirmed")) {
      console.error("Could not apply PayCentral status:", applyError.message);
      return json({ error: "Le statut PayCentral a été reçu, mais son enregistrement a échoué." }, 500, origin);
    }
  }

  const [{ data: updatedOrder }, { data: updatedPayment }] = await Promise.all([
    admin.from("orders").select("status").eq("id", orderId).maybeSingle(),
    admin.from("payments").select("status").eq("id", payment.id).maybeSingle()
  ]);

  return json({
    ok: true,
    order_status: updatedOrder?.status ?? order.status,
    payment_status: updatedPayment?.status ?? applied?.status ?? (confirmed ? "confirmed" : "failed"),
    message: confirmed
      ? "Paiement confirmé. Vos accès sont maintenant activés."
      : status === "cancelled"
        ? "Le paiement a été annulé."
        : "Le prestataire a signalé un échec de paiement."
  }, 200, origin);
});
