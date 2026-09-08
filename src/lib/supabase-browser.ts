"use client";

/**
 * Client Supabase pour le NAVIGATEUR.
 *
 * N'utilise que la clé publiable (anon), conçue pour être exposée : elle est
 * inopérante sans les politiques RLS. La clé `service_role` ne doit JAMAIS
 * apparaître dans un fichier client.
 *
 * Le flux PKCE est imposé : le code d'autorisation OAuth ne peut pas être
 * rejoué par un tiers qui intercepterait l'URL de redirection.
 */
import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !key) {
    throw new Error("Authentification indisponible : configuration Supabase manquante.");
  }
  client = createBrowserClient(url, key, {
    auth: { flowType: "pkce", autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
  });
  return client;
}

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
