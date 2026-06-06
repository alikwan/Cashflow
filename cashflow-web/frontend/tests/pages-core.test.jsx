// tests/pages-core.test.jsx — Task D2 page tests.
//
// Covers the 3 ported core pages (Dashboard, MonthlyFlow, Breakdown) rendered
// against the shared default MSW fixtures, plus the new async states (loading,
// error) and a small App-integration test that the authed shell + dashboard
// render when /api/auth/me returns 200.
//
// The pages compose the D1 hooks (NOT window.DATA); these tests therefore also
// implicitly pin the silent renames — especially the siyrafa→sayrafa flow,
// which the Breakdown test asserts end-to-end.
import { render, screen, fireEvent } from "@testing-library/react";
import { http, HttpResponse, delay } from "msw";
import { server, renderWithProviders } from "./setup";
import App from "../src/App";
import { Dashboard } from "../src/pages/Dashboard";
import { MonthlyFlow } from "../src/pages/MonthlyFlow";
import { Breakdown } from "../src/pages/Breakdown";

// ---- Dashboard: KPI cards + the live-driven alert banner ----------------
test("dashboard shows KPI cards and alert banner", async () => {
  renderWithProviders(<Dashboard onNavigate={() => {}} />);
  // A KPI tile label.
  expect(await screen.findByText(/مقبوضات السنة/)).toBeInTheDocument();
  // The danger banner heading starts with "تنبيه سيولة" (driven by the default
  // dashboard fixture's primary `severity: "danger"` alert).
  expect(await screen.findByText(/تنبيه سيولة/)).toBeInTheDocument();
});

test("dashboard renders all five KPI tiles", async () => {
  renderWithProviders(<Dashboard onNavigate={() => {}} />);
  for (const label of [
    "مقبوضات السنة",
    "مصروفات السنة",
    "صافي السيولة",
    "رصيد الصناديق الحالي",
    "أقساط مستحقة",
  ]) {
    expect(await screen.findByText(label)).toBeInTheDocument();
  }
});

// ---- MonthlyFlow: chart section + aggregate strip ----------------------
test("monthly flow renders its chart section and the FY tabs", async () => {
  renderWithProviders(<MonthlyFlow />);
  // The line-chart section title.
  expect(
    await screen.findByText("المقبوضات · المصروفات · الصافي")
  ).toBeInTheDocument();
  // The active FY tab label appears (both the segmented tab and the net-bars
  // subtitle echo it, so match all).
  expect(screen.getAllByText("2025/2026").length).toBeGreaterThan(0);
  // The net-bars section title.
  expect(screen.getByText("الصافي الشهري")).toBeInTheDocument();
});

// ---- Breakdown: the sayrafa category + receipts (mapping verified) ------
test("breakdown shows the sayrafa expense category (siyrafa→sayrafa mapping)", async () => {
  renderWithProviders(<Breakdown />);
  // The expense view is the default. The siyrafa category, normalized to the
  // page key `sayrafa` by the useBreakdown mapper, surfaces by its Arabic
  // display name from EXP_CATS_META (in the legend, the category table AND its
  // summary tile) — proving the rename flows end-to-end.
  const sayrafa = await screen.findAllByText("صيرفة (دينار→دولار)");
  expect(sayrafa.length).toBeGreaterThan(0);
  // The receipts toggle proves the expense/receipts switch renders.
  expect(screen.getByText("المقبوضات")).toBeInTheDocument();
});

test("breakdown shows a receipts figure when toggled to receipts", async () => {
  renderWithProviders(<Breakdown />);
  // Wait for load, then switch to the receipts view.
  await screen.findAllByText("صيرفة (دينار→دولار)");
  fireEvent.click(screen.getByText("المقبوضات"));
  // The receipts-total MiniStat label appears.
  expect(
    await screen.findByText("إجمالي المقبوضات · 12 شهر")
  ).toBeInTheDocument();
});

// ---- Loading state: a withheld handler shows the spinner first ----------
test("a page shows the loading indicator before data resolves", async () => {
  // Delay the cashflow endpoint so MonthlyFlow stays in its loading state.
  server.use(
    http.get("/api/cashflow/monthly", async () => {
      await delay(60);
      return HttpResponse.json({ months: [], forecast: [], by_fiscal_year: [] });
    })
  );
  renderWithProviders(<MonthlyFlow />);
  // The on-brand loading status renders while the fetch is in flight.
  expect(await screen.findByRole("status", { name: "جارٍ التحميل" })).toBeInTheDocument();
});

// ---- Error state: a 500 shows the error card with retry -----------------
test("a page shows the error card when the API fails", async () => {
  server.use(
    http.get("/api/cashflow/monthly", () =>
      HttpResponse.json(
        { error: { code: "internal_server_error", message: "خطأ" } },
        { status: 500 }
      )
    )
  );
  renderWithProviders(<MonthlyFlow />);
  expect(await screen.findByText("تعذّر تحميل البيانات")).toBeInTheDocument();
  expect(screen.getByText("إعادة المحاولة")).toBeInTheDocument();
});

// ---- App integration: authed shell + dashboard render on /me 200 --------
test("App renders the shell and dashboard when authenticated", async () => {
  // App provides its OWN AuthProvider (no `initialUser` seam), so seed the
  // authed state via the boot /api/auth/me fetch (default handler returns 200).
  render(<App />);
  // The sidebar nav item proves the AppShell mounted; the dashboard KPI proves
  // the active page rendered through the switch.
  expect(
    (await screen.findAllByText("اللوحة التنفيذية")).length
  ).toBeGreaterThan(0);
  expect(await screen.findByText(/مقبوضات السنة/)).toBeInTheDocument();
});
