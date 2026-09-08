/**
 * Onboarding après une première connexion sociale (Google/Apple).
 *
 * Le fournisseur ne donne ni nom d'entreprise ni téléphone algérien : on les
 * demande ici, puis on crée l'espace marchand de façon ATOMIQUE (utilisateur,
 * marchand, appartenance OWNER, abonnement d'essai, automatisations et modèles
 * par défaut) — avec annulation complète en cas d'échec.
 */
import { NextRequest } from "next/server";
import { ok, jsonError, rateLimit } from "@/server/http";
import { currentUser, clientIp, HttpError } from "@/server/auth/session";
import { completeSocialOnboarding } from "@/server/auth/identity";
import { normalizeDzPhone } from "@/lib/phone";
import { audit } from "@/server/services/audit";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ip = await clientIp();
    rateLimit(`onboarding:${ip}`, 10, 60_000);

    // L'utilisateur doit être authentifié : jamais de merchantId ni d'userId
    // venant du client.
    const user = await currentUser();
    if (!user) throw new HttpError(401, "Veuillez vous reconnecter.", "unauthenticated");

    const body = (await req.json()) as { full_name?: string; business?: string; phone?: string };
    const fullName = (body.full_name ?? "").trim();
    const business = (body.business ?? "").trim();
    const phoneRaw = (body.phone ?? "").trim();

    if (fullName.length < 2) throw new HttpError(400, "Veuillez indiquer votre nom complet.", "invalid");
    if (business.length < 2) throw new HttpError(400, "Veuillez indiquer le nom de votre boutique.", "invalid");

    const phone = normalizeDzPhone(phoneRaw);
    if (!phone.valid) throw new HttpError(400, "Numéro de téléphone algérien invalide.", "invalid");

    const result = await completeSocialOnboarding({
      userId: user.id,
      fullName,
      business,
      phoneNormalized: phone.normalized,
    });
    if (!result.ok) throw new HttpError(500, result.error, "onboarding_failed");

    const jar = await cookies();
    jar.set("codwsap_merchant", result.merchantId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    await audit({
      merchantId: result.merchantId,
      actorId: user.id,
      actorLabel: user.email,
      action: "merchant.created",
      resource: "merchant",
      resourceId: result.merchantId,
      ip,
    });

    return ok({ ok: true, merchantId: result.merchantId });
  } catch (e) {
    return jsonError(e);
  }
}
