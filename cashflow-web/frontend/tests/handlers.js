// tests/handlers.js — the SHARED default MSW handlers for the whole suite.
//
// These return realistic sample responses (shapes per
// `cashflow-web/docs/discovery/05-api-response-shapes.md`) for EVERY read
// endpoint the frontend hooks call, plus `GET /api/auth/me` so authed renders
// work without each test wiring its own handler. Individual tests override a
// specific endpoint with `server.use(...)` from `tests/setup.js`.
//
// Keep the data small but representative: enough rows that pages render, and
// every snake_case key the mappers read is present so D2/D3 page tests "just
// work".
import { http, HttpResponse } from "msw";

// Unified backend error envelope: { error: { code, message } }.
export const envelope = (code, message) => ({ error: { code, message } });

// Two months of history (ascending), enough to exercise per-month derivation.
const SAMPLE_MONTHS = [
  {
    year_month: "2026-01",
    cash_in_m: 110.0,
    out_total_m: 100.0,
    out_total_comprehensive_m: 100.0,
    net_total_m: 10.0,
    cash_running_m: 70.0,
    fiscal_year: "2025-2026",
  },
  {
    year_month: "2026-02",
    cash_in_m: 120.0,
    out_total_m: 134.6,
    out_total_comprehensive_m: 134.6,
    net_total_m: -14.6,
    cash_running_m: 55.4,
    fiscal_year: "2025-2026",
  },
];

export const handlers = [
  // ---- auth ----
  http.get("/api/auth/me", () =>
    HttpResponse.json({ username: "owner", display_name: "علي" })
  ),

  // ---- meta ----
  http.get("/api/meta", () =>
    HttpResponse.json({
      usd_rate: 1350.0,
      current_cash_m: 216.0,
      reserve_m: 15.0,
      fy_start: 5,
      last_etl: {
        status: "success",
        started_at: "2026-06-05T01:00:00",
        finished_at: "2026-06-05T01:02:00",
        rows_loaded: 24,
        reconciliation_residual_m: 0.0,
      },
    })
  ),

  // ---- dashboard ----
  http.get("/api/dashboard", () =>
    HttpResponse.json({
      fy_totals: [
        { fiscal_year: "2024-2025", in_m: 1200.0, out_m: 1010.0, net_m: 190.0 },
        { fiscal_year: "2025-2026", in_m: 1278.0, out_m: 1247.0, net_m: 31.0 },
      ],
      net_decline_pct: 0.51,
      installments: {
        premium_count: 8500,
        face_total_m: 7122.0,
        cash_paid_m: 5650.0,
        discount_m: 150.0,
        remaining_m: 1260.0,
      },
      alerts: [
        {
          id: 1,
          alert_type: "negative_month",
          severity: "danger",
          title: "صافٍ سالب",
          body: "شباط 2026",
          related_key: "2026-02",
          status: "new",
          generated_at: "2026-06-05T02:00:00",
        },
        {
          id: 2,
          alert_type: "over_cap",
          severity: "warning",
          title: "تجاوز سقف",
          body: null,
          related_key: null,
          status: "new",
          generated_at: "2026-06-05T02:00:00",
        },
      ],
      monthly_series: SAMPLE_MONTHS.map((m) => ({
        year_month: m.year_month,
        cash_in_m: m.cash_in_m,
        out_total_comprehensive_m: m.out_total_comprehensive_m,
        net_total_m: m.net_total_m,
        cash_running_m: m.cash_running_m,
      })),
      expense_mix: {
        out_suppliers_m: 320.0,
        out_drawings_m: 540.0,
        out_refunds_m: 30.0,
        out_purchases_m: 70.0,
        out_salaries_m: 60.0,
        out_siyrafa_m: 391.0,
        out_other_m: 12.0,
      },
    })
  ),

  // ---- cashflow ----
  http.get("/api/cashflow/monthly", () =>
    HttpResponse.json({
      months: SAMPLE_MONTHS,
      forecast: [
        { year_month: "2026-05", cash_in_m: 100.0, out_total_m: 95.0, net_total_m: 5.0 },
      ],
      by_fiscal_year: [
        { fiscal_year: "2025-2026", in_m: 1278.0, out_m: 1247.0, net_m: 31.0 },
      ],
    })
  ),

  // ---- breakdown ----
  http.get("/api/breakdown", () =>
    HttpResponse.json({
      expense_cats: [
        { key: "suppliers", total_m: 320.0, monthly: [{ year_month: "2026-02", amount_m: 26.0 }] },
        { key: "partners", total_m: 540.0, monthly: [{ year_month: "2026-02", amount_m: 45.0 }] },
        { key: "siyrafa", total_m: 391.0, monthly: [{ year_month: "2026-02", amount_m: 32.0 }] },
        { key: "purchases", total_m: 70.0, monthly: [{ year_month: "2026-02", amount_m: 6.0 }] },
        { key: "salaries", total_m: 60.0, monthly: [{ year_month: "2026-02", amount_m: 5.0 }] },
        { key: "refunds", total_m: 30.0, monthly: [{ year_month: "2026-02", amount_m: 2.5 }] },
      ],
      partners: [
        { account_id: 2535, name: "فؤاد كريم", balance_m: 120.0 },
        { account_id: 2536, name: "علي كوان", balance_m: 95.0 },
      ],
      funds: [
        { account_id: 181, name: "صندوق المعتصم (الرئيسي)", balance_m: 96.0 },
        { account_id: 180, name: "نقد في الخزينة", balance_m: 43.0 },
      ],
    })
  ),

  // ---- suppliers ----
  http.get("/api/suppliers", () =>
    HttpResponse.json({
      suppliers: [
        {
          id: 1001,
          name: "معرض البركة",
          cap: 5.0,
          currency: "IQD",
          monthly: [2.8, 2.2, 3.1],
          over_cap: 1,
          balance_m: 4.0,
          util: 0.71,
          active: true,
        },
        {
          id: 4937,
          name: "شركة الحافظ",
          cap: 40.0,
          currency: "USD",
          monthly: [10.0, 12.0],
          over_cap: 0,
          balance_m: 54000.0,
          util: null,
          active: true,
        },
      ],
    })
  ),

  // ---- installments ----
  http.get("/api/installments", () =>
    HttpResponse.json({
      summary: {
        premium_count: 8500,
        face_total_m: 7122.0,
        cash_paid_m: 5650.0,
        discount_m: 150.0,
        remaining_m: 1260.0,
      },
      aging: [
        { bucket_key: "not_due", label: "لم يستحق بعد", amount_m: 890.0, count: 3120 },
        { bucket_key: "b0_30", label: "1 – 30 يوم", amount_m: 120.0, count: 980 },
        { bucket_key: "b31_60", label: "31 – 60 يوم", amount_m: 80.0, count: 540 },
        { bucket_key: "b61_90", label: "61 – 90 يوم", amount_m: 60.0, count: 360 },
        { bucket_key: "b91_120", label: "91 – 120 يوم", amount_m: 40.0, count: 210 },
        { bucket_key: "b120", label: "+120 يوم", amount_m: 70.0, count: 240 },
      ],
      top_debtors: [
        { account_id: 1631, name: "مصطفى عبد الله", balance_m: 41.2 },
        { account_id: 1632, name: "علي حسين كاظم", balance_m: 33.8 },
      ],
    })
  ),

  // ---- forecast ----
  http.get("/api/forecast", () =>
    HttpResponse.json({
      forecast: [
        {
          year_month: "2026-05",
          base: { in_m: 100.0, out_m: 95.0, net_m: 5.0 },
          opt: { in_m: 108.0, out_m: 93.0, net_m: 15.0 },
          pess: { in_m: 92.0, out_m: 100.0, net_m: -8.0 },
        },
        {
          year_month: "2026-06",
          base: { in_m: 102.0, out_m: 96.0, net_m: 6.0 },
          opt: { in_m: 110.0, out_m: 94.0, net_m: 16.0 },
          pess: { in_m: 94.0, out_m: 101.0, net_m: -7.0 },
        },
      ],
      cash_paths: {
        base: [221.0, 227.0],
        opt: [231.0, 247.0],
        pess: [208.0, 201.0],
      },
      fc_totals: {
        base: { in_m: 202.0, out_m: 191.0, net_m: 11.0, end_cash_m: 227.0, min_cash_m: 221.0 },
        opt: { in_m: 218.0, out_m: 187.0, net_m: 31.0, end_cash_m: 247.0, min_cash_m: 231.0 },
        pess: { in_m: 186.0, out_m: 201.0, net_m: -15.0, end_cash_m: 201.0, min_cash_m: 201.0 },
      },
      scenarios: {
        base: { label: "متحفّظ", in_g: 1.0, out_g: 1.0 },
        opt: { label: "متفائل", in_g: 1.08, out_g: 0.98 },
        pess: { label: "متشائم", in_g: 0.92, out_g: 1.06 },
      },
      mape: 18.0,
      confidence: "عالية",
    })
  ),

  // ---- supplier-plan ----
  http.get("/api/supplier-plan", ({ request }) => {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") || "2026-05";
    return HttpResponse.json({
      month,
      pool_m: 120.0,
      alloc: [
        { id: 1001, name: "معرض البركة", currency: "IQD", allocated_m: 5.0, actual_paid_m: null },
        { id: 4937, name: "شركة الحافظ", currency: "USD", allocated_m: 0.0, actual_paid_m: null },
      ],
      leftover_m: 30.0,
    });
  }),

  // ---- settings ----
  http.get("/api/settings", () =>
    HttpResponse.json({
      display: {
        accent: "أزرق",
        show_alert: true,
        neg_threshold_m: 0,
        over_cap_warn: true,
      },
      assumptions: {
        usd_rate: 1350.0,
        unexpected_reserve_m: 15.0,
        income_growth_pct: null,
        in_growth_factor: null,
        out_growth_factor: null,
        cagr_floor: null,
        cagr_cap: null,
        forecast_horizon: null,
        fiscal_year_start_month: 5,
        forecast_engine: null,
      },
    })
  ),
];
