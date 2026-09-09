import "server-only";
import { z } from "zod";
import { TEMPLATE_GROUPS, type TemplateGroup } from "@/lib/domain";
import { all, run } from "@/server/db";

const GROUP_BY_NAME: Record<TemplateGroup, string[]> = {
  confirmation: ["order_confirmation_request", "order_confirmed", "order_cancelled", "order_postponed", "confirmation_reminder"],
  tracking: ["order_preparing", "order_shipped", "order_in_transit", "parcel_at_office", "out_for_delivery", "delivery_reminder"],
  return: ["delivery_failed", "return_requested", "order_returned", "returned_to_sender", "return_followup", "parcel_returned"],
  satisfaction: ["order_delivered", "delivered_thank_you", "satisfaction_request", "satisfaction_followup", "satisfaction_thanks"],
};

/** Repairs the current merchant even when deployment migrations are applied later. */
export async function repairTemplateGroups(merchantId: string) {
  for (const [group, names] of Object.entries(GROUP_BY_NAME)) {
    const placeholders = names.map(() => "?").join(",");
    await run(
      `UPDATE whatsapp_templates SET template_group = ?, group_key = ?
       WHERE merchant_id = ? AND name IN (${placeholders})
         AND (template_group <> ? OR group_key <> ?)`,
      [group, group, merchantId, ...names, group, group],
    );
  }
}

const filtersSchema = z.object({
  group: z.enum(TEMPLATE_GROUPS).optional(),
  language: z.enum(["ar", "fr", "en"]).optional(),
  status: z.enum(["draft", "pending", "approved", "rejected", "paused"]).optional(),
});

export function listTemplates(merchantId: string, params: URLSearchParams) {
  const filters = filtersSchema.parse(Object.fromEntries(
    ["group", "language", "status"].flatMap((key) => params.get(key) ? [[key, params.get(key)]] : []),
  ));
  const clauses = ["merchant_id = ?"];
  const values: string[] = [merchantId];
  for (const [key, value] of Object.entries(filters)) {
    clauses.push(`${key === "group" ? "template_group" : key} = ?`);
    values.push(value);
  }
  return all(`SELECT * FROM whatsapp_templates WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, id`, values);
}
