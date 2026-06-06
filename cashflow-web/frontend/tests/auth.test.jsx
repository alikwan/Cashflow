// Auth flow tests (Task B2). MSW drives the /api/auth/* contract:
//   GET  /api/auth/me     → 401 (unauthed) until login, then 200.
//   POST /api/auth/login  → 200 {username, display_name} | 401 | 429.
//
// MSW is now centralized (Task D1): this file registers its /api/auth/*
// handlers on the SHARED server via `server.use(...)`, and the server lifecycle
// (listen / reset / close) lives in tests/setup.js. We render <App/> standalone
// (the AuthProvider lives INSIDE App), matching the plan's test.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import App from "../src/App";
import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { server } from "./setup";

// Unified backend error envelope: { error: { code, message } }.
const envelope = (code, message) => ({ error: { code, message } });

// `authed` is flipped by the login handler so that /api/auth/me starts
// returning 200 after a successful login — mirroring the real session cookie.
let authed = false;

// Register this file's auth handlers on the shared server before EACH test
// (setup.js resets runtime handlers in its afterEach). These OVERRIDE the
// shared default `/api/auth/me` (which returns an unconditional 200) so this
// suite controls the authed/unauthed lifecycle precisely.
beforeEach(() => {
  authed = false;
  server.use(
    http.get("/api/auth/me", () => {
      if (authed) {
        return HttpResponse.json({ username: "ali", display_name: "علي السامرائي" });
      }
      return HttpResponse.json(
        envelope("unauthorized", "يجب تسجيل الدخول"),
        { status: 401 }
      );
    }),
    http.post("/api/auth/login", async ({ request }) => {
      const { username, password } = await request.json();
      if (username === "ali" && password === "correct") {
        authed = true;
        return HttpResponse.json({ username: "ali", display_name: "علي السامرائي" });
      }
      return HttpResponse.json(
        envelope("unauthorized", "بيانات الدخول غير صحيحة"),
        { status: 401 }
      );
    }),
    http.post("/api/auth/logout", () => {
      authed = false;
      return HttpResponse.json({ status: "ok" });
    })
  );
});

// Helper: fill the username + password fields and submit the login form.
function submitLogin(username, password) {
  fireEvent.change(screen.getByLabelText(/اسم المستخدم/), {
    target: { value: username },
  });
  fireEvent.change(screen.getByLabelText(/كلمة المرور/), {
    target: { value: password },
  });
  // The submit button reads exactly "تسجيل الدخول".
  fireEvent.click(screen.getByRole("button", { name: /تسجيل الدخول/ }));
}

test("shows login when unauthenticated", async () => {
  render(<App />);
  // The login screen renders the submit button "تسجيل الدخول".
  expect(await screen.findByText(/تسجيل الدخول/)).toBeInTheDocument();
});

test("valid credentials log in and leave the login screen", async () => {
  render(<App />);
  // Wait for the boot /api/auth/me (401) to resolve into the login screen.
  await screen.findByRole("button", { name: /تسجيل الدخول/ });

  submitLogin("ali", "correct");

  // The authed placeholder shows the logged-in display name + logout button.
  expect(await screen.findByText(/علي السامرائي/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /تسجيل الخروج/ })
  ).toBeInTheDocument();
});

test("bad credentials show an error and stay on the login screen", async () => {
  render(<App />);
  await screen.findByRole("button", { name: /تسجيل الدخول/ });

  submitLogin("ali", "wrong");

  expect(
    await screen.findByText(/اسم المستخدم أو كلمة المرور غير صحيحة/)
  ).toBeInTheDocument();
  // Still on the login screen — the submit button is still present.
  expect(
    screen.getByRole("button", { name: /تسجيل الدخول/ })
  ).toBeInTheDocument();
});

test("a 429 shows the throttle message", async () => {
  server.use(
    http.post("/api/auth/login", () =>
      HttpResponse.json(
        envelope("too_many_requests", "محاولات كثيرة"),
        { status: 429 }
      )
    )
  );
  render(<App />);
  await screen.findByRole("button", { name: /تسجيل الدخول/ });

  submitLogin("ali", "whatever");

  expect(await screen.findByText(/محاولات كثيرة/)).toBeInTheDocument();
});

// Tiny consumer that surfaces the resolved auth value for assertions.
function AuthProbe() {
  const { user, loading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? user.display_name : "none"}</span>
    </div>
  );
}

test("initialUser seeds an authed session and SKIPS the boot /api/auth/me fetch", async () => {
  // Trip-wire: if AuthProvider ever fetches /me when seeded, fail loudly.
  let meCalled = false;
  server.use(
    http.get("/api/auth/me", () => {
      meCalled = true;
      return HttpResponse.json(
        envelope("server_error", "should never be called when seeded"),
        { status: 500 }
      );
    })
  );

  render(
    <AuthProvider initialUser={{ username: "owner", display_name: "علي" }}>
      <AuthProbe />
    </AuthProvider>
  );

  // Seeded synchronously: already resolved (loading=false) with the seeded user.
  expect(screen.getByTestId("loading")).toHaveTextContent("false");
  expect(screen.getByTestId("user")).toHaveTextContent("علي");

  // Give any (unwanted) boot fetch a chance to fire, then prove it never did.
  await waitFor(() => {
    expect(screen.getByTestId("user")).toHaveTextContent("علي");
  });
  expect(meCalled).toBe(false);
});
