import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { api, ApiError, AuthError } from "../src/api/client";

// The unified backend error envelope shape: { error: { code, message } }.
const envelope = (code, message) => ({ error: { code, message } });

const server = setupServer(
  // ---- The two given cases from the plan ----
  http.get("/api/meta", () => HttpResponse.json({ usd_rate: 1350 })),
  http.get("/api/secret", () =>
    HttpResponse.json(envelope("unauthorized", "يجب تسجيل الدخول"), {
      status: 401,
    })
  ),

  // ---- Additional handlers covering the full implemented surface ----

  // GET with query params → echo them back so we can assert the query string.
  http.get("/api/echo", ({ request }) => {
    const url = new URL(request.url);
    return HttpResponse.json({
      a: url.searchParams.get("a"),
      b: url.searchParams.get("b"),
      // `c` is passed as null/undefined and must be omitted.
      hasC: url.searchParams.has("c"),
    });
  }),

  // 404 with the envelope.
  http.get("/api/missing", () =>
    HttpResponse.json(envelope("not_found", "غير موجود"), { status: 404 })
  ),

  // 409 conflict — code "conflict".
  http.post("/api/scenarios", () =>
    HttpResponse.json(envelope("conflict", "مكرر"), { status: 409 })
  ),

  // 409 from ETL — code "etl_running" (NOT "conflict"). Verifies no hardcoding.
  http.post("/api/etl/run", () =>
    HttpResponse.json(envelope("etl_running", "جارٍ التشغيل"), { status: 409 })
  ),

  // 422 flattened validation envelope (single message string, no detail[] array).
  http.post("/api/validate", () =>
    HttpResponse.json(envelope("validation_error", "username: حقل مطلوب"), {
      status: 422,
    })
  ),

  // 500 non-JSON body → fallback error object, status surfaced.
  http.get("/api/boom", () =>
    HttpResponse.text("Internal Server Error", { status: 500 })
  ),

  // 204 No Content → must resolve to null without crashing on empty body.
  http.delete("/api/notes/:id", () => new HttpResponse(null, { status: 204 })),

  // POST that echoes the JSON body back (verifies serialization + content-type).
  http.post("/api/echo-body", async ({ request }) => {
    const ct = request.headers.get("content-type") || "";
    const body = await request.json();
    return HttpResponse.json({ contentType: ct, received: body });
  }),

  // PUT round-trip.
  http.put("/api/settings", async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ saved: body });
  }),

  // 200 DELETE that returns a body (mirrors real backend DELETE /notes/{id}).
  http.delete("/api/notes-200/:id", () =>
    HttpResponse.json({ deleted: 7 })
  ),

  // ---- Review-fix handlers (I1 / M1 / M2) ----

  // Transport-level failure: MSW short-circuits with a network error (no HTTP
  // response is ever produced), exercising the `network_error` normalization.
  http.get("/api/down", () => HttpResponse.error()),

  // 500 with a NON-envelope JSON body carrying a `message` field. Must surface
  // "weird" into the synthesized error message (M1), keeping code "http_error".
  http.get("/api/weird", () =>
    HttpResponse.json({ message: "weird" }, { status: 500 })
  ),

  // 500 with a non-envelope JSON body carrying FastAPI-style `detail`.
  http.get("/api/weird-detail", () =>
    HttpResponse.json({ detail: "odd detail" }, { status: 500 })
  ),

  // Echo full request URL so we can assert array params repeat keys (M2).
  http.get("/api/array-echo", ({ request }) =>
    HttpResponse.json({ url: request.url })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---- The two given cases ----

test("get parses json and sends credentials", async () => {
  const meta = await api.get("/api/meta");
  expect(meta.usd_rate).toBe(1350);
});

test("401 throws AuthError", async () => {
  await expect(api.get("/api/secret")).rejects.toMatchObject({ status: 401 });
});

// ---- Expanded coverage of the full surface ----

test("401 error is an AuthError (and an ApiError) with envelope on .error", async () => {
  const err = await api.get("/api/secret").catch((e) => e);
  expect(err).toBeInstanceOf(AuthError);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toBeInstanceOf(Error);
  expect(err.status).toBe(401);
  expect(err.error).toEqual({
    code: "unauthorized",
    message: "يجب تسجيل الدخول",
  });
});

test("get builds query string from params and omits null/undefined", async () => {
  const res = await api.get("/api/echo", {
    params: { a: "1", b: 2, c: null },
  });
  expect(res.a).toBe("1");
  expect(res.b).toBe("2");
  expect(res.hasC).toBe(false);
});

test("404 throws ApiError (not AuthError) carrying the envelope", async () => {
  const err = await api.get("/api/missing").catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).not.toBeInstanceOf(AuthError);
  expect(err.status).toBe(404);
  expect(err.error.code).toBe("not_found");
});

test("409 conflict passes through error.code", async () => {
  const err = await api.post("/api/scenarios", { name: "x" }).catch((e) => e);
  expect(err.status).toBe(409);
  expect(err.error.code).toBe("conflict");
});

test("409 etl_running passes through its distinct code (no hardcoded conflict semantics)", async () => {
  const err = await api.post("/api/etl/run").catch((e) => e);
  expect(err.status).toBe(409);
  expect(err.error.code).toBe("etl_running");
});

test("422 validation envelope is flattened (single message, no detail array)", async () => {
  const err = await api.post("/api/validate", {}).catch((e) => e);
  expect(err.status).toBe(422);
  expect(err.error.code).toBe("validation_error");
  expect(typeof err.error.message).toBe("string");
  expect(err.error).not.toHaveProperty("detail");
});

test("non-JSON 500 yields a fallback error object with the status", async () => {
  const err = await api.get("/api/boom").catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(500);
  expect(err.error.code).toBe("http_error");
  expect(err.error.message).toContain("Internal Server Error");
});

test("204 No Content resolves to null without crashing on empty body", async () => {
  const res = await api.del("/api/notes/5");
  expect(res).toBeNull();
});

test("post serializes JSON body and sets content-type", async () => {
  const res = await api.post("/api/echo-body", { hello: "world", n: 3 });
  expect(res.contentType).toContain("application/json");
  expect(res.received).toEqual({ hello: "world", n: 3 });
});

test("put round-trips a JSON body", async () => {
  const res = await api.put("/api/settings", { usd_rate: 1350 });
  expect(res.saved).toEqual({ usd_rate: 1350 });
});

test("delete is available under both `del` and `delete` and returns a 200 body", async () => {
  expect(api.del).toBe(api.delete);
  const res = await api.delete("/api/notes-200/7");
  expect(res).toEqual({ deleted: 7 });
});

// ---- Review-fix coverage (I1 / M1 / M2) ----
// NOTE: the abort-re-throw branch of I1 is covered in a companion file
// `api-client.abort.test.js`, which runs in the `node` test environment. Under
// jsdom, jsdom's `AbortSignal` global is a different realm from undici's (Node's
// `fetch`), so undici rejects ANY AbortController signal with a `TypeError`
// before a real `AbortError` can ever be produced — making a faithful abort
// test impossible here. The node-env companion uses an absolute base URL so a
// genuine `AbortController().abort()` surfaces a real undici `AbortError`.

test("network failure normalizes to ApiError(status 0, code network_error) (I1)", async () => {
  const err = await api.get("/api/down").catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).not.toBeInstanceOf(AuthError);
  expect(err.status).toBe(0);
  expect(err.error.code).toBe("network_error");
  expect(typeof err.error.message).toBe("string");
  expect(err.error.message.length).toBeGreaterThan(0);
});

test("non-envelope JSON error body surfaces its `message` field (M1)", async () => {
  const err = await api.get("/api/weird").catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(500);
  expect(err.error.code).toBe("http_error");
  expect(err.error.message).toBe("weird");
});

test("non-envelope JSON error body surfaces its `detail` field (M1)", async () => {
  const err = await api.get("/api/weird-detail").catch((e) => e);
  expect(err.error.code).toBe("http_error");
  expect(err.error.message).toBe("odd detail");
});

test("array query params serialize as repeated keys, not CSV (M2)", async () => {
  const res = await api.get("/api/array-echo", {
    params: { ids: [1, 2, 3] },
  });
  const url = new URL(res.url);
  expect(url.searchParams.getAll("ids")).toEqual(["1", "2", "3"]);
  // Repeated-key form, never CSV-encoded.
  expect(url.search).toContain("ids=1&ids=2&ids=3");
  expect(url.search).not.toContain("ids=1%2C2%2C3");
  expect(url.search).not.toContain("ids=1,2,3");
});

test("array query params skip null/undefined elements; falsy values survive (M2)", async () => {
  const res = await api.get("/api/array-echo", {
    params: { ids: [0, null, false, undefined, 5] },
  });
  const url = new URL(res.url);
  // null/undefined dropped; 0 and false preserved as meaningful values.
  expect(url.searchParams.getAll("ids")).toEqual(["0", "false", "5"]);
});
