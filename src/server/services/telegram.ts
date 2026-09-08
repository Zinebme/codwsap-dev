import "server-only";
import { get, run, nowIso } from "@/server/db";
import { decryptSecret } from "@/server/crypto";
import { apiLog } from "@/server/services/audit";

/**
 * Envoi des alertes Telegram.
 *
 * Le bot et le chat ID sont stockés chiffrés côté serveur (aucun secret n'est
 * jamais renvoyé au navigateur). Le titre est mis en gras, le corps suit ;
 * les données dynamiques (noms clients, références, messages d'erreur) sont
 * ÉCHAPPÉES : sans cela, un nom contenant `_`, `*` ou `[` fait rejeter tout
 * le message par l'API Telegram (400 « can't parse entities ») et l'alerte
 * est perdue.
 */

/** Caractères spéciaux du Markdown « legacy » de Telegram. */
export function escapeTelegramMarkdown(text: string): string {
  return text.replace(/([_*`\[])/g, "\\$1");
}

export type TelegramSendResult = { ok: true } | { ok: false; error: string; configured: boolean };

export async function sendTelegramAlert(merchantId: string, title: string, body?: string): Promise<TelegramSendResult> {
  const integ = await get<{ id: string; credentials_encrypted: string | null }>(
    "SELECT id, credentials_encrypted FROM integrations WHERE merchant_id = ? AND kind = 'telegram' AND status = 'connected' LIMIT 1",
    [merchantId],
  );
  const creds = decryptSecret<{ bot_token?: string; chat_id?: string }>(integ?.credentials_encrypted);
  if (!integ || !creds?.bot_token || !creds.chat_id) {
    // Pas une erreur : le marchand n'a pas (ou plus) configuré Telegram.
    return { ok: false, error: "Telegram non configuré.", configured: false };
  }

  const text = `*${escapeTelegramMarkdown(title)}*${body ? `\n${escapeTelegramMarkdown(body)}` : ""}`;
  const startedAt = Date.now();
  try {
    const res = await fetch(`https://api.telegram.org/bot${creds.bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: creds.chat_id, text, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json().catch(() => ({}))) as { description?: string };
    await apiLog({ merchantId, service: "telegram", operation: "sendMessage", ok: res.ok, statusCode: res.status, durationMs: Date.now() - startedAt, error: res.ok ? null : json.description ?? `HTTP ${res.status}` });

    if (res.ok) {
      await run("UPDATE integrations SET last_sync_at = ?, last_error = NULL WHERE id = ?", [nowIso(), integ.id]);
      return { ok: true };
    }

    // 400/401/403/404 : token ou chat définitivement invalide — l'intégration
    // est marquée en erreur pour que le marchand la reconfigure. 429/5xx :
    // problème transitoire, l'intégration reste « connected » et le job sera
    // retenté par la file (backoff 1/5/15 min).
    if ([400, 401, 403, 404].includes(res.status)) {
      await run("UPDATE integrations SET status = 'error', last_error = ?, last_error_at = ? WHERE id = ?", [
        json.description ?? `HTTP ${res.status}`,
        nowIso(),
        integ.id,
      ]);
    }
    return { ok: false, error: json.description ?? `Telegram HTTP ${res.status}`, configured: true };
  } catch (e) {
    await apiLog({ merchantId, service: "telegram", operation: "sendMessage", ok: false, durationMs: Date.now() - startedAt, error: (e as Error).message });
    return { ok: false, error: "Telegram injoignable.", configured: true };
  }
}
