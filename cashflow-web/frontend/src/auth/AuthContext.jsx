// auth/AuthContext.jsx — session state for the whole app.
//
// On boot it asks the backend "who am I?" (`GET /api/auth/me`). A 200 means we
// have a live HttpOnly session cookie → set `user`; a 401 (AuthError) or any
// other failure means no session → `user = null`. Either way `loading` ends
// false so the app can render Login or the shell.
//
// `login`/`logout` go through the single `api` fetch surface (cookie-based;
// `credentials:"include"` is handled there). Errors from `login` are re-thrown
// so the Login form can map a status to an Arabic message (401 vs 429 vs
// network). `logout` always clears the local user, even if the request fails,
// so a flaky network can never trap the user in an authed UI.
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, AuthError } from "../api/client";

const AuthContext = createContext(null);

// `initialUser` is a TEST/STORYBOOK seam (not used by App.jsx / production):
// when provided (anything but `undefined`, including `null`) it seeds the
// session synchronously and SKIPS the boot `/api/auth/me` fetch. This lets
// page tests (Task D1's `renderWithProviders`) mount in an authed state
// without standing up an MSW `/me` handler. Pass `initialUser={someUser}` for
// "logged in" or `initialUser={null}` for "explicitly logged out, no fetch".
// When omitted (the default/production case) behavior is exactly as before:
// the boot fetch runs and resolves the real session.
export function AuthProvider({ children, initialUser }) {
  // Seed from `initialUser` when given; otherwise start unauthenticated.
  const [user, setUser] = useState(initialUser !== undefined ? initialUser : null);
  // When seeded we are already resolved → no loading flash and no boot fetch.
  const [loading, setLoading] = useState(initialUser === undefined);

  // Boot: resolve the current session exactly once.
  useEffect(() => {
    // Seeded (test/storybook) → state is already final; never touch the network.
    if (initialUser !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await api.get("/api/auth/me");
        if (!cancelled) setUser(me);
      } catch (err) {
        // AuthError (401) is the normal "not logged in" path; any other error
        // (network down, 500) also means we have no usable session. Swallow it
        // so there is no unhandled rejection — this is what lets the no-server
        // smoke test boot App without blowing up.
        void err;
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Boot-once: `initialUser` is a fixed seam for the provider's lifetime, so
    // we intentionally do not re-run when it changes (it never does in practice).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attempt a login. On success set the user and return it. On failure RE-THROW
  // so the caller (Login) can distinguish 401 / 429 / network via `err.status`.
  const login = useCallback(async (username, password) => {
    const me = await api.post("/api/auth/login", { username, password });
    setUser(me);
    return me;
  }, []);

  // Clear the session. Best-effort: even if the request errors (network), we
  // still drop the local user so the UI returns to the login screen.
  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } catch (err) {
      void err;
    } finally {
      setUser(null);
    }
  }, []);

  const value = { user, loading, login, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("useAuth must be used inside an <AuthProvider>");
  }
  return ctx;
}

// Re-exported for convenience so consumers can `instanceof`-check login errors
// without reaching into the api module directly.
export { AuthError };
