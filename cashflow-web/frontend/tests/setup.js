// Global test setup. Three jobs (jsdom env only):
//   1. jest-dom matchers + a ResizeObserver stub (Charts.jsx's useWidth needs it).
//   2. ONE shared MSW server (`server`) with default handlers for every read
//      endpoint, wired into the vitest lifecycle. Individual tests override a
//      route with `server.use(...)`; the api-client/auth tests register their
//      own handlers the same way (they no longer stand up their own servers).
//   3. `renderWithProviders` — mounts a UI tree wrapped in the real Auth +
//      Toast providers, AUTHED by default (via AuthProvider's `initialUser`
//      seam, so no `/api/auth/me` round-trip is needed).
//
// Environment guard (CRITICAL): this setupFile is loaded for EVERY test file,
// including `api-client.abort.test.js`, which runs in the `node` environment.
// That test asserts a real undici `AbortError` is re-thrown untouched. Loading
// the jsdom test machinery (jest-dom / @testing-library/react / MSW) into the
// node realm perturbs undici's abort/DOMException brand-checking and makes the
// abort surface as a generic error instead of `AbortError`. So EVERYTHING here
// is loaded **dynamically and only in a jsdom (DOM-like) environment**; in the
// node env this module is a no-op and the abort test runs exactly as before.

// `server` is a live binding the DOM test files import (`import { server } from
// "./setup"`). Populated only in the jsdom env; the node abort test never reads
// it. `renderWithProviders` is likewise wired only in jsdom.
export let server;
export let renderWithProviders;

const isDom = typeof window !== "undefined" && typeof document !== "undefined";

if (isDom) {
  // jest-dom matchers.
  await import("@testing-library/jest-dom");

  // jsdom does not implement ResizeObserver (Charts.jsx's useWidth needs it).
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserver;
  }

  // AbortController/AbortSignal realm fix. Node's `fetch` (undici) brand-checks
  // the abort signal against Node's NATIVE AbortSignal. jsdom installs its OWN
  // AbortController/AbortSignal globals (a different realm), so a signal created
  // in jsdom and passed to `fetch` is rejected by undici with a TypeError BEFORE
  // the request is made — which our client normalizes to a spurious
  // `network_error`. Our data hooks (useApi) pass an AbortController signal to
  // cancel in-flight requests, so under jsdom every hook fetch would fail.
  //
  // Fix: install a NATIVE-backed AbortController as the jsdom global.
  // `node:util.transferableAbortController()` constructs a controller whose
  // `.signal` is Node's native AbortSignal (the realm undici accepts) and whose
  // `.abort()` produces a real `AbortError`. In a real browser this whole block
  // is irrelevant — fetch + AbortController share one realm there.
  const { transferableAbortController } = await import("node:util");
  const nativeCtrl = transferableAbortController();
  // Replace jsdom's AbortController with a native-backed one (returning the
  // native instance from the constructor). Code does `new AbortController()` and
  // only ever uses `.signal` / `.abort()`, so the swap is transparent.
  globalThis.AbortController = class AbortController {
    constructor() {
      return transferableAbortController();
    }
  };
  globalThis.AbortSignal = nativeCtrl.signal.constructor;

  // Shared MSW server (the plan mandates a single server for the whole suite).
  ({ server } = await import("./server.js"));

  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => {
    server.resetHandlers();
    // A1 carry-forward: reset global <html> dir/lang between tests so a page
    // that sets them (RTL) cannot pollute the next test as the suite grows.
    document.documentElement.removeAttribute("dir");
    document.documentElement.removeAttribute("lang");
  });
  afterAll(() => server.close());

  // renderWithProviders (JSX companion).
  ({ renderWithProviders } = await import("./test-utils.jsx"));
}
