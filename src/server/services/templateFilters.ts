import "server-only";
import { z } from "zod";
import { TEMPLATE_GROUPS } from "@/lib/domain";
import { all } from "@/server/db";

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
