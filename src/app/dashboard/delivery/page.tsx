"use client";

import * as React from "react";
import useSWR from "swr";
import { Truck, Plus, Plug, Trash2, Star, AlertTriangle, CheckCircle2, HelpCircle, Search, Lock, Package, RotateCcw, Webhook, Radar, Printer, XCircle } from "lucide-react";
import { fetcher } from "@/components/dashboard/shell";
import { useDashLocale, useFormat } from "@/components/dashboard/locale";
import { PageHeader } from "@/components/dashboard/common";
import { Card, CardHeader, CardTitle, CardBody, Button, Badge, Modal, Field, Input, Textarea, Toggle, Skeleton, EmptyState, useToast } from "@/components/ui";

type Caps = Record<string, boolean>;
type GridCaps = Record<string, boolean>;
type Conn = {
  id: string; provider: string; label: string; status: string; is_default: number; is_active: number;
  last_sync_at: string | null; last_error: string | null; last_error_at: string | null; capabilities: Caps;
};
type CredField = { key: string; label: string; type: string; required: boolean; help?: string };
type Provider = {
  id: string; label: string; logoTone: string; engine: string; engineLabel: string; family: string;
  docStatus: "public" | "engine" | "unverified"; website: string | null; note: string | null;
  capabilities: Caps; grid: GridCaps; requiresDocumentation: boolean; fields: CredField[];
};

const CAP_LABELS: Record<string, { fr: string; ar: string }> = {
  supportsCreateShipment: { fr: "Création d'expédition", ar: "إنشاء شحنة" },
  supportsUpdateShipment: { fr: "Modification", ar: "تعديل" },
  supportsCancelShipment: { fr: "Annulation", ar: "إلغاء" },
  supportsTracking: { fr: "Suivi colis", ar: "تتبع" },
  supportsWebhooks: { fr: "Webhooks", ar: "ويب هوك" },
  supportsStatusPolling: { fr: "Polling statut", ar: "استعلام دوري" },
};

/** Capacités affichées sur la carte de chaque société. */
const GRID_CAPS: { key: string; icon: React.ElementType; fr: string; ar: string }[] = [
  { key: "createShipment", icon: Package, fr: "Créer expédition", ar: "إنشاء شحنة" },
  { key: "tracking", icon: Radar, fr: "Suivi", ar: "تتبع" },
  { key: "cancelShipment", icon: RotateCcw, fr: "Annulation", ar: "إلغاء" },
  { key: "webhook", icon: Webhook, fr: "Webhook", ar: "ويب هوك" },
  { key: "polling", icon: Radar, fr: "Polling", ar: "استعلام" },
  { key: "labelPrinting", icon: Printer, fr: "Étiquette", ar: "ملصق" },
];

const FAMILY_LABELS: Record<string, { fr: string; ar: string }> = {
  all: { fr: "Tous", ar: "الكل" },
  yalidine: { fr: "Famille Yalidine", ar: "عائلة Yalidine" },
  procolis: { fr: "Famille Procolis", ar: "عائلة Procolis" },
  ecotrack: { fr: "EcoTrack", ar: "EcoTrack" },
  independent: { fr: "Indépendants", ar: "مستقلون" },
  generic: { fr: "Génériques", ar: "عام" },
};

const TONE_CLASS: Record<string, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  teal: "bg-teal-50 text-teal-700 border-teal-200",
  red: "bg-red-50 text-red-700 border-red-200",
  slate: "bg-ink-100 text-ink-600 border-ink-200",
};

/** Logo de repli : initiales de la société, teinte issue du catalogue. */
function CarrierLogo({ name, tone, size = "md" }: { name: string; tone: string; size?: "sm" | "md" }) {
  const initials = name.replace(/[^A-Za-z\u0600-\u06FF ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  const dim = size === "sm" ? "h-8 w-8 text-[11px]" : "h-10 w-10 text-[12.5px]";
  return (
    <div className={`flex ${dim} shrink-0 items-center justify-center rounded-lg border font-semibold ${TONE_CLASS[tone] ?? TONE_CLASS.slate}`} aria-hidden>
      {initials}
    </div>
  );
}

export default function DeliveryPage() {
  const { locale } = useDashLocale();
  const f = useFormat();
  const ar = locale === "ar";
  const { push } = useToast();
  const { data, isLoading, mutate } = useSWR<{ rows: Conn[]; providers: Provider[] }>("/api/delivery/connections", fetcher);
  const [connecting, setConnecting] = React.useState<Provider | null>(null);
  const [editing, setEditing] = React.useState<Conn | null>(null);
  const [requesting, setRequesting] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [family, setFamily] = React.useState("all");

  async function test(id: string) {
    setTestingId(id);
    const res = await fetch(`/api/delivery/connections/${id}`, { method: "POST" });
    const json = await res.json();
    push({ variant: json.ok ? "success" : "error", title: json.message ?? (ar ? "تم الاختبار" : "Test effectué") });
    setTestingId(null);
    mutate();
  }

  async function remove(id: string) {
    if (!confirm(ar ? "حذف هذا الاتصال؟" : "Supprimer cette connexion transporteur ?")) return;
    await fetch(`/api/delivery/connections/${id}`, { method: "DELETE" });
    mutate();
  }

  // Mémoïsé : sans cela, `?? []` crée un tableau neuf à chaque rendu et
  // invalide les useMemo de filtrage (grille recalculée en permanence).
  const providers = React.useMemo(() => data?.providers ?? [], [data?.providers]);
  const connectedByProvider = React.useMemo(() => {
    const m = new Map<string, Conn>();
    for (const r of data?.rows ?? []) if (!m.has(r.provider)) m.set(r.provider, r);
    return m;
  }, [data?.rows]);

  const families = React.useMemo(() => {
    const set = new Set(providers.map((p) => p.family));
    return ["all", ...["yalidine", "procolis", "ecotrack", "independent", "generic"].filter((x) => set.has(x))];
  }, [providers]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return providers.filter((p) => {
      if (family !== "all" && p.family !== family) return false;
      if (!q) return true;
      return p.label.toLowerCase().includes(q) || p.engineLabel.toLowerCase().includes(q) || p.id.includes(q);
    });
  }, [providers, query, family]);

  return (
    <div className="space-y-3">
      <PageHeader
        title={ar ? "الشحن والتوصيل" : "Livraison"}
        subtitle={ar ? "اربط شركات التوصيل. الحالات تُوحَّد داخليا مع الاحتفاظ بالحالة الأصلية." : "Connectez vos transporteurs. Les statuts sont normalisés en interne, le statut brut est conservé."}
        actions={
          <Button size="sm" onClick={() => setRequesting(true)}>
            <HelpCircle className="h-3.5 w-3.5" /> {ar ? "شركتي غير مدرجة" : "Transporteur non listé"}
          </Button>
        }
      />

      {/* ------------------------- Connexions actives ------------------------- */}
      {isLoading || !data ? (
        <div className="grid gap-3 lg:grid-cols-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-[14px]" />)}</div>
      ) : data.rows.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.rows.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-2.5">
                  <CarrierLogo name={providers.find((p) => p.id === c.provider)?.label ?? c.label} tone={providers.find((p) => p.id === c.provider)?.logoTone ?? "slate"} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13.5px] font-semibold text-ink-900">{c.label}</p>
                      {!!c.is_default && <Badge tone="blue"><Star className="me-1 inline h-2.5 w-2.5" />{ar ? "افتراضي" : "Par défaut"}</Badge>}
                      <Badge tone={c.status === "connected" ? "green" : c.status === "error" ? "red" : "gray"} dot>
                        {c.status === "connected" ? (ar ? "متصل" : "Connecté") : c.status === "error" ? (ar ? "خطأ" : "Erreur") : ar ? "غير متصل" : "Déconnecté"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[12px] text-ink-500">{providers.find((p) => p.id === c.provider)?.label ?? c.provider}</p>
                  </div>
                </div>
                <Toggle checked={!!c.is_active} onChange={async (v) => { await fetch(`/api/delivery/connections/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: v }) }); mutate(); }} />
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(c.capabilities).map(([k, v]) => (
                  <span key={k} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${v ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-ink-200 bg-ink-50 text-ink-400"}`}>
                    {v ? <CheckCircle2 className="h-2.5 w-2.5" /> : null}
                    {ar ? CAP_LABELS[k]?.ar ?? k : CAP_LABELS[k]?.fr ?? k}
                  </span>
                ))}
              </div>

              {c.last_error && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50/70 p-2.5 text-[12px] text-red-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{c.last_error} <span className="text-red-400">· {f.dateTime(c.last_error_at)}</span></span>
                </div>
              )}

              <div className="mt-3 flex items-center justify-between border-t border-ink-100 pt-2.5">
                <span className="text-[11.5px] text-ink-500">{ar ? "آخر مزامنة" : "Dernière synchro"} : {f.dateTime(c.last_sync_at)}</span>
                <div className="flex gap-1.5">
                  <Button size="sm" loading={testingId === c.id} onClick={async () => await test(c.id)}><Plug className="h-3.5 w-3.5" /> {ar ? "اختبار" : "Tester"}</Button>
                  <Button size="sm" onClick={() => setEditing(c)}>{ar ? "إعداد" : "Configurer"}</Button>
                  <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={async () => await remove(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={Truck}
            title={ar ? "لا يوجد ناقل مرتبط" : "Aucun transporteur connecté"}
            description={ar ? "اختر شركة توصيل من القائمة أدناه لإرسال الطرود وتتبعها تلقائيا." : "Choisissez une société ci-dessous pour expédier et suivre vos colis automatiquement."}
          />
        </Card>
      )}

      {/* --------------------- Catalogue des transporteurs -------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>{ar ? "شركات التوصيل" : "Sociétés de livraison"}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={ar ? "ابحث عن شركة توصيل…" : "Rechercher une société…"}
                className="ps-8"
                aria-label={ar ? "بحث" : "Rechercher"}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {families.map((fam) => (
                <button
                  key={fam}
                  type="button"
                  onClick={() => setFamily(fam)}
                  className={`rounded-lg border px-2.5 py-1 text-[12px] transition ${family === fam ? "border-brand-300 bg-brand-50 text-brand-700" : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50"}`}
                >
                  {ar ? FAMILY_LABELS[fam]?.ar ?? fam : FAMILY_LABELS[fam]?.fr ?? fam}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-[14px]" />)}</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              title={ar ? "لا نتيجة" : "Aucun résultat"}
              description={ar ? "لم نجد شركة بهذا الاسم. يمكنك طلب إضافتها." : "Aucune société ne correspond. Vous pouvez demander son ajout."}
              action={<Button onClick={() => setRequesting(true)}><HelpCircle className="h-3.5 w-3.5" /> {ar ? "اطلب إضافتها" : "Demander l'ajout"}</Button>}
            />
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((p) => {
                const conn = connectedByProvider.get(p.id);
                return (
                  <div key={p.id} className="flex flex-col rounded-[14px] border border-ink-200 bg-white p-3 transition hover:border-ink-300 hover:shadow-sm">
                    <div className="flex items-start gap-2.5">
                      <CarrierLogo name={p.label} tone={p.logoTone} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-ink-900">{p.label}</p>
                        <p className="mt-0.5 truncate text-[11.5px] text-ink-500">{p.engineLabel}</p>
                      </div>
                      {conn ? (
                        <Badge tone={conn.status === "connected" ? "green" : conn.status === "error" ? "red" : "gray"} dot>
                          {conn.status === "connected" ? (ar ? "متصل" : "Connecté") : conn.status === "error" ? (ar ? "خطأ" : "Erreur") : ar ? "غير متصل" : "Déconnecté"}
                        </Badge>
                      ) : null}
                    </div>

                    {p.requiresDocumentation && (
                      <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-[11px] text-amber-800">
                        <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                        <span>{ar ? "مطلوب بيانات اعتماد/وثائق من الناقل." : "Identifiants/documentation requis auprès du transporteur."}</span>
                      </div>
                    )}
                    {p.note && !p.requiresDocumentation && (
                      <p className="mt-2 rounded-lg bg-ink-50 p-2 text-[11px] text-ink-500">{p.note}</p>
                    )}

                    <div className="mt-2.5 flex flex-wrap gap-1">
                      {GRID_CAPS.map(({ key, icon: Icon, fr, ar: arLabel }) => {
                        const on = p.grid?.[key];
                        return (
                          <span
                            key={key}
                            title={ar ? arLabel : fr}
                            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] ${on ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-ink-200 bg-ink-50 text-ink-400"}`}
                          >
                            <Icon className="h-2.5 w-2.5" />
                            {ar ? arLabel : fr}
                          </span>
                        );
                      })}
                    </div>

                    <div className="mt-auto flex gap-1.5 border-t border-ink-100 pt-2.5" style={{ marginTop: "0.75rem" }}>
                      {conn ? (
                        <>
                          <Button size="sm" loading={testingId === conn.id} onClick={async () => await test(conn.id)}>
                            <Plug className="h-3.5 w-3.5" /> {ar ? "اختبار" : "Tester"}
                          </Button>
                          <Button size="sm" onClick={() => setEditing(conn)}>{ar ? "إعداد" : "Configurer"}</Button>
                          <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={async () => await remove(conn.id)} aria-label={ar ? "فصل" : "Déconnecter"}>
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="primary" onClick={() => setConnecting(p)}>
                          <Plus className="h-3.5 w-3.5" /> {ar ? "ربط" : "Connecter"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="flex items-center gap-1.5 rounded-lg bg-ink-50 p-2.5 text-[11.5px] text-ink-500">
            <Lock className="h-3 w-3 shrink-0" />
            {ar
              ? "تُخزَّن كل بيانات الاعتماد مشفرة على الخادم ولا تُرسل أبدا إلى المتصفح."
              : "Tous les identifiants sont chiffrés côté serveur et ne sont jamais renvoyés au navigateur."}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{ar ? "الويب هوك والتتبع" : "Webhooks & suivi"}</CardTitle></CardHeader>
        <CardBody className="space-y-2 text-[12.5px] text-ink-600">
          <p>
            {ar
              ? "لكل اتصال رابط ويب هوك خاص مع توقيع HMAC-SHA256 عبر ترويسة x-signature. إذا لم يدعم الناقل الويب هوك، تعتمد المنصة على استعلام دوري في الخلفية."
              : "Chaque connexion dispose d'une URL webhook dédiée signée en HMAC-SHA256 (en-tête x-signature). Si le transporteur ne gère pas les webhooks, un polling de secours tourne en arrière-plan."}
          </p>
          {data?.rows.map((c) => (
            <code key={c.id} className="block truncate rounded-lg bg-ink-100 px-2 py-1.5 text-[11.5px]" dir="ltr">
              {typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/delivery/{c.id}
            </code>
          ))}
        </CardBody>
      </Card>

      <ConnectionModal
        open={!!connecting || !!editing}
        conn={editing}
        provider={editing ? providers.find((p) => p.id === editing.provider) ?? null : connecting}
        ar={ar}
        onClose={() => { setConnecting(null); setEditing(null); }}
        onSaved={() => { setConnecting(null); setEditing(null); mutate(); }}
      />
      <RequestModal open={requesting} ar={ar} onClose={() => setRequesting(false)} />
    </div>
  );
}

function ConnectionModal({ open, conn, provider, ar, onClose, onSaved }: { open: boolean; conn: Conn | null; provider: Provider | null; ar: boolean; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast();
  const [busy, setBusy] = React.useState(false);
  const p = provider;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!p) return;
    const fd = new FormData(e.currentTarget);
    const credentials: Record<string, string> = {};
    for (const field of p.fields ?? []) credentials[field.key] = String(fd.get(field.key) ?? "");
    setBusy(true);
    try {
      const res = await fetch(conn ? `/api/delivery/connections/${conn.id}` : "/api/delivery/connections", {
        method: conn ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: p.id, label: fd.get("label"), credentials, isDefault: fd.get("isDefault") === "on" }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Erreur");

      // On teste la connexion immédiatement : une société n'est marquée
      // « connectée » qu'après une vérification réelle auprès du transporteur.
      const id = conn?.id ?? json.id;
      if (id) {
        const t = await fetch(`/api/delivery/connections/${id}`, { method: "POST" });
        const tj = await t.json().catch(() => ({}));
        push({
          variant: tj?.ok ? "success" : "error",
          title: tj?.ok ? (ar ? "تم الربط بنجاح" : "Transporteur connecté") : (ar ? "حُفظ لكن الاختبار فشل" : "Enregistré, mais le test a échoué"),
          description: tj?.message,
        });
      } else {
        push({ variant: "success", title: ar ? "تم الحفظ" : "Transporteur enregistré" });
      }
      onSaved();
    } catch (err) {
      push({ variant: "error", title: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-lg"
      title={conn ? (ar ? "إعداد الناقل" : "Configurer le transporteur") : `${ar ? "ربط" : "Connecter"} ${p?.label ?? ""}`}
      footer={
        <>
          <Button onClick={onClose}>{ar ? "إلغاء" : "Annuler"}</Button>
          <Button variant="primary" type="submit" form="dlc-form" loading={busy}>{ar ? "حفظ واختبار" : "Enregistrer et tester"}</Button>
        </>
      }
    >
      <form id="dlc-form" onSubmit={submit} className="space-y-3.5">
        {p && (
          <div className="flex items-center gap-2.5 rounded-lg border border-ink-200 bg-ink-50/60 p-2.5">
            <CarrierLogo name={p.label} tone={p.logoTone} size="sm" />
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-ink-900">{p.label}</p>
              <p className="text-[11.5px] text-ink-500">{p.engineLabel}</p>
            </div>
          </div>
        )}

        {p?.requiresDocumentation && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-[11.5px] text-amber-800">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {ar
                ? "لم يتم التحقق من واجهة هذه الشركة علنا. اطلب من الناقل رابط الواجهة والمفتاح، ثم أدخلهما هنا."
                : "L'API de cette société n'est pas documentée publiquement. Demandez à votre transporteur l'URL de son API et votre jeton, puis renseignez-les ci-dessous."}
            </span>
          </div>
        )}

        <Field label={ar ? "التسمية" : "Libellé"}>
          <Input name="label" required defaultValue={conn?.label ?? p?.label ?? ""} />
        </Field>

        {p?.fields.map((field) => (
          <Field key={field.key} label={field.label} hint={conn ? (ar ? "اتركه فارغا للاحتفاظ بالقيمة الحالية." : "Laissez vide pour conserver la valeur actuelle.") : field.help}>
            <Input name={field.key} type={field.type === "password" ? "password" : "text"} dir="ltr" required={field.required && !conn} />
          </Field>
        ))}

        <label className="flex items-center gap-2 text-[13px] text-ink-700">
          <input type="checkbox" name="isDefault" defaultChecked={!!conn?.is_default} className="h-4 w-4 rounded border-ink-300" />
          {ar ? "استخدمه كناقل افتراضي" : "Utiliser comme transporteur par défaut"}
        </label>

        <p className="rounded-lg bg-ink-50 p-2.5 text-[11.5px] text-ink-500">
          {ar ? "تُخزَّن المفاتيح مشفرة على الخادم ولا تُرسل أبدا إلى المتصفح." : "Les clés API sont chiffrées côté serveur et ne sont jamais renvoyées au navigateur."}
        </p>
      </form>
    </Modal>
  );
}

function RequestModal({ open, ar, onClose }: { open: boolean; ar: boolean; onClose: () => void }) {
  const { push } = useToast();
  const [busy, setBusy] = React.useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={ar ? "اطلب إضافة ناقل" : "Demander un transporteur"}
      footer={
        <>
          <Button onClick={onClose}>{ar ? "إلغاء" : "Annuler"}</Button>
          <Button variant="primary" type="submit" form="prq-form" loading={busy}>{ar ? "إرسال الطلب" : "Envoyer la demande"}</Button>
        </>
      }
    >
      <form
        id="prq-form"
        className="space-y-3.5"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setBusy(true);
          const res = await fetch("/api/delivery/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerName: fd.get("providerName"), contact: fd.get("contact"), details: fd.get("details") }),
          });
          setBusy(false);
          if (res.ok) { push({ variant: "success", title: ar ? "تم إرسال طلبك" : "Demande transmise à notre équipe" }); onClose(); }
        }}
      >
        <Field label={ar ? "اسم شركة التوصيل" : "Nom du transporteur"}><Input name="providerName" required /></Field>
        <Field label={ar ? "جهة الاتصال (اختياري)" : "Contact (optionnel)"}><Input name="contact" /></Field>
        <Field label={ar ? "تفاصيل / رابط الواجهة" : "Détails / lien vers leur API"}><Textarea name="details" rows={3} /></Field>
      </form>
    </Modal>
  );
}
