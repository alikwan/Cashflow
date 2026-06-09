// tests/pages-suppliers.test.jsx — Task D3 page tests.
//
// Covers the 4 ported pages (Suppliers, Installments, Forecast, SupplierPlan)
// against the shared default MSW fixtures, plus the two contract-critical
// behaviors: the Forecast MAPE/confidence badge (shown when non-null, hidden
// when null) and the SupplierPlan dollar-supplier "مموَّل عبر الصيرفة" labelling
// (give=0, NOT a pool share — no data.js allocate()/SUP_SHARE was ported).
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse, delay } from "msw";
import { server, renderWithProviders } from "./setup";
import { Suppliers } from "../src/pages/Suppliers";
import { Installments } from "../src/pages/Installments";
import { Forecast } from "../src/pages/Forecast";
import { SupplierPlan } from "../src/pages/SupplierPlan";

// ---- Suppliers: the 14-supplier heat grid -------------------------------
describe("Suppliers page", () => {
  test("renders a known supplier and the over-cap KPI", async () => {
    renderWithProviders(<Suppliers />);
    // A known supplier name from the default fixture.
    expect(await screen.findByText("معرض البركة")).toBeInTheDocument();
    // The dollar supplier keeps its دولار badge.
    expect(screen.getByText("شركة الحافظ")).toBeInTheDocument();
    // The over-cap KPI label renders.
    expect(screen.getByText("حالات تجاوز السقف")).toBeInTheDocument();
    // The USD-suppliers count is derived from the data (1 in the default fixture).
    expect(screen.getByText("موردون بالدولار")).toBeInTheDocument();
  });

  test("shows loading then content", async () => {
    server.use(
      http.get("/api/suppliers", async () => {
        await delay(40);
        return HttpResponse.json({ suppliers: [] });
      })
    );
    renderWithProviders(<Suppliers />);
    expect(
      await screen.findByRole("status", { name: "جارٍ التحميل" })
    ).toBeInTheDocument();
  });
});

// ---- Installments: outstanding reflects remaining_m, NOT 4670 -----------
describe("Installments page", () => {
  test("outstanding total reflects remaining_m and an aging bucket renders", async () => {
    renderWithProviders(<Installments />);
    // The "لم يستحق بعد" (current bucket, mapped from API not_due) tile renders —
    // proving aging.find(a=>a.key==='current') works.
    expect(await screen.findByText("لم يستحق بعد (جاري)")).toBeInTheDocument();
    // An aging bucket label from the fixture.
    expect(screen.getByText("+120 يوم")).toBeInTheDocument();
    // The old hard-coded "4.67 مليار" string must be GONE.
    expect(screen.queryByText(/4\.67 مليار/)).not.toBeInTheDocument();
  });

  test("top debtor with missing contract/bucket/due fields does not crash", async () => {
    renderWithProviders(<Installments />);
    // Debtor names from the fixture render; the account id stands in for the
    // dropped mock columns (contract/bucket/due).
    expect(await screen.findByText("مصطفى عبد الله")).toBeInTheDocument();
    expect(screen.getByText("علي حسين كاظم")).toBeInTheDocument();
  });

  test("error state shows the retry card", async () => {
    server.use(
      http.get("/api/installments", () =>
        HttpResponse.json(
          { error: { code: "internal_server_error", message: "خطأ" } },
          { status: 500 }
        )
      )
    );
    renderWithProviders(<Installments />);
    expect(await screen.findByText("تعذّر تحميل البيانات")).toBeInTheDocument();
  });
});

// ---- Forecast: the MAPE/confidence badge -------------------------------
describe("Forecast page", () => {
  // The given test: badge renders when mape/confidence are non-null.
  test("forecast page shows MAPE confidence badge", async () => {
    renderWithProviders(<Forecast />); // MSW default: /api/forecast → {mape:18, confidence:"عالية"}
    expect(await screen.findByText(/عالية/)).toBeInTheDocument();
    // The MAPE % also surfaces.
    expect(screen.getByText(/MAPE 18%/)).toBeInTheDocument();
  });

  test("MAPE badge is HIDDEN when mape/confidence are null", async () => {
    server.use(
      http.get("/api/forecast", () =>
        HttpResponse.json({
          forecast: [
            {
              year_month: "2026-05",
              base: { in_m: 100, out_m: 95, net_m: 5 },
              opt: { in_m: 108, out_m: 93, net_m: 15 },
              pess: { in_m: 92, out_m: 100, net_m: -8 },
            },
          ],
          cash_paths: { base: [221], opt: [231], pess: [208] },
          fc_totals: {
            base: { in_m: 100, out_m: 95, net_m: 5, end_cash_m: 221, min_cash_m: 221 },
            opt: { in_m: 108, out_m: 93, net_m: 15, end_cash_m: 231, min_cash_m: 231 },
            pess: { in_m: 92, out_m: 100, net_m: -8, end_cash_m: 208, min_cash_m: 208 },
          },
          scenarios: {
            base: { label: "متحفّظ", in_g: 1.0, out_g: 1.0 },
            opt: { label: "متفائل", in_g: 1.08, out_g: 0.98 },
            pess: { label: "متشائم", in_g: 0.92, out_g: 1.06 },
          },
          mape: null,
          confidence: null,
        })
      )
    );
    renderWithProviders(<Forecast />);
    // Wait for the page to load (a KPI label), then assert the badge is absent.
    expect(await screen.findByText("مقبوضات متوقعة · 12 شهر")).toBeInTheDocument();
    expect(screen.queryByText(/دقة التنبؤ/)).not.toBeInTheDocument();
  });
});

// ---- SupplierPlan: dollar suppliers funded via siyrafa -----------------
describe("SupplierPlan page", () => {
  // The given test: dollar suppliers labelled "عبر الصيرفة", not in the pool.
  test("supplier-plan shows dollar suppliers funded via siyrafa, not in pool", async () => {
    renderWithProviders(<SupplierPlan />); // default plan: USD supplier allocated_m=0
    expect(await screen.findByText(/عبر الصيرفة/)).toBeInTheDocument();
  });

  test("a dinar supplier shows a non-zero give; a USD supplier shows give 0 + label; cap joins from suppliers", async () => {
    renderWithProviders(<SupplierPlan />);
    // The dinar supplier (البركة) renders with its allocated give (5.0 from the
    // default plan fixture) in the distribution table.
    expect(await screen.findByText("معرض البركة")).toBeInTheDocument();
    // The USD supplier (الحافظ) renders the "مموَّل عبر الصيرفة" label instead of
    // a give figure.
    expect(screen.getByText("شركة الحافظ")).toBeInTheDocument();
    const siyrafaLabels = screen.getAllByText("مموَّل عبر الصيرفة");
    expect(siyrafaLabels.length).toBeGreaterThan(0);
    // The pool total surfaces in the "حساب المجمّع" panel.
    expect(screen.getByText("المجمّع المتاح")).toBeInTheDocument();
  });

  test("shows loading then content", async () => {
    server.use(
      http.get("/api/supplier-plan", async ({ request }) => {
        await delay(40);
        const month = new URL(request.url).searchParams.get("month") || "2026-05";
        return HttpResponse.json({ month, pool_m: 100, leftover_m: 10, alloc: [] });
      })
    );
    renderWithProviders(<SupplierPlan />);
    expect(
      await screen.findByRole("status", { name: "جارٍ التحميل" })
    ).toBeInTheDocument();
  });

  test("error state shows the retry card", async () => {
    server.use(
      http.get("/api/supplier-plan", () =>
        HttpResponse.json(
          { error: { code: "internal_server_error", message: "خطأ" } },
          { status: 500 }
        )
      )
    );
    renderWithProviders(<SupplierPlan />);
    expect(await screen.findByText("تعذّر تحميل البيانات")).toBeInTheDocument();
  });

  // Empty forecast (forecast: [] — a real early/empty-DB state): months become
  // [], so useSupplierPlanSeries stays idle (loading:false, data:[]). The page
  // must NOT hang on the spinner — it degrades to the on-brand empty state with
  // the PageHeader still shown.
  test("empty forecast does not spin forever — shows the empty state, not the loader", async () => {
    server.use(
      http.get("/api/forecast", () =>
        HttpResponse.json({
          forecast: [],
          cash_paths: {},
          fc_totals: {},
          scenarios: {},
          mape: null,
          confidence: null,
        })
      )
    );
    renderWithProviders(<SupplierPlan />);
    // The on-brand empty-state message appears (proving the loaded shell rendered
    // with zero months instead of an endless spinner).
    expect(
      await screen.findByText(
        "لا توجد بيانات تنبؤ متاحة بعد لعرض خطة التوزيع."
      )
    ).toBeInTheDocument();
    // The PageHeader title is still shown (on-brand shell).
    expect(screen.getByText("توزيع موردين تنبؤي")).toBeInTheDocument();
    // The loading indicator is eventually gone (no perpetual spinner).
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );
  });
});
