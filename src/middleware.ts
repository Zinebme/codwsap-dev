/**
 * Rafraîchissement des sessions Supabase (SSR).
 *
 * Les jetons d'accès Supabase expirent au bout d'une heure. Sans
 * rafraîchissement, un marchand resté ouvert dans son onglet serait déconnecté
 * en pleine saisie. `getUser()` déclenche le renouvellement et le middleware
 * réécrit les cookies mis à jour sur la réponse.
 *
 * Ce middleware n'AUTORISE rien : il ne fait que maintenir la session. Toute
 * décision d'accès (authentification, tenant, rôle) reste prise côté serveur
 * dans `requireTenant` / `requirePermission`, seuls endroits où la base fait
 * autorité. Un middleware ne doit jamais être l'unique barrière de sécurité.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: { headers: req.headers } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Supabase non configuré : l'application fonctionne avec l'authentification
  // locale historique, on ne bloque rien.
  if (!url || !key) return res;

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return req.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
        },
        setAll(list) {
          for (const { name, value, options } of list) {
            res.cookies.set({
              name,
              value,
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
              path: "/",
            });
          }
        },
      },
    });
    await supabase.auth.getUser();
  } catch {
    // Une panne d'authentification ne doit pas rendre le site inaccessible.
  }

  return res;
}

export const config = {
  // On évite les fichiers statiques et les images : inutile d'y rafraîchir une
  // session, et cela coûterait une requête réseau par asset.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
