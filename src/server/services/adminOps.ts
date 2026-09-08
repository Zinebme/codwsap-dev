import "server-only";
import { get, run, nowIso } from "@/server/db";
import { HttpError } from "@/server/auth/session";
import { markWebhook } from "@/server/http";
import { audit } from "@/server/services/audit";
import { applyDeliveryWebhookPayload } from "@/server/services/delivery";

/**
 * Opérations super admin sur l'infrastructure : file de traitements et
 * webhooks en échec. Chaque action est journalisée (audit_logs, action
 * « admin.* ») et visible dans la console d'observabilité.
 */

export type AdminActor = { id: string; email: string };

/** Remet une tâche en échec dans la file (tentatives remises à zéro). */
export async function retryJob(jobId: string, admin: AdminActor, ip?: string | null): Promise<void> {
  const job = await get<{ id: string; type: string; status: string; merchant_id: string | null; last_error: string | null }>(
    "SELECT id, type, status, merchant_id, last_error FROM jobs WHERE id = ?",
    [jobId],
  );
  if (!job) throw new HttpError(404, "Tâche introuvable.", "not_found");
  if (job.status !== "failed") throw new HttpError(409, "Seule une tâche en échec peut être rejouée.", "conflict");
  await run("UPDATE jobs SET status = 'pending', attempts = 0, run_after = ?, updated_at = ? WHERE id = ?", [nowIso(), nowIso(), jobId]);
  await audit({
    merchantId: job.merchant_id,
    actorId: admin.id,
    actorLabel: admin.email,
    action: "admin.job_retried",
    resource: "job",
    resourceId: jobId,
    ip,
    metadata: { type: job.type, last_error: job.last_error?.slice(0, 200) ?? null },
  });
}

/** Supprime une tâche en échec : elle ne sera plus retentée. */
export async function discardJob(jobId: string, admin: AdminActor, ip?: string | null): Promise<void> {
  const job = await get<{ id: string; type: string; status: string; merchant_id: string | null; last_error: string | null }>(
    "SELECT id, type, status, merchant_id, last_error FROM jobs WHERE id = ?",
    [jobId],
  );
  if (!job) throw new HttpError(404, "Tâche introuvable.", "not_found");
  if (job.status !== "failed") throw new HttpError(409, "Seule une tâche en échec peut être supprimée.", "conflict");
  await run("DELETE FROM jobs WHERE id = ?", [jobId]);
  await audit({
    merchantId: job.merchant_id,
    actorId: admin.id,
    actorLabel: admin.email,
    action: "admin.job_discarded",
    resource: "job",
    resourceId: jobId,
    ip,
    metadata: { type: job.type, last_error: job.last_error?.slice(0, 200) ?? null },
  });
}

/**
 * Rejoue un webhook transporteur en échec.
 *
 * Seule la source « delivery » est rejouable : l'application d'un évènement
 * transporteur est idempotente (clé par colis/statut/date), un double
 * traitement est inoffensif. Les webhooks WhatsApp et commandes ne sont pas
 * rejouables : leur traitement est propre à la réception — aucun succès n'est
 * revendiqué pour ces sources.
 */
export async function replayWebhook(
  webhookId: string,
  admin: AdminActor,
  ip?: string | null,
): Promise<{ applied: number }> {
  const webhook = await get<{
    id: string; merchant_id: string | null; source: string; provider: string | null;
    status: string; payload: unknown; error: string | null;
  }>("SELECT id, merchant_id, source, provider, status, payload, error FROM webhook_events WHERE id = ?", [webhookId]);
  if (!webhook) throw new HttpError(404, "Webhook introuvable.", "not_found");
  if (webhook.status !== "failed") throw new HttpError(409, "Seul un webhook en échec peut être rejoué.", "conflict");
  if (webhook.source !== "delivery" || !webhook.merchant_id) {
    throw new HttpError(422, "Le rejeu n'est pas disponible pour cette source de webhook.", "not_replayable");
  }

  // Retrouve la connexion transporteur du marchand pour ce provider.
  const conn = await get<{ id: string; merchant_id: string; provider: string }>(
    `SELECT id, merchant_id, provider FROM delivery_connections
     WHERE merchant_id = ? AND provider = ?
     ORDER BY CASE WHEN is_active = 1 AND status = 'connected' THEN 0 ELSE 1 END, created_at
     LIMIT 1`,
    [webhook.merchant_id, webhook.provider ?? ""],
  );
  if (!conn) throw new HttpError(409, "La connexion transporteur d'origine n'existe plus.", "no_connection");

  // La charge utile est stockée en TEXT : on la redécode prudemment.
  let payload: unknown = null;
  if (typeof webhook.payload === "string") {
    try {
      payload = JSON.parse(webhook.payload);
    } catch {
      payload = null;
    }
  } else {
    payload = webhook.payload;
  }

  try {
    const { applied } = await applyDeliveryWebhookPayload(
      { id: conn.id, merchant_id: conn.merchant_id, provider: conn.provider },
      payload,
    );
    await markWebhook(webhook.id, "processed");
    await audit({
      merchantId: webhook.merchant_id,
      actorId: admin.id,
      actorLabel: admin.email,
      action: "admin.webhook_replayed",
      resource: "webhook",
      resourceId: webhook.id,
      ip,
      metadata: { source: webhook.source, provider: webhook.provider, applied },
    });
    return { applied };
  } catch (e) {
    await markWebhook(webhook.id, "failed", (e as Error).message);
    throw new HttpError(502, `Rejeu encore en échec : ${(e as Error).message.slice(0, 160)}`, "replay_failed");
  }
}
