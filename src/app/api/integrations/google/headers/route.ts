import { requirePermission } from "@/server/auth/session";
import { jsonError, ok, rateLimit } from "@/server/http";
import { fetchSheetHeaders } from "@/server/connectors/orders";

export const dynamic = "force-dynamic";

/**
 * Détection des en-têtes de la feuille Google du marchand, pour préremplir la
 * correspondance de colonnes. Lecture seule : aucun envoi, aucune écriture.
 * Utilise les identifiants déjà stockés (chiffrés) côté serveur.
 */
export async function POST() {
  try {
    const ctx = await requirePermission("integrations.write");
    rateLimit(`sheet-headers:${ctx.merchantId}`, 10, 60_000);
    return ok(await fetchSheetHeaders(ctx.merchantId));
  } catch (e) {
    return jsonError(e);
  }
}
