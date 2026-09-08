import { z } from "zod";
import { requireSuperAdmin, clientIp } from "@/server/auth/session";
import { jsonError, ok, parseBody, rateLimit } from "@/server/http";
import { replayWebhook } from "@/server/services/adminOps";

export const dynamic = "force-dynamic";

/**
 * Rejeu super admin d'un webhook transporteur en échec. La logique et les
 * gardes (source rejouable, connexion d'origine, idempotence) vivent dans
 * services/adminOps.ts, testées hors ligne par scripts/test-admin-ops.ts.
 */

const schema = z.object({ webhookId: z.string().min(3).max(60) });

export async function POST(req: Request) {
  try {
    const admin = await requireSuperAdmin();
    rateLimit("admin-webhooks", 30, 60_000);
    const body = await parseBody(req, schema);
    const { applied } = await replayWebhook(body.webhookId, admin, await clientIp());
    return ok({ ok: true, applied });
  } catch (e) {
    return jsonError(e);
  }
}
