import { z } from "zod";
import { requireSuperAdmin, clientIp } from "@/server/auth/session";
import { jsonError, ok, parseBody, rateLimit } from "@/server/http";
import { retryJob, discardJob } from "@/server/services/adminOps";

export const dynamic = "force-dynamic";

/**
 * Actions super admin sur la file de traitements :
 *   - retry   : remet une tâche en échec dans la file ;
 *   - discard : supprime une tâche en échec.
 *
 * La logique (gardes, audit) vit dans services/adminOps.ts et est testée
 * hors ligne par scripts/test-admin-ops.ts.
 */

const schema = z.object({
  jobId: z.string().min(3).max(60),
  action: z.enum(["retry", "discard"]),
});

export async function POST(req: Request) {
  try {
    const admin = await requireSuperAdmin();
    rateLimit("admin-jobs", 60, 60_000);
    const body = await parseBody(req, schema);
    if (body.action === "retry") {
      await retryJob(body.jobId, admin, await clientIp());
    } else {
      await discardJob(body.jobId, admin, await clientIp());
    }
    return ok({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
