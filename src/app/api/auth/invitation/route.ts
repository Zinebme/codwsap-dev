import { z } from "zod";
import { cookies } from "next/headers";
import { currentUser, createSession, clientIp } from "@/server/auth/session";
import { jsonError, ok, parseBody, rateLimit } from "@/server/http";
import { get } from "@/server/db";
import { invitationPreview, acceptInvitation } from "@/server/services/team";

export const dynamic = "force-dynamic";

/**
 * Endpoint public de l'invitation d'équipe.
 *
 * GET  ?token=... -> aperçu (nom de boutique, email invité, rôle, état).
 * POST { token, fullName?, password? } -> acceptation. Le compte existant est
 * protégé : mot de passe exigé (ou session déjà ouverte sur ce compte).
 */

export async function GET(req: Request) {
  try {
    const ip = (await clientIp()) ?? "anon";
    rateLimit(`invite-view:${ip}`, 30, 60_000);
    const token = new URL(req.url).searchParams.get("token") ?? "";
    const user = await currentUser();
    const preview = await invitationPreview(token);
    return ok({
      status: preview.status,
      email: preview.status === "invalid" ? "" : preview.email,
      merchantName: preview.merchantName,
      merchantId: preview.status === "invalid" ? "" : preview.merchantId,
      role: preview.role,
      fullName: preview.full_name,
      expiresAt: preview.expires_at,
      existingAccount: preview.existingAccount,
      // L'invité déjà connecté sur le bon compte n'a pas à retaper son mot de passe.
      alreadyAuthenticatedAsInvitee:
        !!user && preview.existingAccount && preview.status === "pending"
          ? (await isInvitee(user.id, preview.email))
          : false,
    });
  } catch (e) {
    return jsonError(e);
  }
}

async function isInvitee(userId: string, email: string): Promise<boolean> {
  const row = await get<{ id: string }>("SELECT id FROM users WHERE id = ? AND email = ?", [userId, email]);
  return !!row;
}

const acceptSchema = z.object({
  token: z.string().min(10).max(300),
  fullName: z.string().min(2).max(80).optional(),
  password: z.string().min(1).max(200).optional(),
});

export async function POST(req: Request) {
  try {
    const ip = (await clientIp()) ?? "anon";
    rateLimit(`invite-accept:${ip}`, 10, 60_000);
    const body = await parseBody(req, acceptSchema);
    const user = await currentUser();
    const result = await acceptInvitation({
      token: body.token,
      fullName: body.fullName,
      password: body.password,
      currentUserId: user?.id ?? null,
      ip,
    });

    // Ouvre la session pour l'invité (identité prouvée par le mot de passe du
    // compte, la création du compte, ou la session déjà en cours).
    if (!user || user.id !== result.userId) {
      await createSession(result.userId);
    }
    const jar = await cookies();
    jar.set("codwsap_merchant", result.merchantId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return ok({ ok: true, redirect: "/dashboard", merchantName: result.merchantName });
  } catch (e) {
    return jsonError(e);
  }
}
