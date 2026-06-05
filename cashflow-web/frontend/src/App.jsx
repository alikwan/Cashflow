import { useEffect } from "react";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Login from "./auth/Login";

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
  const { user, loading, logout } = useAuth();

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

  // TODO(C2): replace with <Shell/> + the active page switcher.
  return (
    <div style={authedStyles.page}>
      <div style={authedStyles.panel}>
        <p style={authedStyles.welcome}>
          مرحباً، {user.display_name || user.username}
        </p>
        <button type="button" onClick={logout} style={authedStyles.logout}>
          تسجيل الخروج
        </button>
      </div>
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

const authedStyles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--color-bg)",
    padding: "var(--space-lg)",
  },
  panel: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border-light)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-card)",
    padding: "var(--space-2xl) var(--space-xl)",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-md)",
  },
  welcome: {
    fontFamily: "var(--font-heading)",
    fontSize: "var(--fs-h3)",
    fontWeight: 700,
    color: "var(--color-text)",
    margin: 0,
  },
  logout: {
    padding: "10px 24px",
    borderRadius: "var(--radius-sm)",
    border: "1.5px solid var(--color-primary)",
    background: "transparent",
    color: "var(--color-primary)",
    fontFamily: "var(--font-body)",
    fontWeight: 600,
    fontSize: "var(--fs-sm)",
    cursor: "pointer",
  },
};
