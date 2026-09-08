import { requireSuperAdmin } from "@/server/auth/session";
import { jsonError, ok } from "@/server/http";
import { all, get } from "@/server/db";
import { superAdminKpis } from "@/server/services/analytics";
import { workerHealth } from "@/server/jobs/worker";

export const dynamic = "force-dynamic";

type State = "healthy" | "degraded" | "down";

async function rate(service: string): Promise<{ calls: number; failures: number; state: State }> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
  const row = await get<{ calls: number; failures: number }>(
    "SELECT COUNT(*) AS calls, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures FROM api_logs WHERE service LIKE ? AND created_at >= ?",
    [service, since],
  );
  const calls = row?.calls ?? 0;
  const failures = row?.failures ?? 0;
  const ratio = calls ? failures / calls : 0;
  return { calls, failures, state: calls === 0 ? "healthy" : ratio >= 0.5 ? "down" : ratio >= 0.1 ? "degraded" : "healthy" };
}

export async function GET() {
  try {
    await requireSuperAdmin();
    const jobs = await workerHealth();
    const webhookFailures = (await get<{ c: number }>("SELECT COUNT(*) AS c FROM webhook_events WHERE status = 'failed'"))?.c ?? 0;
    return ok({
      kpi: await superAdminKpis(),
      services: {
        whatsapp: await rate("whatsapp"),
        delivery: await rate("delivery:%"),
        telegram: await rate("telegram"),
        sheets: await rate("google_sheets"),
        webhooks: { calls: (await get<{ c: number }>("SELECT COUNT(*) AS c FROM webhook_events"))?.c ?? 0, failures: webhookFailures, state: (webhookFailures > 20 ? "degraded" : "healthy") as State },
        jobs: { ...jobs, state: (jobs.failed > 20 || jobs.stuck > 5 ? "degraded" : "healthy") as State },
      },
      recentErrors: await all("SELECT a.*, m.name AS merchant_name FROM api_logs a LEFT JOIN merchants m ON m.id = a.merchant_id WHERE a.ok = 0 ORDER BY a.created_at DESC LIMIT 30"),
      failedWebhooks: await all("SELECT w.*, m.name AS merchant_name FROM webhook_events w LEFT JOIN merchants m ON m.id = w.merchant_id WHERE w.status = 'failed' ORDER BY w.created_at DESC LIMIT 20"),
      providerRequests: await all("SELECT p.*, m.name AS merchant_name FROM provider_requests p LEFT JOIN merchants m ON m.id = p.merchant_id ORDER BY p.created_at DESC LIMIT 20"),
      audits: await all("SELECT a.*, m.name AS merchant_name FROM audit_logs a LEFT JOIN merchants m ON m.id = a.merchant_id ORDER BY a.created_at DESC LIMIT 40"),
      plans: await all("SELECT * FROM plans ORDER BY sort_order"),
      // File de traitements : tout ce qui n'est pas terminé, pour agir dessus.
      jobQueue: await all(
        `SELECT j.id, j.type, j.status, j.attempts, j.max_attempts, j.run_after, j.updated_at, j.last_error, j.merchant_id,
                m.name AS merchant_name
         FROM jobs j LEFT JOIN merchants m ON m.id = j.merchant_id
         WHERE j.status != 'done'
         ORDER BY CASE j.status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, j.updated_at DESC
         LIMIT 30`,
      ),
      // Tendance 7 jours : appels et échecs d'intégrations par jour.
      trend: await all(
        `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS calls, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures
         FROM api_logs WHERE created_at >= ?
         GROUP BY substr(created_at, 1, 10) ORDER BY day`,
        [new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19).replace("T", " ")],
      ),
    });
  } catch (e) {
    return jsonError(e);
  }
}
