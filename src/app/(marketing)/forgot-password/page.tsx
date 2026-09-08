"use client";

/**
 * Demande de réinitialisation du mot de passe.
 *
 * Le message de confirmation est TOUJOURS le même, que l'email existe ou non :
 * révéler qu'une adresse est inconnue permettrait d'énumérer les comptes de la
 * plateforme.
 */
import * as React from "react";
import Link from "next/link";
import { useLocale } from "@/components/marketing/site";
import { Card, Button, Input, Field } from "@/components/ui";
import { makeT } from "@/lib/i18n";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase-browser";

export default function ForgotPasswordPage() {
  const locale = useLocale();
  const t = makeT(locale);
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const withLang = (h: string) => (locale === "ar" ? `${h}?lang=ar` : h);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    setError(null);

    if (!supabaseConfigured()) {
      setError(t("auth.err.config"));
      return;
    }

    setLoading(true);
    try {
      const supabase = supabaseBrowser();
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      });
      // On n'inspecte pas l'erreur : réponse identique dans tous les cas.
      setSent(true);
    } catch {
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12">
      <Card className="w-full p-6">
        <h1 className="text-xl font-semibold text-ink-900">{t("auth.forgot.title")}</h1>
        <p className="mt-1 text-[13px] text-ink-500">{t("auth.forgot.desc")}</p>

        {sent ? (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[13px] text-emerald-800">
            {t("auth.forgot.sent")}
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-3.5">
            <Field label={t("auth.email")}>
              <Input name="email" type="email" required autoComplete="email" dir="ltr" />
            </Field>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
            )}
            <Button type="submit" variant="primary" className="w-full justify-center" loading={loading}>
              {t("auth.forgot.submit")}
            </Button>
          </form>
        )}

        <p className="mt-4 text-center text-[13px] text-ink-500">
          <Link href={withLang("/login")} className="font-medium text-brand-600 hover:underline">
            {t("nav.login")}
          </Link>
        </p>
      </Card>
    </div>
  );
}
