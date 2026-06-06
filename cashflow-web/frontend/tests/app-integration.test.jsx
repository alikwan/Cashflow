// tests/app-integration.test.jsx — full-<App/> integration tests.
//
// These render the REAL <App/> authenticated (App provides its OWN AuthProvider,
// so there is no `initialUser` seam — auth is seeded by the boot
// `GET /api/auth/me` fetch returning 200; the default shared handler does that).
// They exercise the cross-cutting wiring that the per-page tests in
// pages-core.test.jsx do NOT cover:
//   1. Active-page navigation through the AppShell sidebar (Dashboard → Forecast).
//   2. The header GlobalSearch regression guard for fix I-1: a top-debtor result
//      row must NOT render the literal "undefined" (the search index now uses the
//      account id, not the dropped `contract` field).
//   3. Live TweaksPanel propagation: changing the reserve from its default flips
//      the Forecast page's "إسقاط معدّل" adjusted-projection banner on.
//
// MSW handlers reset between tests via the shared setup (afterEach). The default
// installments fixture already returns ACCOUNT-LEVEL top_debtors (account_id +
// name, no contract) — exactly the shape that surfaced the "عقد undefined" bug —
// so test 2 needs no override. userEvent is not installed; we use fireEvent.
import { render, screen, fireEvent, within } from "@testing-library/react";
import App from "../src/App";

// ---- 1. Navigation: Dashboard → Forecast through the real AppShell switch ----
test("App navigates from the dashboard to the forecast page via the sidebar", async () => {
  render(<App />);

  // The authed shell + Dashboard render once /api/auth/me resolves 200.
  expect(await screen.findByText(/مقبوضات السنة/)).toBeInTheDocument();

  // Click the forecast sidebar NavButton. "التنبؤ والسيناريوهات" is both the nav
  // label and (once mounted) the page title, so before the click it is the nav
  // item; click the first match (the sidebar button).
  fireEvent.click(screen.getAllByText("التنبؤ والسيناريوهات")[0]);

  // The Forecast page mounted: its MAPE/confidence badge (fixture confidence
  // "عالية") and a forecast-specific section title prove the page-hook
  // composition wired end-to-end through the real App switch.
  expect(await screen.findByText(/دقة التنبؤ/)).toBeInTheDocument();
  expect(
    await screen.findByText("مسار رصيد الصناديق المتوقع")
  ).toBeInTheDocument();
});

// ---- 2. Search regression guard for I-1: no "undefined" debtor meta ----------
test("header search renders a top-debtor result without any 'undefined' text", async () => {
  render(<App />);

  // Wait for the shell to be authed + the app-level installments hook to have
  // populated the search index (the dashboard KPI is a proxy for "loaded").
  expect(await screen.findByText(/مقبوضات السنة/)).toBeInTheDocument();

  // Type a query matching the default installments fixture's first top_debtor
  // ("مصطفى عبد الله", account_id 1631 — account-level, NO contract).
  const search = screen.getByPlaceholderText("بحث في النظام…");
  fireEvent.change(search, { target: { value: "مصطفى" } });

  // The result row appears.
  const result = await screen.findByText("مصطفى عبد الله");
  // I-1: its meta must be the account id, never "عقد undefined" / "undefined".
  expect(screen.queryByText(/عقد undefined/)).toBeNull();
  expect(screen.queryByText(/undefined/)).toBeNull();
  // Positive proof the fix's account-id meta rendered.
  expect(screen.getByText(/حساب\s*1631/)).toBeInTheDocument();
  // And the whole result row contains no "undefined" substring.
  const row = result.closest("button");
  expect(row).not.toBeNull();
  expect(row.textContent).not.toMatch(/undefined/);
});

// ---- 3. Live tweak propagation: reserve change → Forecast adjusted banner -----
test("changing the reserve in the TweaksPanel flips the forecast adjusted-projection banner", async () => {
  render(<App />);
  expect(await screen.findByText(/مقبوضات السنة/)).toBeInTheDocument();

  // Open the always-available TweaksPanel via its FAB (aria-label "تعديل سريع").
  fireEvent.click(screen.getByLabelText("تعديل سريع"));

  // The panel opened: its dialog + controls render.
  const dialog = await screen.findByRole("dialog", { name: "تعديل سريع" });
  // Two range sliders live in the panel (reserve, then income growth). The
  // reserve slider is the first; its default value is the meta RESERVE_M (15),
  // which equals the Forecast page's default reserve → no banner yet.
  const sliders = within(dialog).getAllByRole("slider");
  expect(sliders.length).toBeGreaterThanOrEqual(2);
  const reserveSlider = sliders[0];
  expect(reserveSlider).toHaveValue("15");

  // Drive the reserve away from the default (15 → 25). Native <input type=range>
  // so fireEvent.change is deterministic in jsdom.
  fireEvent.change(reserveSlider, { target: { value: "25" } });
  expect(reserveSlider).toHaveValue("25");

  // Navigate to Forecast; the live reserve (25) now differs from RESERVE_M (15),
  // so the "إسقاط معدّل" adjusted-projection banner must render.
  fireEvent.click(screen.getAllByText("التنبؤ والسيناريوهات")[0]);
  expect(await screen.findByText(/إسقاط معدّل/)).toBeInTheDocument();
});
