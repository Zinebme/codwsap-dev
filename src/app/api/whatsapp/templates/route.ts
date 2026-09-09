import { listTemplates, repairTemplateGroups } from "@/server/services/templateFilters";
import { seedTemplates } from "@/server/services/seedTemplates";
import { z } from "zod";
import { requirePermission, requireTenant, clientIp, HttpError } from "@/server/auth/session";
import { jsonError, ok, parseBody } from "@/server/http";
import { get, run, uid, nowIso } from "@/server/db";
import { extractTemplateVariables } from "@/server/connectors/whatsapp";
import { audit } from "@/server/services/audit";
import { TEMPLATE_GROUPS } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await requireTenant();
    // Safe and idempotent: repairs legacy groups and inserts only missing
    // starter languages. Existing merchant/Meta rows are never updated.
    await repairTemplateGroups(ctx.merchantId);
    await seedTemplates(ctx.merchantId);
    return ok({ rows: await listTemplates(ctx.merchantId, new URL(req.url).searchParams) });
  } catch (e) {
    return jsonError(e);
  }
}

const schema = z.object({
  name: z.string().min(2).max(60).regex(/^[a-z0-9_]+$/, "Utilisez uniquement des minuscules, chiffres et underscores."),
  category: z.enum(["utility", "marketing", "authentication"]),
  language: z.enum(["fr", "ar", "en"]),
  body: z.string().min(5).max(1024),
  eventKey: z.string().max(60).nullable().optional(),
  templateGroup: z.enum(TEMPLATE_GROUPS).optional(),
  buttons: z.array(z.string().max(24)).max(3).optional(),
});

export async function POST(req: Request) {
  try {
    const ctx = await requirePermission("templates.write");
    const body = await parseBody(req, schema);
    // Un même nom de template peut exister en PLUSIEURS langues (fr/ar/en) :
    // le couple (nom, langue) est la clé métier, pas le nom seul.
    const existing = await get<{ id: string }>(
      "SELECT id FROM whatsapp_templates WHERE merchant_id = ? AND name = ? AND language = ?",
      [ctx.merchantId, body.name, body.language],
    );
    if (existing) throw new HttpError(409, "Un template de ce nom existe déjà dans cette langue.", "conflict");
    const id = uid("tpl");
    const variables = extractTemplateVariables(body.body);
    await run(
      `INSERT INTO whatsapp_templates
        (id, merchant_id, name, category, language, status, body, variables, buttons, event_key, template_group, group_key)
       VALUES (?,?,?,?,?, 'draft', ?, ?, ?, ?, ?, ?)`,
      [
        id,
        ctx.merchantId,
        body.name,
        body.category,
        body.language,
        body.body,
        JSON.stringify(variables),
        JSON.stringify(body.buttons ?? []),
        body.eventKey ?? null,
        body.templateGroup ?? "confirmation",
        body.templateGroup ?? "confirmation",
      ],
    );
    await audit({ merchantId: ctx.merchantId, actorId: ctx.user.id, actorLabel: ctx.user.email, action: "template.created", resource: "template", resourceId: id, ip: await clientIp() });
    return ok({ ok: true, id, updatedAt: nowIso() }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
