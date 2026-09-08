"use client";

/**
 * Acceptation d'une invitation d'équipe (lien à usage unique).
 *
 * `/invitation?token=...` — page publique, accessible sans session.
 *
 * Trois cas, décidés côté serveur (GET /api/auth/invitation) :
 *   - nouvel invité          : nom complet + mot de passe à créer ;
 *   - compte existant (mdp)  : mot de passe du compte exigé (anti-usurpation :
 *                              l'invitant voit le lien, il ne connaît pas le
 *                              mot de passe) ;
 *   - compte social          : l'invité doit déjà être connecté sur ce compte.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/components/marketing/site";
import { Card, Button, Input, Field, Badge, useToast } from "@/components/ui";
import { makeT } from "@/lib/i18n";
import { PasswordStrength, passwordScore } from "@/components/auth/social";

type Preview = {
  status: "pending" | "accepted" | "revoked" | "expired" | "invalid" | "loading";
  email: string;
  merchantName: string;
  role: string;
  fullName: string | null;
  expiresAt: string | null;
  existingAccount: boolean;
  alreadyAuthenticatedAsInvitee: boolean;
};

export default function InvitationPage() {
  const locale = useLocale();
  const ar = locale === "ar";
  const t = makeT(locale);
  const router = useRouter();
  const { push } = useToast();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/auth/invitation?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) setPreview({ ...json, status: res.ok ? json.status : "invalid" });
      } catch {
        if (!cancelled) setPreview({ status: "invalid", email: "", merchantName: "", role: "agent", fullName: null, expiresAt: null, existingAccount: false, alreadyAuthenticatedAsInvitee: false });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const withLang = (h: string) => (ar ? `${h}?lang=ar` : h);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const fullName = String(fd.get("fullName") ?? "").trim();
    const pw = String(fd.get("password") ?? "");

    if (!preview?.existingAccount) {
      if (passwordScore(pw) < 2) {
        setError(t("auth.pw.hint"));
        return;
      }
      if (pw !== confirm) {
        setError(t("auth.password.mismatch"));
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          fullName: fullName || undefined,
          password: pw || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error ?? t("auth.err.unknown"));
        return;
      }
      push({ variant: "success", title: t("invite.done") });
      router.push(json.redirect ?? "/dashboard");
      router.refresh();
    } catch {
      setError(t("auth.err.unknown"));
    } finally {
      setLoading(false);
    }
  }

  const status = preview?.status ?? "loading";
  const roleLabel = preview?.role === "admin" ? t("invite.role.admin") : t("invite.role.agent");

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12">
      <Card className="w-full p-6">
        {status === "loading" ? (
          <p className="py-8 text-center text-[13px] text-ink-500">…</p>
        ) : status !== "pending" || !preview ? (
          <>
            <h1 className="text-xl font-semibold text-ink-900">{t("invite.title")}</h1>
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] text-amber-800">
              {status === "expired" && t("invite.err.expired")}
              {status === "revoked" && t("invite.err.revoked")}
              {status === "accepted" && t("invite.err.used")}
              {status === "invalid" && t("invite.err.invalid")}
            </div>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-ink-900">{t("invite.title")}</h1>
            <p className="mt-1 text-[13px] text-ink-500">
              {ar ? (
                <>دعتك متجر <span className="font-semibold text-ink-800">{preview.merchantName}</span> للانضمام إلى فريقها كـ {roleLabel}.</>
              ) : (
                <>La boutique <span className="font-semibold text-ink-800">{preview.merchantName}</span> vous invite à rejoindre son équipe en tant que {roleLabel}.</>
              )}
            </p>
            <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-500">
              <Badge tone="blue" dot>{preview.email}</Badge>
              <Badge tone="violet">{roleLabel}</Badge>
            </div>

            <form onSubmit={submit} className="mt-5 space-y-3.5">
              {!preview.existingAccount && (
                <Field label={t("auth.fullname")}>
                  <Input name="fullName" required minLength={2} maxLength={80} defaultValue={preview.fullName ?? ""} autoComplete="name" />
                </Field>
              )}
              {preview.existingAccount ? (
                !preview.alreadyAuthenticatedAsInvitee && (
                  <Field
                    label={t("auth.password")}
                    hint={ar ? "لدى حساب بهذا البريد. أكد كلمة مروره للانضمام." : "Un compte existe déjà avec cet email : confirmez son mot de passe pour rejoindre l'équipe."}
                  >
                    <Input name="password" type="password" required autoComplete="current-password" dir="ltr" />
                  </Field>
                )
              ) : (
                <>
                  <Field label={t("auth.password")}>
                    <Input name="password" type="password" required autoComplete="new-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
                    <PasswordStrength value={password} locale={locale} />
                  </Field>
                  <Field label={t("auth.password.confirm")}>
                    <Input name="confirm" type="password" required autoComplete="new-password" dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                  </Field>
                </>
              )}
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
              )}
              <Button type="submit" variant="primary" className="w-full justify-center" loading={loading}>
                {preview.existingAccount ? t("invite.confirm.identity") : t("invite.accept")}
              </Button>
            </form>

            {preview.existingAccount && (
              <p className="mt-4 text-center text-[12.5px] text-ink-500">
                {ar ? "الرابط صالح لمرة واحدة." : "Ce lien ne peut être utilisé qu'une seule fois."}
              </p>
            )}
          </>
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
