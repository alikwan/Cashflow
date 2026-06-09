// @vitest-environment node
//
// Companion to `api-client.test.js`, isolated to ONE concern: the I1 abort
// branch of the client (a caller-initiated `AbortError` must be re-thrown
// AS-IS, never wrapped into an ApiError).
//
// Why a separate file in the `node` environment?
//   Under jsdom (the env the rest of the suite runs in), jsdom installs its own
//   `AbortController`/`AbortSignal` globals. Node's `fetch` (undici) brand-checks
//   the signal against Node's native `AbortSignal`, so a jsdom signal is rejected
//   with a `TypeError` ("Expected signal to be an instance of AbortSignal")
//   BEFORE any real abort can occur. In the `node` env the realms match, so a
//   genuine `AbortController().abort()` produces a real undici `AbortError`.
//
//   The trade-off: in `node`, relative URLs ("/api/...") have no origin to
//   resolve against and fetch throws "Invalid URL". So this file points the
//   client at an absolute base URL via `VITE_API_BASE`, set BEFORE the (dynamic)
//   client import so the module reads it at load time.

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const BASE = "http://api.test.local";

// Set the client's base URL before importing it. `import.meta.env` is read at
// module top-level, so this must happen before the dynamic import below.
if (!import.meta.env) import.meta.env = {};
import.meta.env.VITE_API_BASE = BASE;

const { api, ApiError } = await import("../src/api/client.js");

const server = setupServer(
  // Never resolves before the caller aborts → the abort is what rejects.
  http.get(`${BASE}/api/slow`, async () => {
    await new Promise((r) => setTimeout(r, 5000));
    return HttpResponse.json({ ok: true });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test("aborted request re-throws the AbortError as-is, NOT an ApiError (I1)", async () => {
  const ctrl = new AbortController();
  const p = api.get("/api/slow", { signal: ctrl.signal });
  ctrl.abort();
  const err = await p.catch((e) => e);
  // Intentional cancellation: callers must be able to detect/ignore it, so the
  // original AbortError escapes untouched and is NOT normalized to network_error.
  expect(err.name).toBe("AbortError");
  expect(err).not.toBeInstanceOf(ApiError);
});
