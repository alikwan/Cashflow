import { useEffect, useMemo, useState } from "react";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Login from "./auth/Login";
import { ToastProvider } from "./components/Primitives";
import { AppShell, buildSearchIndex } from "./components/Shell";
import { TweaksPanel } from "./components/TweaksPanel";
import {
  useMeta,
  useDashboard,
  useSuppliers,
  useInstallments,
  useSettings,
} from "./api/hooks";
import { Dashboard } from "./pages/Dashboard";
import { MonthlyFlow } from "./pages/MonthlyFlow";
import { Breakdown } from "./pages/Breakdown";
import { Suppliers } from "./pages/Suppliers";
import { Installments } from "./pages/Installments";
import { Forecast } from "./pages/Forecast";
import { SupplierPlan } from "./pages/SupplierPlan";
import { Settings } from "./pages/Settings";

// Accent name → CSS custom-property overrides applied inline on <html>. أزرق is
// the DEFAULT and is intentionally NOT listed here: for أزرق we REMOVE every
// override (see the accent effect) so the stylesheet's original blue tokens
// apply — a guaranteed-exact reset rather than a re-hardcoded blue.
//
// Each non-default accent sets BOTH the semantic button vars
// (`--color-primary`/`--color-primary-hover`, which color `.btn-primary` and
// `.btn-secondary` incl. the Save button) AND the fuller `--primary-*` ramp
// (50/100/200/500/600/700) that charts, badges, and info-banners read — so the
// buttons, chart bars, and banners all recolor coherently, not just a few tints.
const ACCENT_PALETTE = {
  كحلي: {
    "--color-primary": "#4F46E5",
    "--color-primary-hover": "#4338CA",
    "--primary-50": "#EEF2FF",
    "--primary-100": "#E0E7FF",
    "--primary-200": "#C7D2FE",
    "--primary-500": "#6366F1",
    "--primary-600": "#4F46E5",
    "--primary-700": "#4338CA",
  },
  أخضر: {
    "--color-primary": "#0D9488",
    "--color-primary-hover": "#0F766E",
    "--primary-50": "#F0FDFA",
    "--primary-100": "#CCFBF1",
    "--primary-200": "#99F6E4",
    "--primary-500": "#14B8A6",
    "--primary-600": "#0D9488",
    "--primary-700": "#0F766E",
  },
};

// The full set of CSS vars any accent can touch — used to REMOVE inline overrides
// for the default (أزرق) and on cleanup (unmount/logout) so the stylesheet
// defaults always cleanly reapply (no accent leak across logout).
const ACCENT_VARS = [
  "--color-primary",
  "--color-primary-hover",
  "--primary-50",
  "--primary-100",
  "--primary-200",
  "--primary-500",
  "--primary-600",
  "--primary-700",
];

// §9 nullable-assumption fallbacks (mirror Settings/data.js defaults).
const FALLBACK = { reserve: 15, usd: 1350, fyStart: 5, incomeGrowth: 0 };

// Root application component.
//
// Structure: <AuthProvider> wraps a guarded inner component. The AuthProvider
// lives INSIDE App (not in main.jsx) so `render(<App/>)` works standalone in
// tests. The RTL `dir`/`lang` effect stays at the App level, INDEPENDENT of
// auth, so the A1 smoke test (which renders App with no server) still passes
// regardless of the auth boot fetch.
export default function App() {
  useEffect(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "ar";
  }, []);

  return (
    <AuthProvider>
      <Guarded />
    </AuthProvider>
  );
}

// The route guard. There is NO react-router by design — the real app is a
// single-page shell whose active page is React state (lands in Tasks C2/D2).
// The guard is purely: loading → loader; no user → Login; user → app area.
function Guarded() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={loaderStyles.page}>
        {/* `spin` keyframe lives here (not in the shared design-system CSS) so
            the loader is self-contained until C1 ports a Spinner primitive. */}
        <style>{"@keyframes app-spin{to{transform:rotate(360deg)}}"}</style>
        <div style={loaderStyles.spinner} aria-label="جارٍ التحميل" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  // Authenticated: the real shell + active-page switcher. ToastProvider wraps the
  // shell so the pages' `useToast()` works (it also renders ToastHost itself).
  return (
    <ToastProvider>
      <AuthedApp />
    </ToastProvider>
  );
}

// The signed-in single-page app: the AppShell (sidebar + header + content) with
// React state for the active page. No react-router by design.
function AuthedApp() {
  const [active, setActive] = useState("dashboard");
  // Logout lives in auth context; threaded into AppShell as a prop so the Shell
  // components never call useAuth() (they're rendered standalone in shell tests).
  const { logout } = useAuth();

  // App-level chrome data: the exchange-rate pill, the notifications bell, and
  // the global search index. Safe fallbacks while these load.
  const meta = useMeta();
  const dash = useDashboard();
  const suppliers = useSuppliers();
  const installments = useInstallments();
  // Persistent settings (the saved baseline). The TweaksPanel applies live,
  // unsaved overrides on top; the Settings page is the persistent editor.
  const settings = useSettings();

  // The saved effective settings, with §9 fallbacks (settings → meta → static).
  const effective = useMemo(() => {
    const s = settings.data || {};
    const m = meta.data || {};
    const caps = {};
    for (const sup of suppliers.data?.suppliers ?? []) caps[sup.id] = sup.cap ?? 0;
    return {
      accent: s.accent ?? "أزرق",
      showAlert: s.showAlert ?? true,
      negThreshold: s.negThreshold ?? 0,
      overCapWarn: s.overCapWarn ?? true,
      exchangeRate: s.exchangeRate ?? m.USD_RATE ?? FALLBACK.usd,
      reserve: s.reserve ?? m.RESERVE_M ?? FALLBACK.reserve,
      fyStart: s.fyStart ?? m.fyStart ?? FALLBACK.fyStart,
      incomeGrowth: s.incomeGrowth ?? FALLBACK.incomeGrowth,
      caps,
    };
  }, [settings.data, meta.data, suppliers.data]);

  // Live tweaks state = the effective settings + any in-app TweaksPanel patches.
  // Re-seed from `effective` whenever the saved baseline loads/changes (e.g.
  // after a Settings save refetches). `patchSettings` applies live overrides.
  const [tweaks, setTweaks] = useState(null);
  useEffect(() => {
    setTweaks(effective);
  }, [effective]);
  const patchSettings = (patch) => setTweaks((t) => ({ ...(t || effective), ...patch }));

  // The live, in-effect settings (tweaks once seeded; else the effective base).
  const live = tweaks || effective;

  // Apply the accent live: recolor the primary CSS custom properties on the
  // document root whenever the live accent changes. For a non-default accent we
  // set its ramp + button vars; for أزرق (or any unknown value) we REMOVE every
  // accent override so the stylesheet's original tokens reapply exactly.
  // The cleanup removes all accent overrides on unmount (e.g. logout), so Login
  // never renders with the previous accent leaking onto <html>.
  useEffect(() => {
    const root = document.documentElement;
    const palette = ACCENT_PALETTE[live.accent];
    if (palette) {
      for (const [k, v] of Object.entries(palette)) root.style.setProperty(k, v);
      // Clear any vars NOT in this palette (defensive — all current accents set
      // the same var set, but this keeps switching between accents clean).
      for (const name of ACCENT_VARS) {
        if (!(name in palette)) root.style.removeProperty(name);
      }
    } else {
      // أزرق / default: drop all inline overrides → stylesheet defaults win.
      for (const name of ACCENT_VARS) root.style.removeProperty(name);
    }
    return () => {
      for (const name of ACCENT_VARS) root.style.removeProperty(name);
    };
  }, [live.accent]);

  const exchangeRate = live.exchangeRate ?? meta.data?.exchangeRate ?? 0;
  const alerts = dash.data?.alerts ?? [];
  const searchIndex = buildSearchIndex(
    suppliers.data?.suppliers ?? [],
    installments.data?.topDebtors ?? []
  );

  const renderPage = () => {
    switch (active) {
      case "dashboard":
        return <Dashboard onNavigate={setActive} showAlert={live.showAlert} />;
      case "monthly":
        return <MonthlyFlow onNavigate={setActive} />;
      case "breakdown":
        return <Breakdown onNavigate={setActive} />;
      case "suppliers":
        return <Suppliers onNavigate={setActive} />;
      case "installments":
        return <Installments onNavigate={setActive} />;
      case "forecast":
        return (
          <Forecast
            onNavigate={setActive}
            reserve={live.reserve}
            incomeGrowth={live.incomeGrowth}
          />
        );
      case "supplierplan":
        // SupplierPlan's pool is computed server-side (it reads only `reserve`,
        // not `incomeGrowth` — the income-growth re-projection is a Forecast-page
        // concern). Feed the live reserve.
        return <SupplierPlan onNavigate={setActive} reserve={live.reserve} />;
      case "settings":
        // After a Settings save, refresh ALL app-level hooks that feed live
        // chrome/pages: settings (the saved baseline → tweaks reseed), suppliers
        // (Shell search + Suppliers page caps), and meta (assumptions may change).
        return (
          <Settings
            onSaved={() => {
              settings.refetch();
              suppliers.refetch();
              meta.refetch();
            }}
          />
        );
      default:
        return <Dashboard onNavigate={setActive} showAlert={live.showAlert} />;
    }
  };

  return (
    <>
      <AppShell
        active={active}
        onNavigate={setActive}
        exchangeRate={exchangeRate}
        alerts={alerts}
        searchIndex={searchIndex}
        onLogout={logout}
      >
        {renderPage()}
      </AppShell>
      {/* Always-available in-app quick-tweaks panel (every page). */}
      <TweaksPanel settings={tweaks} onChange={patchSettings} />
    </>
  );
}

const loaderStyles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--color-bg)",
  },
  spinner: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: "3px solid var(--slate-200)",
    borderTopColor: "var(--primary-600)",
    animation: "app-spin 0.7s linear infinite",
  },
};
