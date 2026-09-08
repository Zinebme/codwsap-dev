import crypto from "node:crypto";
import { get } from "@/server/db";
import { ok, recordWebhook, markWebhook, rateLimit } from "@/server/http";
import { decryptSecret, safeEqual } from "@/server/crypto";
import { applyDeliveryWebhookPayload } from "@/server/services/delivery";

export const dynamic = "force-dynamic";

/**
 * Generic delivery webhook endpoint, scoped per connection.
 * Signature is validated with the connection's stored webhook secret when the
 * provider supports it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  rateLimit(`dlv-webhook:${connectionId}`, 600, 60_000);

  const conn = await get<{ id: string; merchant_id: string; provider: string; credentials_encrypted: string | null }>(
    "SELECT id, merchant_id, provider, credentials_encrypted FROM delivery_connections WHERE id = ?",
    [connectionId],
  );
  if (!conn) return new Response("not found", { status: 404 });

  const raw = await req.text();
  const secret = decryptSecret<{ webhook_secret?: string }>(conn.credentials_encrypted)?.webhook_secret;
  let signatureValid: boolean | null = null;
  if (secret) {
    const provided = req.headers.get("x-signature") ?? req.headers.get("x-webhook-signature") ?? "";
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    signatureValid = safeEqual(provided.replace(/^sha256=/, ""), expected);
    if (!signatureValid) return new Response("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const idem = crypto.createHash("sha256").update(`${connectionId}:${raw}`).digest("hex").slice(0, 40);
  const { duplicate, id: webhookId } = await recordWebhook({
    merchantId: conn.merchant_id,
    source: "delivery",
    provider: conn.provider,
    idempotencyKey: idem,
    signatureValid,
    payload,
  });
  if (duplicate) return ok({ ok: true, duplicate: true });

  try {
    const { applied } = await applyDeliveryWebhookPayload({ id: conn.id, merchant_id: conn.merchant_id, provider: conn.provider }, payload);
    await markWebhook(webhookId, "processed");
    return ok({ ok: true, applied });
  } catch (e) {
    await markWebhook(webhookId, "failed", (e as Error).message);
    return ok({ ok: true });
  }
}
