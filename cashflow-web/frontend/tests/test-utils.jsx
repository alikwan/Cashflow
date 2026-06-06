// tests/test-utils.jsx — the JSX half of the shared harness.
//
// `renderWithProviders` lives here (not in setup.js) because setup.js is the
// vitest `setupFiles` entry and is loaded as plain `.js`; keeping JSX in a
// `.jsx` file lets the React/Vite transform pick it up. setup.js re-exports
// this module so tests can still import everything from "./setup".
import { render } from "@testing-library/react";
import { AuthProvider } from "../src/auth/AuthContext";
import { ToastProvider } from "../src/components/Primitives";

const DEFAULT_USER = { username: "owner", display_name: "علي" };

/**
 * Render `ui` inside the real Auth + Toast providers, authenticated by default.
 *
 * The AuthProvider is seeded via `initialUser`, which makes it resolve the
 * session synchronously and SKIP the boot `/api/auth/me` fetch — so page tests
 * need no `/me` handler and never flash a loading state. Pass `user: null` to
 * render the "explicitly logged out, no fetch" state.
 *
 * @param {React.ReactNode} ui
 * @param {object} [options]
 * @param {object|null} [options.user]  seed user (default a fake owner).
 * @returns RTL render result.
 */
export function renderWithProviders(ui, { user, ...options } = {}) {
  const seed = user === undefined ? DEFAULT_USER : user;
  function Wrapper({ children }) {
    return (
      <AuthProvider initialUser={seed}>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}

// Re-export the RTL surface so tests can import screen/waitFor/etc. from one place.
export * from "@testing-library/react";
