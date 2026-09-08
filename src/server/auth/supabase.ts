/**
 * Clients Supabase Auth (identité uniquement).
 *
 * PÉRIMÈTRE
 * ---------
 * Supabase Auth ne gère QUE l'identité : mot de passe, vérification d'email,
 * OAuth Google/Apple, réinitialisation. Toutes les données métier (marchands,
 * rôles, abonnements, permissions) restent dans la base CODWSAP, interrogée
 * via `@/server/db`.
 *
 * SÉCURITÉ
 * --------
 * Seule la clé PUBLIABLE (anon) est utilisée, y compris côté serveur. La clé
 * `service_role` n'est jamais lue par ce module : elle contournerait la RLS et
 * ne doit exister dans aucun code exécuté par cette application.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/**
 * L'authentification Supabase est-elle configurée ?
 *
 * Tant que les variables sont absentes, l'application continue de fonctionner
 * avec l'authentification locale historique : le déploiement existant n'est
 * jamais cassé par une configuration incomplète.
 */
export function supabaseAuthEnabled(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

/**
 * Client Supabase côté serveur (composants serveur, routes API).
 *
 * Lit et écrit la session dans les cookies de la requête courante, ce qui rend
 * les sessions persistantes en SSR. Le flux PKCE est imposé : le code OAuth est
 * échangé côté serveur, jamais exposé dans l'URL du navigateur.
 */
export async function createSupabaseServerClient() {
  const jar = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: "pkce", autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    cookies: {
      getAll() {
        return jar.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(list: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          for (const { name, value, options } of list) {
            jar.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
              path: "/",
            });
          }
        } catch {
          // `cookies()` est en lecture seule dans les composants serveur :
          // le rafraîchissement est alors assuré par le middleware.
        }
      },
    },
  });
}

/**
 * Utilisateur Supabase authentifié, ou null.
 *
 * On utilise `getUser()` (et non `getSession()`) car il valide le jeton auprès
 * du serveur Supabase : un cookie forgé localement est rejeté.
 */
export async function supabaseUser(): Promise<{
  id: string;
  email: string;
  emailVerified: boolean;
  fullName: string | null;
  provider: string;
} | null> {
  if (!supabaseAuthEnabled()) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    const u = data.user;
    const email = (u.email ?? "").toLowerCase();
    if (!email) return null;

    // Supabase expose la vérification via email_confirmed_at / confirmed_at.
    const emailVerified = Boolean(u.email_confirmed_at ?? u.confirmed_at);
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const fullName =
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      null;

    return {
      id: u.id,
      email,
      emailVerified,
      fullName,
      provider: u.app_metadata?.provider ?? "email",
    };
  } catch {
    return null;
  }
}
