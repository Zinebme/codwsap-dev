"use client";

import useSWR from "swr";
import { Activity, Webhook, ListRestart, RotateCcw, Trash2 } from "lucide-react";
import { AreaChart, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { fetcher } from "@/components/dashboard/shell";
import { Card, CardHeader, CardTitle, CardBody, Badge, Skeleton, EmptyState, Button, useToast } from "@/components/ui";
import type { Health } from "../types";

const fmt = new Intl.NumberFormat("fr-FR");
const dt = (v?: string | null) => (v ? new Date(v.includes("T") ? v : `${v.replace(" ", "T")}Z`).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

const JOB_LABELS: Record<string, string> = {
  send_whatsapp: "Envoi WhatsApp",
  poll_delivery: "Suivi colis",
  sync_sheet: "Sync Google Sheets",
  reminder: "Rappel client",
  notify_telegram: "Notification Telegram",
  wa_availability_check: "Vérification numéros WA",
};

export default function ObservabilityPage() {
  const { data, isLoading, mutate } = useSWR<Health>("/api/admin/health", fetcher, { refreshInterval: 30_000 });
  const { push } = useToast();

  if (isLoading || !data) return <div className="grid gap-3 md:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-[14px]" />)}</div>;

  async function jobAction(jobId: string, action: "retry" | "discard") {
    const res = await fetch("/api/admin/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, action }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return push({ variant: "error", title: json.error ?? "Action impossible" });
    push({ variant: "success", title: action === "retry" ? "Tâche remise dans la file" : "Tâche supprimée" });
    mutate();
  }

  async function replayWebhook(webhookId: string) {
    const res = await fetch("/api/admin/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return push({ variant: "error", title: json.error ?? "Rejeu impossible" });
    if (json.ok === false) return push({ variant: "error", title: "Rejeu encore en échec", description: json.error });
    push({ variant: "success", title: `Webhook rejeté (${json.applied ?? 0} évènement(s) appliqué(s))` });
    mutate();
  }

  const trend = (data.trend ?? []).map((d) => ({ ...d, calls: Number(d.calls), failures: Number(d.failures) }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-ink-500">Santé des services sur les dernières 24 heures, tendance sur 7 jours.</p>
        <Button size="sm" onClick={() => mutate()}>Actualiser</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(data.services).map(([name, s]) => (
          <Card key={name} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13.5px] font-semibold capitalize text-ink-900">{name}</p>
              <Badge tone={s.state === "healthy" ? "green" : s.state === "degraded" ? "amber" : "red"} dot>
                {s.state === "healthy" ? "Healthy" : s.state === "degraded" ? "Degraded" : "Down"}
              </Badge>
            </div>
            <div className="mt-2.5 space-y-1 text-[12px]">
              {"calls" in s && s.calls !== undefined && (
                <>
                  <Row l="Appels (24 h)" v={fmt.format(s.calls)} />
                  <Row l="Échecs" v={fmt.format(s.failures ?? 0)} />
                  <Row l="Taux d'échec" v={`${s.calls ? Math.round(((s.failures ?? 0) / s.calls) * 1000) / 10 : 0} %`} />
                </>
              )}
              {s.pending !== undefined && (
                <>
                  <Row l="En attente" v={fmt.format(s.pending)} />
                  <Row l="En échec" v={fmt.format(s.failed ?? 0)} />
                  <Row l="Bloqués" v={fmt.format(s.stuck ?? 0)} />
                </>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tendance des intégrations (7 jours)</CardTitle>
          <span className="text-[11.5px] text-ink-400">Appels aux fournisseurs externes et échecs, par jour.</span>
        </CardHeader>
        <CardBody className="h-56">
          {!trend.length ? (
            <EmptyState icon={Activity} title="Aucune donnée sur la période" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: -18, right: 6, top: 6 }}>
                <defs>
                  <linearGradient id="gCalls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#16a34a" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e6e8ee" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#7c8598" }} tickFormatter={(d) => String(d).slice(5)} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#7c8598" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e6e8ee", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="calls" name="Appels" stroke="#16a34a" strokeWidth={2} fill="url(#gCalls)" />
                <Bar dataKey="failures" name="Échecs" fill="#dc2626" radius={[3, 3, 0, 0]} barSize={14} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>File de traitements</CardTitle>
          <span className="text-[11.5px] text-ink-400">Tâches en attente, en cours ou en échec. Une tâche en échec peut être rejouée ou supprimée.</span>
        </CardHeader>
        {!data.jobQueue?.length ? (
          <EmptyState icon={ListRestart} title="File vide" description="Aucune tâche en attente ni en échec." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12.5px]">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/60 text-[11px] uppercase text-ink-500">
                  {["Type", "Marchand", "Statut", "Tentatives", "Programmée", "Dernière erreur", ""].map((h) => <th key={h} className="px-3 py-2 text-start font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.jobQueue.map((j) => (
                  <tr key={j.id} className="hover:bg-ink-50/60">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-ink-800">{JOB_LABELS[j.type] ?? j.type}</td>
                    <td className="px-3 py-2 text-ink-600">{j.merchant_name ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={j.status === "failed" ? "red" : j.status === "running" ? "blue" : "amber"} dot>
                        {j.status === "failed" ? "Échec" : j.status === "running" ? "En cours" : "En attente"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-ink-600" dir="ltr">{j.attempts} / {j.max_attempts}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-500">{dt(j.run_after)}</td>
                    <td className="max-w-72 truncate px-3 py-2 text-red-600" title={j.last_error ?? undefined}>{j.last_error ?? "—"}</td>
                    <td className="px-3 py-2 text-end">
                      {j.status === "failed" && (
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => jobAction(j.id, "retry")}>
                            <RotateCcw className="h-3.5 w-3.5" /> Rejouer
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => jobAction(j.id, "discard")}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhooks en échec</CardTitle>
          <span className="text-[11.5px] text-ink-400">Le rejeu est disponible pour les webhooks transporteurs (traitement idempotent).</span>
        </CardHeader>
        {!data.failedWebhooks.length ? (
          <EmptyState icon={Webhook} title="Aucun webhook en échec" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12.5px]">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/60 text-[11px] uppercase text-ink-500">
                  {["Date", "Marchand", "Source", "Évènement", "Erreur", ""].map((h) => <th key={h} className="px-3 py-2 text-start font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.failedWebhooks.map((w) => (
                  <tr key={w.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-500">{dt(w.created_at)}</td>
                    <td className="px-3 py-2 text-ink-700">{w.merchant_name ?? "—"}</td>
                    <td className="px-3 py-2"><Badge tone="gray">{w.source}</Badge></td>
                    <td className="px-3 py-2 text-ink-600">{w.event_type ?? "—"}</td>
                    <td className="max-w-80 truncate px-3 py-2 text-red-600" title={w.error ?? undefined}>{w.error ?? "—"}</td>
                    <td className="px-3 py-2 text-end">
                      {w.source === "delivery" && (
                        <Button size="sm" variant="ghost" onClick={() => replayWebhook(w.id)}>
                          <RotateCcw className="h-3.5 w-3.5" /> Rejouer
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>Erreurs centralisées</CardTitle></CardHeader>
        {!data.recentErrors.length ? (
          <EmptyState icon={Activity} title="Aucune erreur" />
        ) : (
          <div className="max-h-[420px] divide-y divide-ink-100 overflow-y-auto">
            {data.recentErrors.map((e, i) => (
              <div key={i} className="px-4 py-2.5">
                <p className="text-[12.5px] text-ink-800">{e.error ?? "—"}</p>
                <p className="text-[11px] text-ink-400">{e.merchant_name ?? "—"} · {e.service} · {e.operation} · {dt(e.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500">{l}</span>
      <span className="font-medium text-ink-800">{v}</span>
    </div>
  );
}
