import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Login from "./auth/Login";
import { ToastProvider, Card } from "./components/Primitives";
import { AppShell, buildSearchIndex } from "./components/Shell";
import { useMeta, useDashboard, useSuppliers, useInstallments } from "./api/hooks";
import { Dashboard } from "./pages/Dashboard";
import { MonthlyFlow } from "./pages/MonthlyFlow";
import { Breakdown } from "./pages/Breakdown";

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

  const exchangeRate = meta.data?.exchangeRate ?? 0;
  const alerts = dash.data?.alerts ?? [];
  const searchIndex = buildSearchIndex(
    suppliers.data?.suppliers ?? [],
    installments.data?.topDebtors ?? []
  );

  const renderPage = () => {
    switch (active) {
      case "dashboard":
        return <Dashboard onNavigate={setActive} />;
      case "monthly":
        return <MonthlyFlow onNavigate={setActive} />;
      case "breakdown":
        return <Breakdown onNavigate={setActive} />;
      // Pages not yet built (Tasks D3/E1) — minimal on-brand placeholder.
      case "suppliers":
      case "installments":
      case "forecast":
      case "supplierplan":
      case "settings":
      default:
        return <PendingPage />;
    }
  };

  return (
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
  );
}

// Minimal on-brand placeholder for the pages still to be wired (D3/E1).
function PendingPage() {
  return (
    <div style={{ padding: "24px 28px 48px" }}>
      <Card style={{ maxWidth: 520, margin: "32px auto", textAlign: "center" }}>
        <div
          style={{
            fontFamily: "Tajawal",
            fontWeight: 700,
            fontSize: 18,
            color: "var(--slate-900)",
            marginBottom: 6,
          }}
        >
          قيد الإنشاء
        </div>
        <div style={{ fontSize: 13.5, color: "var(--slate-500)", lineHeight: 1.6 }}>
          هذه الصفحة قيد الإنشاء وستتوفّر قريباً.
        </div>
      </Card>
    </div>
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
