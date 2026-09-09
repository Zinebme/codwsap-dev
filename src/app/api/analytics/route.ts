import { requireTenant } from "@/server/auth/session";
import { jsonError, ok } from "@/server/http";
import { merchantKpis, ordersByDay, messagesByDay, rangeFromPreset, satisfactionAnalytics } from "@/server/services/analytics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await requireTenant();
    const p = new URL(req.url).searchParams;
    const range = rangeFromPreset(p.get("preset") ?? "30d", p.get("from") ?? undefined, p.get("to") ?? undefined);
    const parseScore = (key: string) => {
      const value = Number(p.get(key));
      return Number.isInteger(value) && value >= 1 && value <= 5 ? value : undefined;
    };
    const satisfactionFilters = { from: range.from, to: range.to, minScore: parseScore("minScore"), maxScore: parseScore("maxScore") };
    return ok({
      range,
      filters: { minScore: satisfactionFilters.minScore ?? null, maxScore: satisfactionFilters.maxScore ?? null },
      kpi: await merchantKpis(ctx.merchantId, range, satisfactionFilters),
      ordersByDay: await ordersByDay(ctx.merchantId, range),
      messagesByDay: await messagesByDay(ctx.merchantId, range),
      satisfaction: await satisfactionAnalytics(ctx.merchantId, satisfactionFilters),
    });
  } catch (e) {
    return jsonError(e);
  }
}
