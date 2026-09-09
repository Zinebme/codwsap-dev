import "server-only";
import { all, get, run, uid, nowIso } from "@/server/db";

export const SATISFACTION_SCORES = [1, 2, 3, 4, 5] as const;
export type SatisfactionScore = (typeof SATISFACTION_SCORES)[number];

export type SatisfactionRecordInput = {
  merchantId: string;
  score: number;
  customerId?: string | null;
  orderId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  comment?: string | null;
  source?: string;
  createdAt?: string;
};

/**
 * Parse only an intentional one-to-five answer.  A free-form sentence such as
 * "commande 123" is not a score; accepting an exact answer avoids turning
 * order references into customer feedback. Arabic-Indic digits are accepted
 * because the WhatsApp flow is bilingual.
 */
export function parseSatisfactionScore(text: string): SatisfactionScore | null {
  const normalized = text
    .trim()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .toLowerCase();
  const match = /^(?:score\s*|note\s*|rating\s*|rate\s*|é?valuation\s*)?([1-5])(?:\s*(?:\/\s*5|sur\s*5|out\s*of\s*5|étoiles?|stars?))?[.!]?$/.exec(normalized);
  if (!match) return null;
  const score = Number(match[1]);
  return SATISFACTION_SCORES.includes(score as SatisfactionScore) ? (score as SatisfactionScore) : null;
}

function validScore(score: number): score is SatisfactionScore {
  return Number.isInteger(score) && score >= 1 && score <= 5;
}

/** Store one current score per merchant/order. Repeated webhook deliveries are idempotent. */
export async function recordSatisfactionScore(input: SatisfactionRecordInput) {
  if (!validScore(input.score)) throw new Error("La note de satisfaction doit être comprise entre 1 et 5.");

  const existing = input.orderId
    ? await get<{ id: string }>("SELECT id FROM satisfaction_scores WHERE merchant_id = ? AND order_id = ?", [input.merchantId, input.orderId])
    : input.customerId
      ? await get<{ id: string }>("SELECT id FROM satisfaction_scores WHERE merchant_id = ? AND customer_id = ? AND order_id IS NULL", [input.merchantId, input.customerId])
      : undefined;
  const createdAt = input.createdAt ?? nowIso();

  if (existing) {
    await run(
      `UPDATE satisfaction_scores
       SET score = ?, rating = ?, customer_id = COALESCE(?, customer_id), conversation_id = COALESCE(?, conversation_id),
           message_id = COALESCE(?, message_id), comment = COALESCE(?, comment), source = ?, created_at = ?
       WHERE id = ? AND merchant_id = ?`,
      [input.score, input.score, input.customerId ?? null, input.conversationId ?? null, input.messageId ?? null, input.comment ?? null, input.source ?? "whatsapp", createdAt, existing.id, input.merchantId],
    );
  } else {
    await run(
      `INSERT INTO satisfaction_scores
        (id, merchant_id, customer_id, order_id, conversation_id, message_id, score, rating, comment, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uid("sat"),
        input.merchantId,
        input.customerId ?? null,
        input.orderId ?? null,
        input.conversationId ?? null,
        input.messageId ?? null,
        input.score,
        input.score,
        input.comment ?? null,
        input.source ?? "whatsapp",
        createdAt,
      ],
    );
  }

  if (input.orderId) {
    await run(
      "UPDATE orders SET satisfaction_score = ?, satisfaction_comment = ?, satisfaction_at = ?, updated_at = ? WHERE id = ? AND merchant_id = ?",
      [input.score, input.comment ?? null, createdAt, nowIso(), input.orderId, input.merchantId],
    );
    await run(
      "INSERT INTO order_events (id, merchant_id, order_id, type, title, description, metadata) VALUES (?,?,?,?,?,?,?)",
      [uid("evt"), input.merchantId, input.orderId, "satisfaction", "Avis client reçu", `Note : ${input.score}/5`, JSON.stringify({ score: input.score, source: input.source ?? "whatsapp" })],
    );
  }

  return await get<{
    id: string;
    merchant_id: string;
    customer_id: string | null;
    order_id: string | null;
    score: number;
    rating: number | null;
    comment: string | null;
    source: string;
    created_at: string;
  }>(
    input.orderId
      ? "SELECT id, merchant_id, customer_id, order_id, score, rating, comment, source, created_at FROM satisfaction_scores WHERE merchant_id = ? AND order_id = ?"
      : "SELECT id, merchant_id, customer_id, order_id, score, rating, comment, source, created_at FROM satisfaction_scores WHERE merchant_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 1",
    input.orderId ? [input.merchantId, input.orderId] : [input.merchantId, input.customerId],
  );
}

/** Return the latest delivered order which can receive a score from this customer. */
export async function findSatisfactionOrder(merchantId: string, customerId: string) {
  return await get<{ id: string; status: string; reference: string }>(
    `SELECT o.id, o.status, o.reference
     FROM orders o
     WHERE o.merchant_id = ? AND o.customer_id = ?
       AND (o.status = 'delivered' OR EXISTS (
         SELECT 1 FROM whatsapp_messages m
         LEFT JOIN whatsapp_templates t ON t.id = m.template_id
         WHERE m.merchant_id = o.merchant_id AND m.order_id = o.id AND m.direction = 'outbound'
           AND (t.event_key = 'delivered_thanks' OR t.template_group = 'satisfaction')
       ))
     ORDER BY o.updated_at DESC, o.created_at DESC LIMIT 1`,
    [merchantId, customerId],
  );
}

/** Capture a WhatsApp answer only when it is tied to a delivered/satisfaction flow. */
export async function captureSatisfactionReply(input: {
  merchantId: string;
  customerId: string;
  orderId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  text: string;
}) {
  const score = parseSatisfactionScore(input.text);
  if (score == null) return null;
  const order = input.orderId
    ? await get<{ id: string; status: string }>("SELECT id, status FROM orders WHERE id = ? AND merchant_id = ? AND customer_id = ?", [input.orderId, input.merchantId, input.customerId])
    : await findSatisfactionOrder(input.merchantId, input.customerId);
  if (!order) return null;
  const eligible = order.status === "delivered" || !!(await get<{ id: string }>(
    `SELECT m.id FROM whatsapp_messages m
     LEFT JOIN whatsapp_templates t ON t.id = m.template_id
     WHERE m.merchant_id = ? AND m.order_id = ? AND m.direction = 'outbound'
       AND (t.event_key = 'delivered_thanks' OR t.template_group = 'satisfaction')
     ORDER BY m.created_at DESC LIMIT 1`,
    [input.merchantId, order.id],
  ));
  if (!eligible) return null;
  return await recordSatisfactionScore({
    merchantId: input.merchantId,
    customerId: input.customerId,
    orderId: order.id,
    conversationId: input.conversationId,
    messageId: input.messageId,
    score,
    source: "whatsapp",
  });
}

export type SatisfactionFilters = {
  from?: string;
  to?: string;
  minScore?: number;
  maxScore?: number;
};

function scoreWhere(merchantId: string, filters: SatisfactionFilters) {
  const where = ["merchant_id = ?"];
  const params: unknown[] = [merchantId];
  if (filters.from) {
    where.push("created_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    where.push("created_at <= ?");
    params.push(`${filters.to} 23:59:59`);
  }
  if (filters.minScore != null && validScore(filters.minScore)) {
    where.push("score >= ?");
    params.push(filters.minScore);
  }
  if (filters.maxScore != null && validScore(filters.maxScore)) {
    where.push("score <= ?");
    params.push(filters.maxScore);
  }
  return { sql: where.join(" AND "), params };
}

export async function satisfactionSummary(merchantId: string, filters: SatisfactionFilters = {}) {
  const condition = scoreWhere(merchantId, filters);
  const totals = await get<{ responses: number; average: number | null; positive: number | null; low: number | null }>(
    `SELECT COUNT(*) AS responses, AVG(score) AS average,
       SUM(CASE WHEN score >= 4 THEN 1 ELSE 0 END) AS positive,
       SUM(CASE WHEN score <= 2 THEN 1 ELSE 0 END) AS low
     FROM satisfaction_scores WHERE ${condition.sql}`,
    condition.params,
  );
  const grouped = await all<{ score: number; count: number }>(
    `SELECT score, COUNT(*) AS count FROM satisfaction_scores WHERE ${condition.sql} GROUP BY score ORDER BY score`,
    condition.params,
  );
  const distribution = Object.fromEntries(SATISFACTION_SCORES.map((score) => [score, Number(grouped.find((row) => Number(row.score) === score)?.count ?? 0)]));
  const responses = Number(totals?.responses ?? 0);
  return {
    responses,
    average: responses ? Math.round(Number(totals?.average ?? 0) * 100) / 100 : 0,
    positive: Number(totals?.positive ?? 0),
    positiveRate: responses ? Math.round((Number(totals?.positive ?? 0) / responses) * 1000) / 10 : 0,
    low: Number(totals?.low ?? 0),
    distribution,
  };
}

export async function satisfactionByDay(merchantId: string, filters: SatisfactionFilters = {}) {
  const condition = scoreWhere(merchantId, filters);
  return await all<{ day: string; responses: number; average: number }>(
    `SELECT substr(CAST(created_at AS TEXT),1,10) AS day, COUNT(*) AS responses, AVG(score) AS average
     FROM satisfaction_scores WHERE ${condition.sql} GROUP BY day ORDER BY day`,
    condition.params,
  );
}

export async function listSatisfaction(merchantId: string, filters: SatisfactionFilters & { page?: number; pageSize?: number } = {}) {
  const condition = scoreWhere(merchantId, filters);
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, filters.pageSize ?? 25));
  const qualified = condition.sql
    .replace(/\bmerchant_id\b/g, "s.merchant_id")
    .replace(/\bcreated_at\b/g, "s.created_at")
    .replace(/\bscore\b/g, "s.score");
  const rows = await all(
    `SELECT s.*, c.full_name AS customer_name, c.normalized_phone, o.reference AS order_reference
     FROM satisfaction_scores s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN orders o ON o.id = s.order_id
     WHERE ${qualified}
     ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    [...condition.params, pageSize, (page - 1) * pageSize],
  );
  const total = Number((await get<{ c: number }>(`SELECT COUNT(*) AS c FROM satisfaction_scores WHERE ${condition.sql}`, condition.params))?.c ?? 0);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
