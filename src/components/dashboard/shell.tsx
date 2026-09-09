"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Home, Package, Users, MessageSquare, Zap, Truck, Plug, BarChart3, Bell, Settings,
  Search, Menu, X, LogOut, Globe, ChevronDown, CircleDot, AlertTriangle, CheckCircle2, User2,
} from "lucide-react";
import { cn, Badge, Dropdown, DropdownItem, DropdownSeparator, Spinner } from "@/components/ui";
import { makeT, type Locale, dir } from "@/lib/i18n";
import { LocaleContext, useDashLocale } from "./locale";

export const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Erreur de chargement");
  return json;
};

const NAV = [
  { href: "/dashboard", key: "d.home", icon: Home, exact: true },
  { href: "/dashboard/orders", key: "d.orders", icon: Package },
  { href: "/dashboard/customers", key: "d.customers", icon: Users },
  { href: "/dashboard/whatsapp", key: "d.whatsapp", icon: MessageSquare },
  { href: "/dashboard/automations", key: "d.automations", icon: Zap },
  { href: "/dashboard/delivery", key: "d.delivery", icon: Truck },
  { href: "/dashboard/integrations", key: "d.integrations", icon: Plug },
  { href: "/dashboard/analytics", key: "d.analytics", icon: BarChart3 },
  { href: "/dashboard/notifications", key: "d.notifications", icon: Bell },
  { href: "/dashboard/settings", key: "d.settings", icon: Settings },
];

export type Me = {
  user: { id: string; full_name: string; email: string };
  merchant: { id: string; name: string; status: string; plan_code: string; locale: string; onboarding_completed_at: string | null };
  role: "owner" | "admin" | "agent";
  memberships: { merchant_id: string; merchant_name: string }[];
  health: { whatsapp: string; delivery: string; sources: string };
};

export function DashboardShell({ me, children }: { me: Me; children: React.ReactNode }) {
  const [locale, setLocale] = React.useState<Locale>((me.merchant.locale as Locale) ?? "fr");
  const [mobileNav, setMobileNav] = React.useState(false);
  const pathname = usePathname();
  const t = makeT(locale);

  React.useEffect(() => {
    const saved = window.localStorage.getItem("codwsap_locale") as Locale | null;
    if (saved) setLocale(saved);
  }, []);
  React.useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir(locale);
    window.localStorage.setItem("codwsap_locale", locale);
  }, [locale]);
  React.useEffect(() => setMobileNav(false), [pathname]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      <div className="mobile-app-shell min-h-screen bg-[var(--bg)]" dir={dir(locale)}>
        {/* Sidebar (desktop) */}
        <aside className="fixed inset-y-0 start-0 z-30 hidden w-60 flex-col border-e border-ink-200 bg-white lg:flex">
          <div className="flex h-14 items-center gap-2 border-b border-ink-100 px-4">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-[13px] font-bold text-white">C</span>
            <span className="text-[14px] font-semibold tracking-tight text-ink-900">CODWSAP</span>
          </div>
          <SidebarNav t={t} pathname={pathname} role={me.role} />
          <PlanCard me={me} locale={locale} />
        </aside>

        {/* Mobile nav drawer */}
        {mobileNav && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-ink-900/30" onClick={() => setMobileNav(false)} />
            <div className="drawer-in absolute inset-y-0 start-0 flex w-[min(86vw,20rem)] flex-col rounded-e-3xl bg-white shadow-2xl">
              <div className="flex min-h-16 items-center justify-between border-b border-ink-100 px-4 pt-[env(safe-area-inset-top)]">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-600 text-[14px] font-bold text-white">C</span>
                  <div><p className="text-[14px] font-semibold text-ink-900">CODWSAP</p><p className="max-w-40 truncate text-xs text-ink-400">{me.merchant.name}</p></div>
                </div>
                <button className="grid h-11 w-11 place-items-center rounded-xl text-ink-500 active:bg-ink-100" onClick={() => setMobileNav(false)}>
                  <X className="h-5 w-5 text-ink-500" />
                </button>
              </div>
              <SidebarNav t={t} pathname={pathname} role={me.role} />
              <div className="border-t border-ink-100 px-3 pt-3">
                <button onClick={() => setLocale(locale === "fr" ? "ar" : "fr")} className="flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-ink-600 active:bg-ink-100">
                  <Globe className="h-[18px] w-[18px] text-ink-400" />{locale === "fr" ? "العربية" : "Français"}
                </button>
              </div>
              <PlanCard me={me} locale={locale} />
            </div>
          </div>
        )}

        <div className="lg:ps-60">
          <TopBar me={me} locale={locale} setLocale={setLocale} onMenu={() => setMobileNav(true)} t={t} />
          <MobileTopBar me={me} pathname={pathname} locale={locale} onMenu={() => setMobileNav(true)} t={t} />
          <main className="min-w-0 px-3 pb-[calc(5.25rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 lg:pb-8 lg:pt-4">
            <div key={pathname} className="mobile-page-in">{children}</div>
          </main>
          <MobileTabBar pathname={pathname} t={t} />
        </div>
      </div>
    </LocaleContext.Provider>
  );
}

function SidebarNav({ t, pathname, role }: { t: (k: string) => string; pathname: string; role: string }) {
  const visible = NAV.filter((n) => (role === "agent" ? !["/dashboard/integrations", "/dashboard/delivery"].includes(n.href) : true));
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
      {visible.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
              active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
            )}
          >
            <item.icon className={cn("h-[17px] w-[17px]", active ? "text-brand-600" : "text-ink-400")} />
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}

function PlanCard({ me, locale }: { me: Me; locale: Locale }) {
  return (
    <div className="border-t border-ink-100 p-3">
      <div className="rounded-xl border border-ink-200 bg-ink-50/70 p-3">
        <p className="truncate text-[12.5px] font-semibold text-ink-800">{me.merchant.name}</p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <Badge tone={me.merchant.status === "active" ? "green" : me.merchant.status === "suspended" ? "red" : "amber"} dot>
            {me.merchant.status === "active" ? (locale === "ar" ? "نشط" : "Actif") : me.merchant.status === "suspended" ? (locale === "ar" ? "موقوف" : "Suspendu") : locale === "ar" ? "تجربة" : "Essai"}
          </Badge>
          <span className="text-[11.5px] uppercase text-ink-400">{me.merchant.plan_code}</span>
        </div>
      </div>
    </div>
  );
}

function TopBar({ me, locale, setLocale, onMenu, t }: { me: Me; locale: Locale; setLocale: (l: Locale) => void; onMenu: () => void; t: (k: string) => string }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-20 hidden h-14 items-center gap-2 border-b border-ink-200 bg-white/90 px-5 backdrop-blur lg:flex">
      <button className="lg:hidden" onClick={onMenu} aria-label="Menu">
        <Menu className="h-5 w-5 text-ink-600" />
      </button>
      <GlobalSearch t={t} />
      <div className="ms-auto flex items-center gap-1.5">
        <HealthIndicator me={me} locale={locale} />
        <NotificationBell t={t} locale={locale} />
        <button
          onClick={() => setLocale(locale === "fr" ? "ar" : "fr")}
          className="hidden items-center gap-1 rounded-lg border border-ink-200 px-2 py-1.5 text-[12px] font-medium text-ink-600 hover:bg-ink-50 sm:inline-flex"
        >
          <Globe className="h-3.5 w-3.5" />
          {locale === "fr" ? "ع" : "FR"}
        </button>
        <Dropdown
          trigger={
            <button className="flex items-center gap-1.5 rounded-lg border border-ink-200 px-2 py-1.5 hover:bg-ink-50">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[10px] font-semibold text-white">
                {me.user.full_name.slice(0, 1).toUpperCase()}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-ink-400" />
            </button>
          }
        >
          <div className="px-3 py-2">
            <p className="truncate text-[13px] font-medium text-ink-800">{me.user.full_name}</p>
            <p className="truncate text-[11.5px] text-ink-400">{me.user.email}</p>
            <Badge tone="gray" className="mt-1.5">
              {me.role}
            </Badge>
          </div>
          <DropdownSeparator />
          <Link href="/dashboard/settings">
            <DropdownItem icon={User2}>{t("d.profile")}</DropdownItem>
          </Link>
          <DropdownItem
            icon={LogOut}
            danger
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
              router.refresh();
            }}
          >
            {t("d.logout")}
          </DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}

function MobileTopBar({ me, pathname, locale, onMenu, t }: { me: Me; pathname: string; locale: Locale; onMenu: () => void; t: (k: string) => string }) {
  const [searchOpen, setSearchOpen] = React.useState(false);
  const current = NAV.find((item) => item.exact ? pathname === item.href : pathname.startsWith(item.href));
  return (
    <>
      <header className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-ink-100 bg-white/92 px-3 pt-[env(safe-area-inset-top)] shadow-[0_1px_0_rgba(20,25,34,.03)] backdrop-blur-xl lg:hidden">
        <button className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-ink-600 active:scale-95 active:bg-ink-100" onClick={onMenu} aria-label="Menu">
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight text-ink-900">{current ? t(current.key) : "CODWSAP"}</p>
          <p className="mt-0.5 truncate text-xs leading-tight text-ink-400">{me.merchant.name}</p>
        </div>
        <button className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-ink-600 active:scale-95 active:bg-ink-100" onClick={() => setSearchOpen(true)} aria-label={t("d.search")}>
          <Search className="h-[19px] w-[19px]" />
        </button>
        <NotificationBell t={t} locale={locale} mobile />
      </header>
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-white px-3 pb-[env(safe-area-inset-bottom)] pt-[calc(.75rem+env(safe-area-inset-top))] lg:hidden">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1"><GlobalSearch t={t} autoFocus onNavigate={() => setSearchOpen(false)} /></div>
            <button className="grid h-11 w-11 place-items-center rounded-xl text-ink-500 active:bg-ink-100" onClick={() => setSearchOpen(false)} aria-label="Fermer"><X className="h-5 w-5" /></button>
          </div>
        </div>
      )}
    </>
  );
}

function GlobalSearch({ t, autoFocus = false, onNavigate }: { t: (k: string) => string; autoFocus?: boolean; onNavigate?: () => void }) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [debounced, setDebounced] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 220);
    return () => clearTimeout(id);
  }, [q]);
  React.useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const { data, isLoading } = useSWR<{ orders: Record<string, string>[]; customers: Record<string, string>[] }>(
    debounced.length >= 2 ? `/api/search?q=${encodeURIComponent(debounced)}` : null,
    fetcher,
    { keepPreviousData: true },
  );

  return (
    <div className="relative w-full max-w-md" ref={ref}>
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t("d.search")}
        className="field h-9 ps-9 text-[13px]"
      />
      {open && debounced.length >= 2 && (
        <div className="fade-in absolute inset-x-0 top-11 z-40 max-h-96 overflow-y-auto rounded-xl border border-ink-200 bg-white py-1 shadow-lg">
          {isLoading && (
            <div className="flex items-center gap-2 px-3 py-3 text-[13px] text-ink-500">
              <Spinner /> {t("d.loading")}
            </div>
          )}
          {!isLoading && !data?.orders.length && !data?.customers.length && <p className="px-3 py-3 text-[13px] text-ink-400">{t("d.empty")}</p>}
          {data?.orders.map((o) => (
            <Link key={o.id} href={`/dashboard/orders?order=${o.id}`} onClick={() => { setOpen(false); onNavigate?.(); }} className="block px-3 py-2 hover:bg-ink-50">
              <p className="text-[13px] font-medium text-ink-800">
                {o.reference} · {o.customer_name}
              </p>
              <p className="text-[11.5px] text-ink-400">{o.tracking_number ?? "—"}</p>
            </Link>
          ))}
          {data?.customers.map((c) => (
            <Link key={c.id} href={`/dashboard/customers?c=${c.id}`} onClick={() => { setOpen(false); onNavigate?.(); }} className="block px-3 py-2 hover:bg-ink-50">
              <p className="text-[13px] font-medium text-ink-800">{c.full_name || c.normalized_phone}</p>
              <p className="text-[11.5px] text-ink-400" dir="ltr">
                {c.normalized_phone}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function HealthIndicator({ me, locale }: { me: Me; locale: Locale }) {
  const states = [
    { k: "WhatsApp", v: me.health.whatsapp },
    { k: locale === "ar" ? "التوصيل" : "Livraison", v: me.health.delivery },
    { k: locale === "ar" ? "المصادر" : "Sources", v: me.health.sources },
  ];
  const worst = states.some((s) => s.v === "error") ? "error" : states.some((s) => s.v === "disconnected") ? "warn" : "ok";
  return (
    <Dropdown
      trigger={
        <button className="hidden items-center gap-1.5 rounded-lg border border-ink-200 px-2 py-1.5 text-[12px] hover:bg-ink-50 sm:inline-flex">
          <CircleDot className={cn("h-3.5 w-3.5", worst === "ok" ? "text-emerald-500" : worst === "warn" ? "text-amber-500" : "text-red-500")} />
          <span className="text-ink-600">{locale === "ar" ? "الحالة" : "Santé"}</span>
        </button>
      }
    >
      <div className="px-3 py-2">
        <p className="text-[12px] font-semibold text-ink-700">{locale === "ar" ? "حالة التكاملات" : "Santé des intégrations"}</p>
      </div>
      <DropdownSeparator />
      {states.map((s) => (
        <div key={s.k} className="flex items-center justify-between gap-4 px-3 py-2 text-[13px]">
          <span className="text-ink-600">{s.k}</span>
          {s.v === "connected" ? (
            <Badge tone="green" dot>
              {locale === "ar" ? "متصل" : "Connecté"}
            </Badge>
          ) : s.v === "error" ? (
            <Badge tone="red" dot>
              {locale === "ar" ? "خطأ" : "Erreur"}
            </Badge>
          ) : (
            <Badge tone="gray">{locale === "ar" ? "غير مُعد" : "Non configuré"}</Badge>
          )}
        </div>
      ))}
      <DropdownSeparator />
      <Link href="/dashboard/integrations">
        <DropdownItem icon={Plug}>{locale === "ar" ? "إدارة التكاملات" : "Gérer les intégrations"}</DropdownItem>
      </Link>
    </Dropdown>
  );
}

type Notif = { id: string; title: string; body: string | null; severity: string; link: string | null; created_at: string; read_at: string | null };

function NotificationBell({ t, locale, mobile = false }: { t: (k: string) => string; locale: Locale; mobile?: boolean }) {
  const { data, mutate } = useSWR<{ rows: Notif[]; unread: number }>("/api/notifications?limit=12", fetcher, { refreshInterval: 25_000 });
  const unread = data?.unread ?? 0;
  return (
    <Dropdown
      className="w-[min(22rem,calc(100vw-1.5rem))]"
      trigger={
        <button className={cn("relative grid place-items-center rounded-xl text-ink-600", mobile ? "h-11 w-11 border-0 active:scale-95 active:bg-ink-100" : "h-8 w-8 border border-ink-200 hover:bg-ink-50")} aria-label="Notifications">
          <Bell className="h-4 w-4 text-ink-600" />
          {unread > 0 && (
            <span className="absolute -end-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white tabular">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      }
    >
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-[12.5px] font-semibold text-ink-800">{t("d.notifications")}</p>
        <button
          className="text-[11.5px] text-brand-600 hover:underline"
          onClick={async (e) => {
            e.stopPropagation();
            await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
            mutate();
          }}
        >
          {t("d.markallread")}
        </button>
      </div>
      <DropdownSeparator />
      <div className="max-h-80 overflow-y-auto">
        {!data?.rows.length && <p className="px-3 py-6 text-center text-[13px] text-ink-400">{t("d.nonotif")}</p>}
        {data?.rows.map((n) => (
          <Link key={n.id} href={n.link ?? "/dashboard/notifications"} className={cn("flex gap-2.5 px-3 py-2.5 hover:bg-ink-50", !n.read_at && "bg-brand-50/40")}>
            {n.severity === "error" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            ) : n.severity === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            ) : (
              <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
            )}
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink-800">{n.title}</p>
              {n.body && <p className="line-clamp-2 text-[12px] text-ink-500">{n.body}</p>}
              <p className="mt-0.5 text-[11px] text-ink-400">{new Date(n.created_at.replace(" ", "T") + "Z").toLocaleString(locale === "ar" ? "ar-DZ" : "fr-FR")}</p>
            </div>
          </Link>
        ))}
      </div>
      <DropdownSeparator />
      <Link href="/dashboard/notifications">
        <DropdownItem>{locale === "ar" ? "عرض الكل" : "Voir tout"}</DropdownItem>
      </Link>
    </Dropdown>
  );
}

function MobileTabBar({ pathname, t }: { pathname: string; t: (k: string) => string }) {
  const items = NAV.filter((n) => ["/dashboard", "/dashboard/orders", "/dashboard/whatsapp", "/dashboard/customers", "/dashboard/settings"].includes(n.href));
  return (
    <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-ink-100 bg-white/92 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(20,25,34,.06)] backdrop-blur-xl lg:hidden">
      {items.map((i) => {
        const active = i.exact ? pathname === i.href : pathname.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={cn("relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11.5px] font-medium transition active:scale-95", active ? "text-brand-700" : "text-ink-500")}>
            {active && <span className="absolute top-1 h-1 w-5 rounded-full bg-brand-600" />}
            <i.icon className={cn("h-5 w-5", active && "stroke-[2.4]")} />
            <span className="max-w-full truncate">{t(i.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export { useDashLocale };
