import { requirePermission } from "@/server/auth/session";
import { jsonError, ok, rateLimit } from "@/server/http";
import { sendTelegramAlert } from "@/server/services/telegram";

/**
 * Envoie une alerte Telegram de test avec le bot stocké côté serveur.
 * Le chemin d'envoi est EXACTEMENT celui des alertes réelles
 * (services/telegram.ts) : si ce test réussit, les notifications marcheront.
 */
export async function POST() {
  try {
    const ctx = await requirePermission("integrations.write");
    rateLimit(`telegram-test:${ctx.merchantId}`, 5, 60_000);
    const res = await sendTelegramAlert(
      ctx.merchantId,
      "Connexion Telegram réussie",
      "Vous recevrez ici vos alertes importantes (nouvelles commandes, échecs de livraison, webhooks).",
    );
    if (!res.ok && !res.configured) return ok({ ok: false, message: "Configurez d'abord votre bot Telegram." });
    return ok(
      res.ok
        ? { ok: true, message: "Message de test envoyé sur Telegram." }
        : { ok: false, message: "Telegram a refusé la requête. Vérifiez le token et le chat ID.", technical: res.error },
    );
  } catch (e) {
    return jsonError(e);
  }
}
