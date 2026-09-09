import { z } from "zod";
import { requirePermission, requireTenant } from "@/server/auth/session";
import { jsonError, ok, parseBody } from "@/server/http";
import { listSatisfaction, satisfactionSummary, satisfactionByDay, recordSatisfactionScore } from "@/server/services/satisfaction";

export const dynamic = "force-dynamic";

function filtersFrom(req: Request) {
  const p = new URL(req.url).searchParams;
  const score = (key: string) => {
    const value = Number(p.get(key));
    return Number.isInteger(value) && value >= 1 && value <= 5 ? value : undefined;
  };
  return {
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    minScore: score("minScore"),
    maxScore: score("maxScore"),
  };
}

export async function GET(req: Request) {
  try {
    const ctx = await requireTenant();
    const filters = filtersFrom(req);
    const p = new URL(req.url).searchParams;
    return ok({
      filters,
      summary: await satisfactionSummary(ctx.merchantId, filters),
      byDay: await satisfactionByDay(ctx.merchantId, filters),
      ...(p.get("page") ? { list: await listSatisfaction(ctx.merchantId, { ...filters, page: Number(p.get("page")), pageSize: Number(p.get("pageSize") ?? 25) }) } : {}),
    });
  } catch (e) {
    return jsonError(e);
  }
}

const scoreSchema = z.object({
  orderId: z.string().min(3).max(80).nullable().optional(),
  customerId: z.string().min(3).max(80).nullable().optional(),
  conversationId: z.string().min(3).max(80).nullable().optional(),
  messageId: z.string().min(3).max(80).nullable().optional(),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(1000).nullable().optional(),
  source: z.string().max(40).optional(),
});

/** Internal/manual capture endpoint; WhatsApp webhooks use the same service. */
export async function POST(req: Request) {
  try {
    const ctx = await requirePermission("orders.write");
    const body = await parseBody(req, scoreSchema);
    return ok({
      ok: true,
      score: await recordSatisfactionScore({
        merchantId: ctx.merchantId,
        orderId: body.orderId,
        customerId: body.customerId,
        conversationId: body.conversationId,
        messageId: body.messageId,
        score: body.score,
        comment: body.comment,
        source: body.source ?? "dashboard",
      }),
    }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
