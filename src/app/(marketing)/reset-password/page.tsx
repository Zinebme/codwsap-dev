"use client";

/**
 * Définition d'un nouveau mot de passe.
 *
 * Accessible uniquement après un lien de récupération valide : /auth/callback
 * a échangé le code contre une session temporaire. Sans cette session,
 * Supabase refuse la mise à jour — le formulaire ne peut donc pas servir à
 * changer le mot de passe d'un tiers.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/marketing/site";
import { Card, Button, Input, Field, useToast } from "@/components/ui";
import { makeT } from "@/lib/i18n";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase-browser";
import { PasswordStrength, passwordScore } from "@/components/auth/social";

export default function ResetPasswordPage() {
  const locale = useLocale();
  const t = makeT(locale);
  const router = useRouter();
  const { push } = useToast();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const withLang = (h: string) => (locale === "ar" ? `${h}?lang=ar` : h);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError(t("auth.password.mismatch"));
      return;
    }
    if (passwordScore(password) < 2) {
      setError(t("auth.pw.hint"));
      return;
    }
    if (!supabaseConfigured()) {
      setError(t("auth.err.config"));
      return;
    }

    setLoading(true);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        // Cas le plus fréquent : lien expiré ou déjà consommé.
        setError(t("auth.err.expired"));
        return;
      }
      push({ variant: "success", title: t("auth.reset.done") });
      router.push(withLang("/login"));
    } catch {
      setError(t("auth.err.unknown"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12">
      <Card className="w-full p-6">
        <h1 className="text-xl font-semibold text-ink-900">{t("auth.reset.title")}</h1>
        <form onSubmit={submit} className="mt-5 space-y-3.5">
          <Field label={t("auth.password")}>
            <Input
              type="password"
              required
              minLength={8}
              dir="ltr"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordStrength value={password} locale={locale} />
          </Field>
          <Field label={t("auth.password.confirm")}>
            <Input
              type="password"
              required
              minLength={8}
              dir="ltr"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
          )}
          <Button type="submit" variant="primary" className="w-full justify-center" loading={loading}>
            {t("auth.reset.submit")}
          </Button>
        </form>
        <p className="mt-4 text-center text-[13px] text-ink-500">
          <Link href={withLang("/login")} className="font-medium text-brand-600 hover:underline">
            {t("nav.login")}
          </Link>
        </p>
      </Card>
    </div>
  );
}
