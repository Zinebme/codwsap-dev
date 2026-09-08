import "server-only";
import { all, get, run, nowIso } from "@/server/db";
import { claimJobs, completeJob, failJob, enqueueJob, type Job } from "@/server/jobs/queue";
import { deliverQueuedMessage, markMessageFailed, refreshAvailabilityEvidence } from "@/server/services/messaging";
import { refreshTracking } from "@/server/services/delivery";
import { runNoResponseReminder } from "@/server/services/automations";
import { syncGoogleSheet, safeJson } from "@/server/connectors/orders";
import { sendTelegramAlert } from "@/server/services/telegram";
import { notify } from "@/server/services/notifications";

/** Libellés non techniques des traitements de fond, pour les alertes marchand. */
const JOB_TITLES: Record<string, string> = {
  send_whatsapp: "Message WhatsApp non envoyé",
  poll_delivery: "Synchronisation du suivi colis",
  sync_sheet: "Synchronisation Google Sheets",
  reminder: "Rappel client",
  notify_telegram: "Notification Telegram",
  wa_availability_check: "Vérification des numéros WhatsApp",
};

async function handle(job: Job): Promise<void> {
  const payload = safeJson<Record<string, string>>(job.payload) ?? {};
  switch (job.type) {
    case "send_whatsapp": {
      const res = await deliverQueuedMessage(payload.messageId);
      if (!res.ok) throw new Error(res.error ?? "Envoi échoué");
      return;
    }
    case "poll_delivery": {
      // Poll only orders that are in-flight, in small batches.
      const orders = await all<{ id: string; merchant_id: string }>(
        `SELECT id, merchant_id FROM orders
         WHERE merchant_id = ? AND tracking_number IS NOT NULL
           AND delivery_status NOT IN ('delivered','returned','delivery_failed')
         ORDER BY updated_at ASC LIMIT 25`,
        [job.merchant_id],
      );
      for (const o of orders) {
        try {
          await refreshTracking(o.merchant_id, o.id);
        } catch {
          /* individual failures must not kill the batch */
        }
      }
      if (orders.length && job.merchant_id) {
        await enqueueJob({ merchantId: job.merchant_id, type: "poll_delivery", runAfter: new Date(Date.now() + 15 * 60_000) });
      }
      return;
    }
    case "sync_sheet": {
      const res = await syncGoogleSheet(job.merchant_id!, payload.integrationId);
      if (!res.ok) throw new Error(res.error);
      // Synchro planifiée : le marchand n'a pas demandé la synchronisation,
      // il ne voit son résultat que si on le lui annonce.
      if (res.created > 0 || res.invalid > 0) {
        await notify({
          merchantId: job.merchant_id!,
          type: "sheets_sync",
          severity: res.invalid > 0 ? "warning" : "success",
          title: "Google Sheets synchronisé",
          body: `${res.created} nouvelle(s) commande(s), ${res.duplicates} déjà importée(s)${res.invalid ? `, ${res.invalid} ligne(s) invalide(s)` : ""}.`,
          link: "/dashboard/orders",
        });
      }
      return;
    }
    case "reminder": {
      await runNoResponseReminder(payload.orderId);
      return;
    }
    case "wa_availability_check": {
      // Rapprochement fondé sur les preuves de livraison (aucune API
      // d'interrogation de numéros n'existe côté Meta : on ne devine jamais).
      await refreshAvailabilityEvidence(job.merchant_id!);
      return;
    }
    case "notify_telegram": {
      const res = await sendTelegramAlert(job.merchant_id!, payload.title, payload.body);
      // « non configuré » n'est pas un échec : le marchand a déconnecté
      // Telegram, la notification dashboard reste la seule voie.
      if (!res.ok && res.configured) throw new Error(res.error);
      return;
    }
    default:
      return;
  }
}

/** Processes a bounded batch. Called by the cron endpoint and after mutations. */
export async function runWorker(limit = 20): Promise<{ processed: number; failed: number }> {
  const jobs = await claimJobs(limit);
  let failed = 0;
  for (const job of jobs) {
    try {
      await handle(job);
      await completeJob(job.id);
    } catch (e) {
      const outcome = await failJob(job, (e as Error).message);
      if (outcome === "failed") {
        failed++;
        if (job.type === "send_whatsapp") {
          const payload = safeJson<{ messageId: string }>(job.payload);
          if (payload?.messageId) await markMessageFailed(payload.messageId, (e as Error).message);
        }
        // « 3 tentatives puis alerte » : le marchand est prévenu, le super
        // admin voit le détail dans la console d'observabilité.
        if (job.merchant_id) {
          await notify({
            merchantId: job.merchant_id,
            type: "job_failed",
            severity: "error",
            title: JOB_TITLES[job.type] ?? "Traitement de fond en échec",
            body: (e as Error).message.slice(0, 160),
            link: "/dashboard/notifications",
          });
        }
      }
    }
  }
  await run("DELETE FROM jobs WHERE status = 'done' AND updated_at < ?", [new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19).replace("T", " ")]);
  return { processed: jobs.length, failed };
}

export async function workerHealth() {
  const pending = (await get<{ c: number }>("SELECT COUNT(*) AS c FROM jobs WHERE status = 'pending'"))?.c ?? 0;
  const failedJobs = (await get<{ c: number }>("SELECT COUNT(*) AS c FROM jobs WHERE status = 'failed'"))?.c ?? 0;
  const stuck = (await get<{ c: number }>("SELECT COUNT(*) AS c FROM jobs WHERE status = 'running' AND updated_at < ?", [
    new Date(Date.now() - 10 * 60_000).toISOString().slice(0, 19).replace("T", " "),
  ]))?.c ?? 0;
  return { pending, failed: failedJobs, stuck, checkedAt: nowIso() };
}
