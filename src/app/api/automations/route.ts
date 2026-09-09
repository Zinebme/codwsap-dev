import { requireTenant } from "@/server/auth/session";
import { jsonError, ok } from "@/server/http";
import { all } from "@/server/db";
import { TEMPLATE_GROUPS } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await requireTenant();
    const requestedGroup = new URL(req.url).searchParams.get("group");
    const group = requestedGroup && (TEMPLATE_GROUPS as readonly string[]).includes(requestedGroup) ? requestedGroup : null;
    const where = group ? "a.merchant_id = ? AND a.automation_group = ?" : "a.merchant_id = ?";
    const params = group ? [ctx.merchantId, group] : [ctx.merchantId];
    return ok({
      rows: await all(
        `SELECT a.*, t.name AS template_name, t.status AS template_status,
                COALESCE(a.automation_group, a.group_key, 'tracking') AS group_name
         FROM automations a LEFT JOIN whatsapp_templates t ON t.id = a.template_id
         WHERE ${where} ORDER BY a.automation_group, a.created_at`,
        params,
      ),
      groups: TEMPLATE_GROUPS,
      templates: await all("SELECT id, name, status, category, event_key, template_group, group_key FROM whatsapp_templates WHERE merchant_id = ? ORDER BY template_group, name", [ctx.merchantId]),
      runs: await all(
        `SELECT r.*, a.type AS automation_type FROM automation_runs r LEFT JOIN automations a ON a.id = r.automation_id
         WHERE r.merchant_id = ? ORDER BY r.created_at DESC LIMIT 30`,
        [ctx.merchantId],
      ),
    });
  } catch (e) {
    return jsonError(e);
  }
}
