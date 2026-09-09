import "server-only";
import { decryptSecret, maskSecret } from "@/server/crypto";
import { apiLog } from "@/server/services/audit";
import { get } from "@/server/db";

/**
 * WhatsApp provider abstraction. V1 ships the official Meta Cloud API provider
 * plus a sandbox provider used for test orders / merchants that have not
 * connected yet. No unofficial WhatsApp Web automation is used anywhere.
 */

export type SendResult =
  | { ok: true; waMessageId: string; provider: string }
  | { ok: false; errorCode: string; errorMessage: string; provider: string };

export type AvailabilityResult = {
  status: "available" | "unavailable" | "unknown" | "check_failed";
  source: string;
  detail?: string;
};

export type WhatsappConnection = {
  id: string;
  merchant_id: string;
  provider: string;
  phone_number_id: string | null;
  business_account_id: string | null;
  credentials_encrypted: string | null;
  status: string;
};

export interface WhatsappProvider {
  readonly name: string;
  sendText(to: string, body: string): Promise<SendResult>;
  sendTemplate(to: string, templateName: string, language: string, variables: string[], renderedBody: string): Promise<SendResult>;
  /**
   * Official availability check. The Cloud API does not expose a reliable
   * "does this number have WhatsApp" endpoint, so unless the merchant's setup
   * provides one we must return "unknown" rather than inventing a result.
   */
  checkAvailability(to: string): Promise<AvailabilityResult>;
}

/**
 * Lignes de la table whatsapp_connections. Le payload renvoyé au navigateur
 * (safeConnectionPayload) projette EXPLICITEMENT les champs sûrs : le secret
 * de signature du webhook (webhook_secret) et le blob chiffré
 * (credentials_encrypted) ne quittent jamais le serveur, et le jeton
 * d'accès n'apparaît que masqué.
 */
export type ConnectionRow = {
  id: string;
  merchant_id: string;
  display_phone: string | null;
  phone_number_id: string | null;
  business_account_id: string | null;
  status: string;
  quality_rating: string | null;
  webhook_verify_token: string | null;
  last_webhook_at: string | null;
  last_message_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
};

/** Fonction pure : testable hors ligne, sans appel réseau. */
export function safeConnectionPayload(conn: ConnectionRow, accessToken: string | null | undefined) {
  return {
    id: conn.id,
    display_phone: conn.display_phone,
    phone_number_id: conn.phone_number_id,
    business_account_id: conn.business_account_id,
    status: conn.status,
    quality_rating: conn.quality_rating,
    webhook_verify_token: conn.webhook_verify_token,
    access_token_masked: maskSecret(accessToken),
    last_webhook_at: conn.last_webhook_at,
    last_message_at: conn.last_message_at,
    last_error: conn.last_error,
    last_error_at: conn.last_error_at,
    webhook_url: `/api/webhooks/whatsapp/${conn.merchant_id}`,
  };
}

/**
 * Composant « template » exigé par l'API Cloud Meta. Les paramètres du corps
 * sont POSITIONNELS : ils remplissent {{1}}, {{2}}… dans l'ordre. Sans valeurs,
 * on n'envoie aucun composant (Meta refuse des paramètres vides).
 * Fonction pure : testable hors ligne, sans appel réseau.
 */
export function templateComponent(templateName: string, language: string, variables: string[]) {
  return {
    name: templateName,
    language: { code: language },
    components: variables.length
      ? [{ type: "body", parameters: variables.map((v) => ({ type: "text", text: v })) }]
      : [],
  };
}

class MetaCloudProvider implements WhatsappProvider {
  readonly name = "meta_cloud";
  constructor(private conn: WhatsappConnection, private token: string) {}

  private async call(payload: Record<string, unknown>, operation: string): Promise<SendResult> {
    const started = Date.now();
    const url = `https://graph.facebook.com/v21.0/${this.conn.phone_number_id}/messages`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        messages?: { id: string }[];
        error?: { code?: number; message?: string; type?: string };
      };
      await apiLog({
        merchantId: this.conn.merchant_id,
        service: "whatsapp",
        operation,
        statusCode: res.status,
        ok: res.ok,
        durationMs: Date.now() - started,
        error: res.ok ? null : json.error?.message ?? `HTTP ${res.status}`,
      });
      if (!res.ok || !json.messages?.[0]?.id) {
        return {
          ok: false,
          provider: this.name,
          errorCode: String(json.error?.code ?? res.status),
          errorMessage: json.error?.message ?? "Envoi refusé par l'API WhatsApp.",
        };
      }
      return { ok: true, provider: this.name, waMessageId: json.messages[0].id };
    } catch (e) {
      await apiLog({
        merchantId: this.conn.merchant_id,
        service: "whatsapp",
        operation,
        ok: false,
        durationMs: Date.now() - started,
        error: (e as Error).message,
      });
      return { ok: false, provider: this.name, errorCode: "network", errorMessage: "Connexion à l'API WhatsApp impossible." };
    }
  }

  sendText(to: string, body: string) {
    return this.call({ to, type: "text", text: { preview_url: false, body } }, "send_text");
  }

  sendTemplate(to: string, templateName: string, language: string, variables: string[]) {
    return this.call(
      {
        to,
        type: "template",
        template: templateComponent(templateName, language, variables),
      },
      "send_template",
    );
  }

  async checkAvailability(): Promise<AvailabilityResult> {
    // Meta Cloud API provides no supported "is on WhatsApp" lookup for arbitrary
    // numbers. We report unknown instead of guessing.
    return { status: "unknown", source: "meta_cloud", detail: "Vérification officielle indisponible sur cette configuration." };
  }
}

/** Deterministic sandbox used for test orders and unconnected merchants. */
class SandboxProvider implements WhatsappProvider {
  readonly name = "sandbox";
  constructor(private merchantId: string) {}

  private async sim(operation: string): Promise<SendResult> {
    await apiLog({ merchantId: this.merchantId, service: "whatsapp", operation, ok: true, statusCode: 200, durationMs: 12 });
    return { ok: true, provider: this.name, waMessageId: `sandbox.${crypto.randomUUID()}` };
  }
  async sendText() {
    return this.sim("send_text");
  }
  async sendTemplate() {
    return this.sim("send_template");
  }
  async checkAvailability(): Promise<AvailabilityResult> {
    return { status: "unknown", source: "sandbox", detail: "Mode test : aucune vérification réelle." };
  }
}

export async function getWhatsappProvider(merchantId: string): Promise<{ provider: WhatsappProvider; connected: boolean }> {
  const conn = await get<WhatsappConnection>("SELECT * FROM whatsapp_connections WHERE merchant_id = ?", [merchantId]);
  if (!conn || conn.status !== "connected" || !conn.phone_number_id) {
    return { provider: new SandboxProvider(merchantId), connected: false };
  }
  const creds = decryptSecret<{ access_token?: string }>(conn.credentials_encrypted);
  if (!creds?.access_token) return { provider: new SandboxProvider(merchantId), connected: false };
  return { provider: new MetaCloudProvider(conn, creds.access_token), connected: true };
}

/** Renders {{1}}, {{2}} … or named {{customer_name}} placeholders. */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w\d_]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? vars[`v${key}`] ?? "");
}

