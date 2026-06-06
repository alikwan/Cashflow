// hooks.test.jsx — Task D1 keystone tests.
//
// Two layers:
//   1. Direct unit tests of the PURE mappers (fast, no network) — assert the
//      trickiest snake_case→component renames, especially the silent traps:
//      sayrafa spelling, aging `current` bucket, installments-from-remaining_m,
//      dollar-supplier allocated_m=0 passthrough, forecast/settings renames.
//   2. Integration tests of each HOOK over the shared MSW server: override a
//      route with a representative response, render the hook, wait for load,
//      then assert the MAPPED output.
//
// Plus a `renderWithProviders` smoke test (authed mount, no /me round-trip).

import { renderHook, waitFor, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server, renderWithProviders } from "./setup";
import { useAuth } from "../src/auth/AuthContext";
import { useToast } from "../src/components/Primitives";
import {
  // generic fetch hook
  useApi,
  // hooks
  useMeta,
  useDashboard,
  useCashflow,
  useBreakdown,
  useSuppliers,
  useInstallments,
  useForecast,
  useSupplierPlan,
  useSettings,
  // pure mappers
  mapMeta,
  mapDashboard,
  mapCashflow,
  mapBreakdown,
  mapSuppliers,
  mapInstallments,
  mapForecast,
  mapSupplierPlan,
  mapSettings,
  // derivation helpers
  monthMeta,
  fyCode,
  fyLabel,
} from "../src/api/hooks";

// Wait until a hook result has finished its first fetch.
async function settle(result) {
  await waitFor(() => expect(result.current.loading).toBe(false));
}

// =====================================================================
//  PART 1 — pure derivation helpers
// =====================================================================

describe("derivation helpers", () => {
  test("fyCode: 2022-2023 → FY22", () => {
    expect(fyCode("2022-2023")).toBe("FY22");
    expect(fyCode("2025-2026")).toBe("FY25");
  });

  test("fyLabel: 2022-2023 → '2022 / 2023'", () => {
    expect(fyLabel("2022-2023")).toBe("2022 / 2023");
  });

  test("monthMeta derives label/short/greg/year/fmPos", () => {
    const m = monthMeta("2026-02", "2025-2026");
    expect(m.greg).toBe(2);
    expect(m.year).toBe(2026);
    expect(m.label).toBe("شباط 2026");
    expect(m.short).toBe("02/26");
    expect(m.fy).toBe("FY25");
    expect(m.fyLabel).toBe("2025 / 2026");
    // fiscal-year starts in May (5) → February is fiscal position 9.
    expect(m.fmPos).toBe(9);
  });

  test("monthMeta: May is fiscal position 0", () => {
    expect(monthMeta("2022-05").fmPos).toBe(0);
  });
});

// =====================================================================
//  PART 2 — pure mapper unit tests (the trickiest renames)
// =====================================================================

describe("mapper unit tests — the silent traps", () => {
  test("mapBreakdown flips API 'siyrafa' → page 'sayrafa' and attaches meta", () => {
    const out = mapBreakdown({
      expense_cats: [
        { key: "siyrafa", total_m: 391, monthly: [{ year_month: "2026-02", amount_m: 32 }] },
      ],
      partners: [{ account_id: 2535, name: "فؤاد كريم", balance_m: 120 }],
      funds: [{ account_id: 181, name: "صندوق", balance_m: 96 }],
    });
    const cat = out.expCats[0];
    expect(cat.key).toBe("sayrafa"); // ← NOT siyrafa
    expect(cat.total).toBe(391);
    expect(cat.monthly[0].value).toBe(32);
    expect(cat.monthly[0].short).toBe("02/26");
    // client-side metadata re-attached by page key
    expect(cat.name).toBe("صيرفة (دينار→دولار)");
    expect(cat.chart).toBe("--chart-3");
    expect(cat.type).toBe("7");
    // partner balance_m → total12; funds balance_m → balance
    expect(out.partners[0].total12).toBe(120);
    expect(out.funds[0].balance).toBe(96);
  });

  test("mapInstallments: total ← remaining_m (≈1260, NOT 4670) and not_due → current", () => {
    const out = mapInstallments({
      summary: {
        premium_count: 8500,
        face_total_m: 7122,
        cash_paid_m: 5650,
        discount_m: 150,
        remaining_m: 1260,
      },
      aging: [
        { bucket_key: "not_due", label: "لم يستحق بعد", amount_m: 890, count: 3120 },
        { bucket_key: "b120", label: "+120 يوم", amount_m: 70, count: 240 },
      ],
      top_debtors: [{ account_id: 1631, name: "مصطفى", balance_m: 41.2 }],
    });
    expect(out.total).toBe(1260); // NOT the discredited 4670
    expect(out.total).not.toBe(4670);
    // not_due bucket renamed to current so the page's find(a=>a.key==='current') works
    const current = out.aging.find((a) => a.key === "current");
    expect(current).toBeTruthy();
    expect(current.amount).toBe(890);
    expect(current.color).toBe("--bucket-0-30");
    // other buckets unchanged
    expect(out.aging.find((a) => a.key === "b120")).toBeTruthy();
    // top debtor balance_m → balance; no mock contract/bucket/due fabricated
    expect(out.topDebtors[0].balance).toBe(41.2);
    expect(out.topDebtors[0]).not.toHaveProperty("contract");
  });

  test("mapSuppliers: currency→cur, over_cap→overCap, balance_m→balance, total12 derived", () => {
    const out = mapSuppliers({
      suppliers: [
        {
          id: 1001,
          name: "معرض البركة",
          cap: 5,
          currency: "IQD",
          monthly: [2, 3, 4],
          over_cap: 1,
          balance_m: 4,
          util: 0.7,
          active: true,
        },
      ],
    });
    const s = out.suppliers[0];
    expect(s.cur).toBe("IQD");
    expect(s.overCap).toBe(1);
    expect(s.balance).toBe(4);
    expect(s.id).toBe(1001); // = account_id
    expect(s.total12).toBe(9); // Σ monthly
  });

  test("mapSupplierPlan: pool/leftover/give renames; USD supplier give === 0 passthrough", () => {
    const out = mapSupplierPlan({
      month: "2026-05",
      pool_m: 120,
      leftover_m: 30,
      alloc: [
        { id: 1001, name: "البركة", currency: "IQD", allocated_m: 5, actual_paid_m: null },
        { id: 4937, name: "الحافظ", currency: "USD", allocated_m: 0, actual_paid_m: null },
      ],
    });
    expect(out.pool).toBe(120);
    expect(out.leftover).toBe(30);
    expect(out.distributed).toBe(90); // pool − leftover
    const usd = out.alloc.find((a) => a.cur === "USD");
    expect(usd.give).toBe(0); // dollar supplier funded via siyrafa (Option-1)
    const iqd = out.alloc.find((a) => a.cur === "IQD");
    expect(iqd.give).toBe(5);
  });

  test("mapForecast: in_m/out_m/net_m→in/out/net, fc_totals→fcTotals, end/min cash, mape+confidence", () => {
    const out = mapForecast({
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
        base: { in_m: 202, out_m: 191, net_m: 11, end_cash_m: 227, min_cash_m: 221 },
        opt: { in_m: 218, out_m: 187, net_m: 31, end_cash_m: 247, min_cash_m: 231 },
        pess: { in_m: 186, out_m: 201, net_m: -15, end_cash_m: 201, min_cash_m: 201 },
      },
      scenarios: {
        base: { label: "متحفّظ", in_g: 1.0, out_g: 1.0 },
        opt: { label: "متفائل", in_g: 1.08, out_g: 0.98 },
        pess: { label: "متشائم", in_g: 0.92, out_g: 1.06 },
      },
      mape: 18,
      confidence: "عالية",
    });
    expect(out.forecast[0].base.in).toBe(100);
    expect(out.forecast[0].pess.net).toBe(-8);
    expect(out.forecast[0].label).toBe("أيار 2026");
    expect(out.fcTotals.base.endCash).toBe(227);
    expect(out.fcTotals.pess.minCash).toBe(201);
    expect(out.cashPaths.opt).toEqual([231]);
    expect(out.scenarios.opt.inG).toBe(1.08);
    expect(out.scenarios.opt.outG).toBe(0.98);
    expect(out.mape).toBe(18);
    expect(out.confidence).toBe("عالية");
  });

  test("mapSettings: snake→camel renames + nullable assumption fallbacks", () => {
    const out = mapSettings({
      display: { accent: "أزرق", show_alert: true, neg_threshold_m: 0, over_cap_warn: true },
      assumptions: {
        usd_rate: 1400,
        unexpected_reserve_m: 20,
        income_growth_pct: null,
        fiscal_year_start_month: 5,
      },
    });
    expect(out.showAlert).toBe(true);
    expect(out.negThreshold).toBe(0);
    expect(out.overCapWarn).toBe(true);
    expect(out.exchangeRate).toBe(1400);
    expect(out.reserve).toBe(20);
    expect(out.fyStart).toBe(5);
    expect(out.incomeGrowth).toBeNull(); // nullable → null (page applies fallback)
  });

  test("mapDashboard: agg keyed by FY code; severity→tone; drawings→partners; siyrafa→sayrafa", () => {
    const out = mapDashboard({
      fy_totals: [{ fiscal_year: "2025-2026", in_m: 1278, out_m: 1247, net_m: 31 }],
      net_decline_pct: 0.51,
      installments: { premium_count: 1, face_total_m: 2, cash_paid_m: 3, discount_m: 4, remaining_m: 1260 },
      alerts: [{ id: 1, alert_type: "x", severity: "danger", title: "t", body: null, related_key: null, status: "new", generated_at: "2026" }],
      monthly_series: [{ year_month: "2026-02", cash_in_m: 120, out_total_comprehensive_m: 134.6, net_total_m: -14.6, cash_running_m: 55.4 }],
      expense_mix: { out_suppliers_m: 1, out_drawings_m: 2, out_refunds_m: 3, out_purchases_m: 4, out_salaries_m: 5, out_siyrafa_m: 6, out_other_m: 7 },
    });
    expect(out.agg.FY25).toEqual({ in: 1278, out: 1247, net: 31 });
    expect(out.netDecline).toBe(0.51);
    expect(out.installments.remainingM).toBe(1260);
    expect(out.alerts[0].tone).toBe("danger"); // severity → tone
    expect(out.monthlySeries[0].out).toBe(134.6); // comprehensive OUT
    expect(out.monthlySeries[0].short).toBe("02/26");
    expect(out.expenseMix.partners).toBe(2); // out_drawings_m → partners
    expect(out.expenseMix.sayrafa).toBe(6); // out_siyrafa_m → sayrafa
  });

  test("mappers tolerate empty/partial payloads (no crash, empty lists)", () => {
    expect(mapInstallments({ summary: null, aging: [], top_debtors: [] }).total).toBe(0);
    expect(mapBreakdown({}).expCats).toEqual([]);
    expect(mapSuppliers({}).suppliers).toEqual([]);
    expect(mapDashboard({}).alerts).toEqual([]);
    expect(mapMeta({ last_etl: null }).lastEtl).toBeNull();
  });
});

// =====================================================================
//  PART 3 — hook integration tests (over the shared MSW server)
// =====================================================================

describe("useMeta", () => {
  test("maps usd_rate → exchangeRate/USD_RATE and current_cash_m → CURRENT_CASH", async () => {
    const { result } = renderHook(() => useMeta());
    await settle(result);
    expect(result.current.error).toBeNull();
    expect(result.current.data.exchangeRate).toBe(1350);
    expect(result.current.data.USD_RATE).toBe(1350);
    expect(result.current.data.CURRENT_CASH).toBe(216);
    expect(result.current.data.RESERVE_M).toBe(15);
    expect(result.current.data.fyStart).toBe(5);
    expect(result.current.data.lastEtl.finishedAt).toBe("2026-06-05T01:02:00");
  });
});

describe("useDashboard", () => {
  test("maps fy_totals, installments (remaining_m), alerts (tone), expense_mix (sayrafa)", async () => {
    const { result } = renderHook(() => useDashboard());
    await settle(result);
    const d = result.current.data;
    expect(d.agg.FY25.net).toBe(31);
    expect(d.installments.remainingM).toBe(1260);
    expect(d.alerts[0].tone).toBe("danger");
    expect(d.expenseMix.sayrafa).toBe(391); // from out_siyrafa_m
    expect(d.expenseMix.partners).toBe(540); // from out_drawings_m
  });
});

describe("useCashflow", () => {
  test("maps months/forecast/byFiscalYear with perspective param", async () => {
    const { result } = renderHook(() => useCashflow());
    await settle(result);
    const c = result.current.data;
    expect(c.months[1].out).toBe(134.6); // out_total_m (perspective-aware)
    expect(c.months[1].net).toBe(-14.6);
    expect(c.months[1].fy).toBe("FY25");
    expect(c.months[1].label).toBe("شباط 2026");
    expect(c.forecast[0].base.in).toBe(100);
    expect(c.byFiscalYear[0].in).toBe(1278);
  });

  test("passes the perspective query param through", async () => {
    let seenPerspective = null;
    server.use(
      http.get("/api/cashflow/monthly", ({ request }) => {
        seenPerspective = new URL(request.url).searchParams.get("perspective");
        return HttpResponse.json({ months: [], forecast: [], by_fiscal_year: [] });
      })
    );
    const { result } = renderHook(() => useCashflow("operational"));
    await settle(result);
    expect(seenPerspective).toBe("operational");
  });
});

describe("useBreakdown", () => {
  test("flips siyrafa→sayrafa and exposes partners/funds", async () => {
    const { result } = renderHook(() => useBreakdown());
    await settle(result);
    const b = result.current.data;
    const sayrafa = b.expCats.find((c) => c.key === "sayrafa");
    expect(sayrafa).toBeTruthy();
    expect(b.expCats.find((c) => c.key === "siyrafa")).toBeUndefined();
    expect(sayrafa.total).toBe(391);
    expect(b.partners[0].total12).toBe(120);
    expect(b.funds[0].balance).toBe(96);
  });
});

describe("useSuppliers", () => {
  test("maps currency→cur, over_cap→overCap, derives total12", async () => {
    const { result } = renderHook(() => useSuppliers());
    await settle(result);
    const s = result.current.data.suppliers;
    expect(s[0].cur).toBe("IQD");
    expect(s[0].overCap).toBe(1);
    expect(s[0].total12).toBeCloseTo(8.1); // 2.8+2.2+3.1
    const usd = s.find((x) => x.cur === "USD");
    expect(usd.cur).toBe("USD");
    expect(usd.balance).toBe(54000);
  });
});

describe("useInstallments", () => {
  test("outstanding from remaining_m; aging has a 'current' bucket; no fabricated debtor fields", async () => {
    const { result } = renderHook(() => useInstallments());
    await settle(result);
    const i = result.current.data;
    expect(i.total).toBe(1260);
    expect(i.aging.find((a) => a.key === "current")).toBeTruthy();
    expect(i.aging.find((a) => a.key === "not_due")).toBeUndefined();
    expect(i.topDebtors[0]).not.toHaveProperty("contract");
  });
});

describe("useForecast", () => {
  test("maps scenarios/totals and surfaces mape + confidence", async () => {
    const { result } = renderHook(() => useForecast());
    await settle(result);
    const f = result.current.data;
    expect(f.forecast[0].base.in).toBe(100);
    expect(f.fcTotals.base.endCash).toBe(227);
    expect(f.scenarios.opt.inG).toBe(1.08);
    expect(f.mape).toBe(18);
    expect(f.confidence).toBe("عالية");
  });

  test("omits scenario_id when null; sends it when provided", async () => {
    let seen;
    server.use(
      http.get("/api/forecast", ({ request }) => {
        seen = new URL(request.url).searchParams.get("scenario_id");
        return HttpResponse.json({
          forecast: [], cash_paths: {}, fc_totals: {}, scenarios: {}, mape: null, confidence: null,
        });
      })
    );
    const a = renderHook(() => useForecast(null));
    await settle(a.result);
    expect(seen).toBeNull(); // omitted

    const b = renderHook(() => useForecast(7));
    await settle(b.result);
    expect(seen).toBe("7");
  });
});

describe("useSupplierPlan", () => {
  test("requires a month; maps pool/leftover/give; USD give===0", async () => {
    const { result } = renderHook(() => useSupplierPlan("2026-05"));
    await settle(result);
    const p = result.current.data;
    expect(p.month).toBe("2026-05");
    expect(p.pool).toBe(120);
    expect(p.leftover).toBe(30);
    expect(p.distributed).toBe(90);
    expect(p.alloc.find((a) => a.cur === "USD").give).toBe(0);
  });

  test("disabled (no fetch, no error) until a valid month is supplied", async () => {
    let called = false;
    server.use(
      http.get("/api/supplier-plan", () => {
        called = true;
        return HttpResponse.json({ month: "x", pool_m: 0, leftover_m: 0, alloc: [] });
      })
    );
    const { result } = renderHook(() => useSupplierPlan(undefined));
    // Disabled → not loading, no data, no error, and the endpoint is never hit.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(called).toBe(false);
  });
});

describe("useSettings", () => {
  test("maps display + assumptions renames", async () => {
    const { result } = renderHook(() => useSettings());
    await settle(result);
    const s = result.current.data;
    expect(s.negThreshold).toBe(0);
    expect(s.overCapWarn).toBe(true);
    expect(s.exchangeRate).toBe(1350);
    expect(s.reserve).toBe(15);
    expect(s.fyStart).toBe(5);
  });
});

// =====================================================================
//  PART 4 — useApi error propagation
// =====================================================================

describe("useApi error handling", () => {
  test("surfaces an ApiError on a non-2xx response", async () => {
    server.use(
      http.get("/api/meta", () =>
        HttpResponse.json({ error: { code: "internal_server_error", message: "خطأ" } }, { status: 500 })
      )
    );
    const { result } = renderHook(() => useMeta());
    await settle(result);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeTruthy();
    expect(result.current.error.status).toBe(500);
    expect(result.current.error.error.code).toBe("internal_server_error");
  });
});

// =====================================================================
//  PART 4b — mapped() memoization + enabled:false error clearing
// =====================================================================

describe("mapped() memoization (I1)", () => {
  test("data keeps a STABLE reference across a re-render that doesn't change raw", async () => {
    // useMeta serves a fixed payload from the shared MSW server, so `raw` is
    // referentially stable after the first fetch. A rerender that changes
    // nothing must NOT produce a new mapped object.
    const { result, rerender } = renderHook(() => useMeta());
    await settle(result);
    expect(result.current.error).toBeNull();

    const before = result.current.data;
    expect(before).toBeTruthy();

    rerender();
    const after = result.current.data;

    expect(Object.is(before, after)).toBe(true);
  });
});

describe("useApi enabled:false clears stale error (M1)", () => {
  test("a hook that errors, then is re-rendered disabled, exposes error === null", async () => {
    // First request fails (500) → error populated. Then flip `enabled` to false:
    // the disabled branch must clear the prior error (no phantom error).
    server.use(
      http.get("/api/meta", () =>
        HttpResponse.json(
          { error: { code: "internal_server_error", message: "خطأ" } },
          { status: 500 }
        )
      )
    );

    const { result, rerender } = renderHook(
      ({ enabled }) => useApi("/api/meta", { enabled }),
      { initialProps: { enabled: true } }
    );

    // Wait for the failed fetch to settle with an error.
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error.status).toBe(500);

    // Disable the query → stale error must be cleared.
    rerender({ enabled: false });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
  });
});

// =====================================================================
//  PART 5 — renderWithProviders smoke test
// =====================================================================

describe("renderWithProviders", () => {
  test("mounts AUTHED (Auth + Toast) without hitting /api/auth/me", async () => {
    let meCalled = false;
    server.use(
      http.get("/api/auth/me", () => {
        meCalled = true;
        return HttpResponse.json({ error: { code: "x", message: "should not be called" } }, { status: 500 });
      })
    );

    function Probe() {
      const { user } = useAuth(); // throws if no AuthProvider
      const { showToast } = useToast(); // throws if no ToastProvider
      return (
        <div>
          <span data-testid="who">{user ? user.display_name : "none"}</span>
          <button onClick={() => showToast("hi")}>toast</button>
        </div>
      );
    }

    renderWithProviders(<Probe />);
    // Seeded authed synchronously with the default owner user.
    expect(screen.getByTestId("who")).toHaveTextContent("علي");
    // Give any unwanted boot fetch a chance to fire, then prove it never did.
    await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("علي"));
    expect(meCalled).toBe(false);
  });

  test("can render explicitly logged out (user: null) without a fetch", () => {
    function Probe() {
      const { user } = useAuth();
      return <span data-testid="who">{user ? user.display_name : "none"}</span>;
    }
    renderWithProviders(<Probe />, { user: null });
    expect(screen.getByTestId("who")).toHaveTextContent("none");
  });
});
