import { render, screen } from "@testing-library/react";
import App from "../src/App";

test("app mounts, document dir is rtl, and unauthenticated lands on login", async () => {
  render(<App />);
  expect(document.documentElement.dir).toBe("rtl");
  // There is no MSW server here, so AuthProvider's boot fetch to the relative
  // `/api/auth/me` rejects → the B1 client wraps it as a `network_error`
  // ApiError, which AuthContext swallows → settles to "no user". Awaiting the
  // Login screen lets that async settle happen INSIDE RTL's act(), which both
  // removes the "not wrapped in act()" warning and asserts the no-server path.
  expect(await screen.findByText(/تسجيل الدخول/)).toBeInTheDocument();
});
