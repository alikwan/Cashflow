import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import App from "../src/App";
import { server } from "./setup";

test("app mounts, document dir is rtl, and unauthenticated lands on login", async () => {
  // MSW is now centralized (Task D1), and the shared default `/api/auth/me`
  // returns 200 (authed). To assert the UNAUTHENTICATED path we override it with
  // a 401 for this test: AuthProvider's boot fetch rejects (AuthError), which
  // AuthContext swallows → settles to "no user" → the Login screen renders.
  // Awaiting it lets the async settle happen INSIDE RTL's act() (no act warning).
  server.use(
    http.get("/api/auth/me", () =>
      HttpResponse.json(
        { error: { code: "unauthorized", message: "يجب تسجيل الدخول" } },
        { status: 401 }
      )
    )
  );

  render(<App />);
  expect(document.documentElement.dir).toBe("rtl");
  expect(await screen.findByText(/تسجيل الدخول/)).toBeInTheDocument();
});
