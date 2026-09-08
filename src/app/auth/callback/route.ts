/**
 * Callback OAuth / lien email (PKCE).
 *
 * Reçoit le `code` renvoyé par Supabase après une connexion Google/Apple, une
 * confirmation d'email ou une réinitialisation de mot de passe, puis l'échange
 * côté serveur contre une session. L'échange PKCE se fait ici, jamais dans le
 * navigateur : le code ne peut pas être rejoué.
 *
 * Aucune erreur technique brute n'est renvoyée à l'utilisateur : on redirige
 * vers /login avec un code d'erreur que l'interface traduit en français.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient, supabaseAuthEnabled } from "@/server/auth/supabase";
import { linkSupabaseIdentity } from "@/server/auth/identity";

export const runtime = "nodejs";

function redirect(req: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, req.nextUrl.origin));
}

export async function GET(req: NextRequest) {
  if (!supabaseAuthEnabled()) return redirect(req, "/login?error=config");

  const code = req.nextUrl.searchParams.get("code");
  // Supabase renvoie ses propres erreurs (lien expiré, accès refusé...).
  const providerError = req.nextUrl.searchParams.get("error");
  const errorCode = req.nextUrl.searchParams.get("error_code");

  if (providerError) {
    const expired = errorCode === "otp_expired" || providerError === "access_denied";
    return redirect(req, `/login?error=${expired ? "expired" : "oauth"}`);
  }
  if (!code) return redirect(req, "/login?error=oauth");

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) return redirect(req, "/login?error=expired");

    const u = data.user;
    const email = (u.email ?? "").toLowerCase();
    if (!email) return redirect(req, "/login?error=no_email");

    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const outcome = await linkSupabaseIdentity({
      id: u.id,
      email,
      emailVerified: Boolean(u.email_confirmed_at ?? u.confirmed_at),
      fullName:
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        null,
      provider: u.app_metadata?.provider ?? "email",
    });

    // La réinitialisation de mot de passe atterrit aussi ici : on envoie
    // l'utilisateur vers le formulaire de nouveau mot de passe.
    if (req.nextUrl.searchParams.get("type") === "recovery") {
      return redirect(req, "/reset-password");
    }

    switch (outcome.status) {
      case "email_unverified":
        // Fusion refusée : email non vérifié par le fournisseur.
        await supabase.auth.signOut();
        return redirect(req, "/login?error=unverified");
      case "inactive":
        await supabase.auth.signOut();
        return redirect(req, "/login?error=inactive");
      case "created":
        return redirect(req, "/bienvenue");
      case "linked":
        // Compte social existant mais onboarding jamais terminé.
        return redirect(req, outcome.hasMerchant ? "/dashboard" : "/bienvenue");
    }
  } catch {
    return redirect(req, "/login?error=unknown");
  }
}
