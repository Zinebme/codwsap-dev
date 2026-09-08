"use client";

/**
 * Boutons de connexion sociale + indicateur de robustesse du mot de passe.
 *
 * Google est pleinement câblé. Apple est affiché en « Bientôt disponible » :
 * l'architecture est en place (même flux PKCE, un seul identifiant de
 * fournisseur à changer), mais le programme développeur Apple n'est pas encore
 * configuré. On préfère un bouton honnêtement désactivé à un bouton qui échoue.
 */
import * as React from "react";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase-browser";
import { makeT, type Locale } from "@/lib/i18n";

export function SocialButtons({ locale, disabled }: { locale: Locale; disabled?: boolean }) {
  const t = makeT(locale);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function signInWithGoogle() {
    setError(null);
    if (!supabaseConfigured()) {
      setError(t("auth.err.config"));
      return;
    }
    setBusy(true);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // Le code PKCE est échangé côté serveur par cette route.
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });
      if (error) {
        setError(t("auth.err.oauth"));
        setBusy(false);
      }
      // Succès : le navigateur part chez Google, on garde l'état occupé.
    } catch {
      setError(t("auth.err.oauth"));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-ink-200" />
        <span className="text-[11.5px] uppercase tracking-wide text-ink-400">{t("auth.or")}</span>
        <span className="h-px flex-1 bg-ink-200" />
      </div>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={busy || disabled}
        className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink-800 transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <GoogleMark />
        {t("auth.google")}
      </button>

      <div className="relative">
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={t("auth.apple.soon")}
          className="flex w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-lg border border-ink-200 bg-ink-50 px-4 py-2.5 text-[13.5px] font-medium text-ink-400"
        >
          <AppleMark />
          {t("auth.apple")}
          <span className="rounded-full bg-ink-200 px-2 py-0.5 text-[10.5px] font-semibold text-ink-600">
            {t("auth.apple.soon")}
          </span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
      )}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.36 12.78c.02 2.6 2.28 3.47 2.3 3.48-.02.06-.36 1.24-1.19 2.45-.72 1.05-1.47 2.1-2.65 2.12-1.16.02-1.53-.69-2.86-.69-1.32 0-1.74.67-2.83.71-1.14.04-2-1.13-2.73-2.18-1.49-2.15-2.63-6.08-1.1-8.73.76-1.32 2.12-2.15 3.59-2.17 1.11-.02 2.17.75 2.85.75.68 0 1.96-.93 3.3-.79.56.02 2.14.23 3.15 1.71-.08.05-1.88 1.1-1.86 3.28M14.2 4.6c.6-.73 1.01-1.75.9-2.76-.87.03-1.92.58-2.55 1.31-.56.64-1.05 1.68-.92 2.67.97.07 1.96-.49 2.57-1.22" />
    </svg>
  );
}

/**
 * Jauge de robustesse du mot de passe.
 *
 * Purement indicative côté client ; la contrainte réelle est appliquée par
 * Supabase et par le serveur. Elle guide l'utilisateur sans jamais être la
 * seule protection.
 */
export function passwordScore(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < 8) return pw.length === 0 ? 0 : 1;
  let variety = 0;
  if (/[a-z]/.test(pw)) variety++;
  if (/[A-Z]/.test(pw)) variety++;
  if (/\d/.test(pw)) variety++;
  if (/[^A-Za-z0-9]/.test(pw)) variety++;
  if (pw.length >= 12 && variety >= 3) return 3;
  if (variety >= 2) return 2;
  return 1;
}

export function PasswordStrength({ value, locale }: { value: string; locale: Locale }) {
  const t = makeT(locale);
  const score = passwordScore(value);
  if (!value) return <p className="mt-1 text-[11.5px] text-ink-400">{t("auth.pw.hint")}</p>;

  const labels = [t("auth.pw.weak"), t("auth.pw.weak"), t("auth.pw.medium"), t("auth.pw.strong")];
  const colors = ["bg-ink-200", "bg-red-500", "bg-amber-500", "bg-emerald-500"];
  const textColors = ["text-ink-400", "text-red-600", "text-amber-600", "text-emerald-600"];

  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i <= score ? colors[score] : "bg-ink-200"}`} />
        ))}
      </div>
      <p className={`mt-1 text-[11.5px] ${textColors[score]}`}>{labels[score]}</p>
    </div>
  );
}
