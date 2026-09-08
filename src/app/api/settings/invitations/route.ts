import { z } from "zod";
import { requirePermission, clientIp, HttpError } from "@/server/auth/session";
import { jsonError, ok, parseBody, rateLimit, originFromRequest } from "@/server/http";
import { createInvitation, revokeInvitation } from "@/server/services/team";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  email: z.string().email().max(160),
  role: z.enum(["admin", "agent"]),
  fullName: z.string().min(2).max(80).optional(),
});

export async function POST(req: Request) {
  try {
    const ctx = await requirePermission("users.write");
    rateLimit(`invite:${ctx.merchantId}`, 20, 60_000);
    const body = await parseBody(req, createSchema);
    const { token, invitation } = await createInvitation({
      merchantId: ctx.merchantId,
      actorId: ctx.user.id,
      actorLabel: ctx.user.email,
      email: body.email,
      role: body.role,
      fullName: body.fullName,
      ip: await clientIp(),
    });
    // Le lien brut n'est retourné qu'UNE fois, à l'invitant, jamais relu ensuite.
    const link = `${originFromRequest(req)}/invitation?token=${token}`;
    return ok({ ok: true, invitation, link }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await requirePermission("users.write");
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new HttpError(400, "Identifiant d'invitation manquant.", "bad_request");
    await revokeInvitation({
      merchantId: ctx.merchantId,
      invitationId: id,
      actorId: ctx.user.id,
      actorLabel: ctx.user.email,
      ip: await clientIp(),
    });
    return ok({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
