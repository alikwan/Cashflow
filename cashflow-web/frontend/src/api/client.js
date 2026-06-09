// api/client.js — the SINGLE place in the frontend that calls `fetch`.
//
// Every later module (auth context, data hooks, settings writes, exports) goes
// through this `api` singleton. It is deliberately small but complete:
//
//   - All requests send the HttpOnly session cookie (`credentials: "include"`),
//     because the backend has no CORS and the session is same-origin.
//   - JSON request bodies are serialized with `Content-Type: application/json`.
//   - 2xx responses are parsed as JSON when a body is present; empty bodies
//     (204 No Content, or any 2xx with no content) resolve to `null` without
//     trying to JSON.parse an empty string.
//   - Non-2xx responses are converted into an `ApiError` (an Error subclass)
//     carrying `.status` (number) and `.error` (the parsed `{code, message}`
//     envelope, or a sensible fallback when the body is not the envelope —
//     e.g. a non-JSON 500). HTTP 401 specifically throws an `AuthError`
//     (subclass of `ApiError`) so the auth layer can `instanceof`-check it and
//     redirect to login.
//
// Error contract (every consumer can rely on this uniform shape):
//   - HTTP non-2xx           → ApiError(status, envelope `{code, message}`).
//   - HTTP 401               → AuthError (subclass of ApiError, status 401).
//   - Network/transport fail → ApiError(0, { code: "network_error", message }).
//                              (backend down, LAN drop, DNS, TLS, CORS reject)
//   - Caller-initiated abort → the original AbortError is re-thrown AS-IS
//                              (NOT wrapped) so callers can detect/ignore it.
// Thus `err.status` and `err.error.{code, message}` are always present on
// ApiError/AuthError, and only an intentional abort escapes that contract.
//
// NOT handled here (by design — this is a JSON-only client): binary/file
// responses (`/api/export/excel`, `/api/export/pdf`) and `FormData` request
// bodies. Those need their own blob/multipart path, to be added when the
// export feature lands; do not route them through `request()`.
//
// Base URL defaults to same-origin (empty string), so `/api/...` paths hit the
// Vite dev proxy in development and nginx in production. Override via the
// `VITE_API_BASE` env var if the API ever lives on a different origin.

/**
 * Configurable base URL. Empty by default → same-origin (relative URLs).
 * `import.meta.env` is provided by Vite/Vitest; guard it so the module is
 * importable in any environment.
 */
const BASE_URL =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE) ||
  "";

/**
 * Base error for every non-2xx HTTP response.
 * Carries the HTTP status and the parsed error envelope.
 */
export class ApiError extends Error {
  /**
   * @param {number} status  HTTP status code (0 for transport/network failures).
   * @param {{code: string, message: string}} error  Parsed error envelope (or fallback).
   * @param {{cause?: unknown}} [opts]  Optional; forwards the original error as `.cause`.
   */
  constructor(status, error, opts) {
    const message =
      (error && error.message) || `HTTP ${status}`;
    super(message, opts);
    this.name = "ApiError";
    this.status = status;
    // `.error` is the `{code, message}` object callers inspect (e.g. to tell
    // a 409 "conflict" from a 409 "etl_running"). Never special-cased here —
    // we just surface it so callers decide.
    this.error = error;
  }
}

/**
 * Thrown specifically for HTTP 401. Subclass of ApiError, so both
 * `err instanceof AuthError` and `err.status === 401` hold, and a generic
 * `err instanceof ApiError` catch still works.
 */
export class AuthError extends ApiError {
  constructor(error) {
    super(401, error);
    this.name = "AuthError";
  }
}

/**
 * Build a URL from a path and optional query params.
 * Skips params whose value is `undefined` or `null` (including such elements
 * inside an array). Array values are serialized as repeated keys
 * (`?ids=1&ids=2&ids=3`) rather than a single CSV value, which is what the
 * backend's list query params expect. Booleans/numbers (including `0`/`false`)
 * serialize via `String(value)` so falsy-but-meaningful values survive.
 */
function buildUrl(path, params) {
  let url = `${BASE_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v === undefined || v === null) continue;
          qs.append(key, String(v));
        }
      } else {
        qs.append(key, String(value));
      }
    }
    const q = qs.toString();
    if (q) url += (path.includes("?") ? "&" : "?") + q;
  }
  return url;
}

/**
 * Parse a response body as JSON, tolerating empty bodies and non-JSON content.
 * Returns `null` when there is no body to parse.
 */
async function parseBody(res) {
  // 204 No Content (and 304) never carry a body.
  if (res.status === 204 || res.status === 304) return null;

  const text = await res.text();
  if (!text) return null; // empty body (any 2xx with no content)

  try {
    return JSON.parse(text);
  } catch {
    // Non-JSON body (e.g. a plain-text 500 or an HTML proxy error page).
    return text;
  }
}

/**
 * Core request driver. All verb helpers delegate here.
 *
 * @param {string} method  HTTP method.
 * @param {string} path    Path beginning with "/" (e.g. "/api/meta").
 * @param {object} [opts]
 * @param {object} [opts.params]  Query params (GET-style; also allowed elsewhere).
 * @param {*}      [opts.body]    Request body; plain objects are JSON-serialized.
 * @param {AbortSignal} [opts.signal]  Abort signal for cancellation.
 * @param {object} [opts.headers] Extra headers to merge.
 * @returns {Promise<*>}  Parsed JSON body, or null for empty/204 responses.
 */
async function request(method, path, { params, body, signal, headers } = {}) {
  const init = {
    method,
    credentials: "include",
    headers: { Accept: "application/json", ...headers },
    signal,
  };

  if (body !== undefined && body !== null) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(buildUrl(path, params), init);
  } catch (e) {
    // A caller-initiated abort (via `opts.signal`) is intentional cancellation —
    // re-throw it untouched so callers can detect/ignore it with `e.name`.
    if (e && e.name === "AbortError") throw e;
    // Any other rejection here is a transport-level failure (backend down, LAN
    // drop, DNS/TLS, CORS reject): fetch never reached an HTTP response, so
    // there is no status. Normalize to the same contract as HTTP errors with a
    // synthetic status 0 and a `network_error` envelope.
    throw new ApiError(
      0,
      { code: "network_error", message: "تعذّر الاتصال بالخادم" },
      { cause: e }
    );
  }

  const parsed = await parseBody(res);

  if (!res.ok) {
    // Normalize the error payload to the `{code, message}` envelope. If the
    // backend returned the unified envelope, unwrap its `.error`; otherwise
    // synthesize a fallback so callers always get a consistent shape.
    let errObj;
    if (parsed && typeof parsed === "object" && parsed.error) {
      errObj = parsed.error;
    } else if (parsed && typeof parsed === "object" && parsed.code) {
      // Already an `{code, message}` object (defensive).
      errObj = parsed;
    } else {
      // Fallback path: body is neither the `{error}` envelope nor a bare
      // `{code}` object. Prefer a human-readable message when one is present —
      // a plain-text body, or a `message`/`detail` field on a non-envelope JSON
      // object (e.g. FastAPI's `{detail: "..."}`) — before the bare HTTP text.
      let message;
      if (typeof parsed === "string" && parsed) {
        message = parsed;
      } else if (
        parsed &&
        typeof parsed === "object" &&
        (typeof parsed.message === "string" || typeof parsed.detail === "string")
      ) {
        message = parsed.message || parsed.detail;
      } else {
        message = `HTTP ${res.status}`;
      }
      errObj = { code: "http_error", message };
    }

    if (res.status === 401) throw new AuthError(errObj);
    throw new ApiError(res.status, errObj);
  }

  return parsed;
}

/**
 * The singleton API client. The single fetch surface for the whole frontend.
 *
 * Note on naming: the DELETE helper is exposed as both `del` and `delete`.
 * `delete` is a reserved word as a bare identifier but is valid as a property
 * name; `del` is provided for callers who prefer to avoid it entirely.
 */
const del = (path, opts) => request("DELETE", path, opts);

export const api = {
  get: (path, opts) => request("GET", path, opts),
  post: (path, body, opts) => request("POST", path, { ...opts, body }),
  put: (path, body, opts) => request("PUT", path, { ...opts, body }),
  patch: (path, body, opts) => request("PATCH", path, { ...opts, body }),
  del,
  // Same function as `del`; `delete` is valid as a property name even though it
  // is a reserved word as a bare identifier. Both point at one implementation.
  delete: del,
};

export default api;
