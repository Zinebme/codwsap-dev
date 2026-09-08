import { z } from "zod";
import { requirePermission, HttpError } from "@/server/auth/session";
import { jsonError, ok, parseBody } from "@/server/http";
import { get } from "@/server/db";
import { renderTemplate } from "@/server/connectors/whatsapp";

export const dynamic = "force-dynamic";

/**
 * Aperçu du message qu'enverrait une automatisation, avec des valeurs
 * d'exemple. Aucun message n'est envoyé, aucun envoi n'est simulé : on rend
 * simplement le template retenu (explicite, ou premier template approuvé du
 * type) pour aider le marchand à configurer sans risque.
 */

const schema = z.object({ automationId: z.string().min(3).max(60) });

/** Valeurs d'exemple couvrant tous les placeholders connus. */
const SAMPLE_VARIABLES: Record<string, string> = {
  "1": "Amina",
  "2": "CMD-1042",
  "3": "4 900 DA",
  customer_name: "Amina",
  order_ref: "CMD-1042",
  total: "4 900 DA",
  tracking: "YAL-123456789",
  wilaya: "Alger",
  commune: "Bab Ezzouar",
};

export async function POST(req: Request) {
  try {
    const ctx = await requirePermission("automations.write");
    const body = await parseBody(req, schema);
    const automation = await get<{ id: string; type: string; template_id: string | null }>(
      "SELECT id, type, template_id FROM automations WHERE id = ? AND merchant_id = ?",
      [body.automationId, ctx.merchantId],
    );
    if (!automation) throw new HttpError(404, "Automatisation introuvable.", "not_found");

    // Template explicite, sinon le premier template approuvé de ce type.
    const tpl = automation.template_id
      ? await get<{ name: string; status: string; body: string }>(
          "SELECT name, status, body FROM whatsapp_templates WHERE id = ? AND merchant_id = ?",
          [automation.template_id, ctx.merchantId],
        )
      : await get<{ name: string; status: string; body: string }>(
          "SELECT name, status, body FROM whatsapp_templates WHERE merchant_id = ? AND event_key = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT 1",
          [ctx.merchantId, automation.type],
        );

    if (!tpl) {
      return ok({ ok: false, reason: "no_template", error: "Aucun template n'est associé à cette automatisation." });
    }
    return ok({
      ok: true,
      templateName: tpl.name,
      templateStatus: tpl.status,
      body: renderTemplate(tpl.body, SAMPLE_VARIABLES),
      sample: SAMPLE_VARIABLES,
    });
  } catch (e) {
    return jsonError(e);
  }
}
