"use client";

/**
 * Onboarding court après une première connexion Google/Apple.
 *
 * Le fournisseur social ne fournit ni nom de boutique ni téléphone algérien.
 * Tant que ce formulaire n'est pas validé, AUCUN marchand n'existe : la
 * création est atomique côté serveur (marchand + rôle OWNER + abonnement
 * d'essai + automatisations + modèles), avec annulation totale en cas d'échec.
 *
 * Cette page vit hors du groupe /onboarding, dont la mise en page exige déjà
 * un marchand actif — ce que l'utilisateur n'a, par définition, pas encore.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/marketing/site";
import { Card, Button, Input, Field, useToast } from "@/components/ui";
import { makeT } from "@/lib/i18n";

export default function BienvenuePage() {
  const locale = useLocale();
  const t = makeT(locale);
  const router = useRouter();
  const { push } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fd.get("full_name"),
          business: fd.get("business"),
          phone: fd.get("phone"),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error ?? t("auth.err.unknown"));
        return;
      }
      push({ variant: "success", title: locale === "ar" ? "تم إنشاء مساحتك" : "Votre espace est prêt" });
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(t("auth.err.unknown"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12">
      <Card className="w-full p-6">
        <h1 className="text-xl font-semibold text-ink-900">{t("auth.onboarding.title")}</h1>
        <p className="mt-1 text-[13px] text-ink-500">{t("auth.onboarding.desc")}</p>
        <form onSubmit={submit} className="mt-5 space-y-3.5">
          <Field label={t("auth.fullname")}>
            <Input name="full_name" required minLength={2} maxLength={80} />
          </Field>
          <Field label={t("auth.business")}>
            <Input name="business" required minLength={2} maxLength={80} />
          </Field>
          <Field label={t("auth.phone")}>
            <Input name="phone" required inputMode="tel" dir="ltr" placeholder="0550 12 34 56" />
          </Field>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
          )}
          <Button type="submit" variant="primary" className="w-full justify-center" loading={loading}>
            {t("auth.onboarding.submit")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
