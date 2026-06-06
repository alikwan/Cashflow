// api/hooks.js — the data layer that REPLACES the old global `window.DATA`
// (design-reference `data.js`). This is Task D1, the keystone of the React port.
//
// What this file does:
//   1. `useApi(path, {params, enabled})` — a tiny generic fetch hook over the
//      `api` client (cookie-based, AbortController-cancelled, no-setState-after-
//      unmount). Returns `{data, loading, error, refetch}`.
//   2. Nine domain hooks (`useMeta`, `useDashboard`, `useCashflow`, …) each =
//      `useApi(endpoint, params)` piped through a PURE mapper.
//   3. The PURE mappers (`mapMeta`, `mapDashboard`, …) — the snake_case(API) →
//      camelCase/nested(component) transform. Exported so they can be unit-tested
//      directly. This mapping layer is the whole point: it bridges the API field
//      names to the EXACT field names the ported page components already read
//      (see `cashflow-web/docs/discovery/06-hook-output-contract.md`).
//
// MONEY: everything is already in millions (the API's `_m` suffix). The mappers
// only RENAME — no unit conversion.
//
// The mappers are defensive: every list defaults to `[]`, every nested object is
// guarded, so a partial/empty API payload (early DB) never crashes a page's
// `.find()`/`.reduce()`. The hooks return `data: null` until the first fetch
// resolves; the mapper only runs on a non-null raw payload.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./client";

// =====================================================================
//  Client-side constants (NO API source — copied from data.js).
//  The API deliberately omits display metadata (Arabic names, chart-color
//  tokens, AccountTypeId strings, bucket colors). The mapping layer re-attaches
//  them so the ported pages render identically.
// =====================================================================

// Gregorian-month → Arabic month name (index 1..12). The fiscal-position table
// in data.js (`FM_NAMES`, mayʼ=0) is reindexed here BY GREGORIAN MONTH because
// the page-facing `label` is keyed by the gregorian month, not the fiscal slot.
const AR_MONTH_BY_GREG = {
  1: "كانون الثاني",
  2: "شباط",
  3: "آذار",
  4: "نيسان",
  5: "أيار",
  6: "حزيران",
  7: "تموز",
  8: "آب",
  9: "أيلول",
  10: "تشرين الأول",
  11: "تشرين الثاني",
  12: "كانون الأول",
};

// Expense-category display metadata, keyed by the PAGE key (`sayrafa`, not the
// API spelling `siyrafa`). Order matches data.js EXP_CATS.
export const EXP_CATS_META = {
  partners: { name: "سحوبات شركاء", type: "2518", chart: "--chart-5" },
  sayrafa: { name: "صيرفة (دينار→دولار)", type: "7", chart: "--chart-3" },
  suppliers: { name: "مدفوعات الموردين", type: "2614", chart: "--chart-1" },
  purchases: { name: "مشتريات مباشرة", type: "3110", chart: "--chart-6" },
  salaries: { name: "أجور العاملين", type: "3121", chart: "--chart-4" },
  refunds: { name: "مرتجعات وأخرى", type: "1631", chart: "--chart-7" },
};

// Aging-bucket color tokens, keyed by the PAGE bucket key (`current`, not the
// API `not_due`). Copied from data.js AGING.
export const AGING_COLORS = {
  current: "--bucket-0-30",
  b0_30: "--bucket-31-60",
  b31_60: "--bucket-61-90",
  b61_90: "--bucket-91-120",
  b91_120: "#EA580C",
  b120: "--bucket-120-plus",
};

// Per-scenario chart-color token. NOT in the API. Copied from data.js SCENARIOS.
export const SCENARIO_CHART = {
  base: "--chart-1",
  opt: "--chart-2",
  pess: "--chart-5",
};

// Default fiscal-year-start month (May) used when deriving fy / fmPos and no
// override is supplied. Mirrors the system's `fy_start = 5`.
const DEFAULT_FY_START = 5;

// =====================================================================
//  Pure derivation helpers (month labels, fiscal-year codes).
//  The API gives only `year_month` ("YYYY-MM") + `fiscal_year` ("2022-2023").
//  The pages read `label`/`short`/`greg`/`year`/`fy`/`fyLabel`/`fmPos`.
// =====================================================================

/**
 * Derive the page's per-month display fields from `year_month`.
 * @param {string} yearMonth  "YYYY-MM"
 * @param {string} [fiscalYear]  "2022-2023" (optional; enables fy/fyLabel/fmPos)
 * @param {number} [fyStart]  fiscal-year start month (default 5 = May)
 * @returns {{yearMonth, greg, year, label, short, fy, fyLabel, fmPos}}
 */
export function monthMeta(yearMonth, fiscalYear, fyStart = DEFAULT_FY_START) {
  const [yStr, mStr] = String(yearMonth || "").split("-");
  const year = Number(yStr);
  const greg = Number(mStr);
  const label = `${AR_MONTH_BY_GREG[greg] || mStr || ""} ${year || ""}`.trim();
  const short = `${String(greg).padStart(2, "0")}/${String(year).slice(2)}`;
  // Fiscal-month position 0..11 (start month → 0). e.g. fyStart=5: May→0, Apr→11.
  const fmPos = Number.isFinite(greg) ? (greg - fyStart + 12) % 12 : null;
  return {
    yearMonth,
    greg,
    year,
    label,
    short,
    fy: fiscalYear ? fyCode(fiscalYear) : undefined,
    fyLabel: fiscalYear ? fyLabel(fiscalYear) : undefined,
    fmPos,
  };
}

/** "2022-2023" → "FY22" (start year's last two digits, FY-prefixed). */
export function fyCode(fiscalYear) {
  const start = String(fiscalYear || "").split("-")[0];
  if (!start || start.length < 4) return String(fiscalYear || "");
  return "FY" + start.slice(2);
}

/** "2022-2023" → "2022 / 2023" (the page's tab/agg label). */
export function fyLabel(fiscalYear) {
  const parts = String(fiscalYear || "").split("-");
  if (parts.length !== 2) return String(fiscalYear || "");
  return `${parts[0]} / ${parts[1]}`;
}

// Severity → tone vocabulary normalization for alerts. The page's alertStyle()
// expects danger|warning|info. Map known API values; fall back to info.
function toneOf(severity) {
  const s = String(severity || "").toLowerCase();
  if (s === "danger" || s === "critical" || s === "high") return "danger";
  if (s === "warning" || s === "warn" || s === "medium") return "warning";
  if (s === "info" || s === "low") return "info";
  return "info";
}

// Safe array helper — always returns an array (guards null/undefined/non-array).
const arr = (x) => (Array.isArray(x) ? x : []);

// =====================================================================
//  Generic fetch hook
// =====================================================================

/**
 * Fetch `path` (with `params`) through the api client. Re-fetches whenever the
 * path or any param value changes. Cancels in-flight requests on unmount / param
 * change via an AbortController. Never setStates after unmount.
 *
 * @returns {{data:*, loading:boolean, error:Error|null, refetch:()=>void}}
 */
export function useApi(path, { params, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);
  // Bump to force a refetch without changing path/params.
  const [nonce, setNonce] = useState(0);

  // Track mounted state so async resolutions never setState after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  // Serialize params for the dependency array (stable across renders for equal
  // shapes). `params` is small; JSON.stringify is fine.
  const paramsKey = JSON.stringify(params ?? null);

  useEffect(() => {
    if (!enabled) {
      // Dependent query disabled → nothing in flight, not loading. Also clear any
      // prior error so a hook that becomes disabled after a failure doesn't
      // surface a phantom error. (Leave `data` as-is to avoid a flash.)
      if (mountedRef.current) {
        setLoading(false);
        setError(null);
      }
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await api.get(path, { params, signal: controller.signal });
        if (!mountedRef.current || controller.signal.aborted) return;
        setData(res);
      } catch (err) {
        // Intentional cancellation (unmount / param change) → ignore silently.
        if (err && err.name === "AbortError") return;
        if (!mountedRef.current || controller.signal.aborted) return;
        setError(err);
      } finally {
        if (mountedRef.current && !controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
    // `paramsKey` captures param-value changes; `params` itself is intentionally
    // omitted (it would be a new reference each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, paramsKey, enabled, nonce]);

  return { data, loading, error, refetch };
}

// Wrap a useApi result: run the pure mapper only on a non-null raw payload.
// Memoizes on `raw` (and `mapper`) so the mapped object keeps a stable reference
// across renders that don't change `raw` — preserving downstream useMemo/chart
// memoization in the consuming pages. `mapped()` is only ever called from inside
// the domain hooks, so the useMemo here obeys the rules of hooks (it's a custom
// hook in all but name). `raw` is referentially stable between fetches.
function mapped(raw, loading, error, refetch, mapper) {
  const data = useMemo(() => (raw ? mapper(raw) : null), [raw, mapper]);
  return { data, loading, error, refetch };
}

// =====================================================================
//  1. useMeta — global constants + exchange rate (Shell + most pages)
// =====================================================================

export function mapMeta(raw) {
  const m = raw || {};
  const e = m.last_etl || null;
  return {
    USD_RATE: m.usd_rate,
    exchangeRate: m.usd_rate, // Shell/Header & Suppliers read this name.
    CURRENT_CASH: m.current_cash_m,
    RESERVE_M: m.reserve_m,
    fyStart: m.fy_start,
    lastEtl: e
      ? {
          status: e.status,
          finishedAt: e.finished_at ?? null,
          rowsLoaded: e.rows_loaded,
          reconciliationResidualM: e.reconciliation_residual_m ?? null,
        }
      : null,
  };
}

export function useMeta() {
  const { data, loading, error, refetch } = useApi("/api/meta");
  return mapped(data, loading, error, refetch, mapMeta);
}

// =====================================================================
//  2. useDashboard — Dashboard page
// =====================================================================

export function mapDashboard(raw) {
  const d = raw || {};
  const fyTotals = arr(d.fy_totals).map((f) => ({
    fiscalYear: f.fiscal_year,
    in: f.in_m,
    out: f.out_m,
    net: f.net_m,
  }));
  // Keyed agg (FY22..FY25) for the page's D.agg.FYxx reads.
  const agg = {};
  for (const f of fyTotals) {
    agg[fyCode(f.fiscalYear)] = { in: f.in, out: f.out, net: f.net };
  }

  const inst = d.installments || null;
  const mix = d.expense_mix || {};

  return {
    agg,
    fyTotals,
    netDecline: d.net_decline_pct,
    installments: inst
      ? {
          premiumCount: inst.premium_count,
          faceTotalM: inst.face_total_m,
          cashPaidM: inst.cash_paid_m,
          discountM: inst.discount_m,
          remainingM: inst.remaining_m,
        }
      : null,
    alerts: arr(d.alerts).map((a) => ({
      id: a.id,
      tone: toneOf(a.severity),
      title: a.title,
      body: a.body ?? null,
      alertType: a.alert_type,
      relatedKey: a.related_key ?? null,
      status: a.status,
      generatedAt: a.generated_at,
    })),
    monthlySeries: arr(d.monthly_series).map((r) => ({
      yearMonth: r.year_month,
      in: r.cash_in_m,
      out: r.out_total_comprehensive_m, // dashboard OUT is always comprehensive
      net: r.net_total_m,
      cash: r.cash_running_m,
      ...monthMeta(r.year_month),
    })),
    expenseMix: {
      suppliers: mix.out_suppliers_m,
      partners: mix.out_drawings_m, // drawings → partners
      sayrafa: mix.out_siyrafa_m, // ⚠ API siyrafa → page sayrafa
      purchases: mix.out_purchases_m,
      salaries: mix.out_salaries_m,
      refunds: mix.out_refunds_m,
      other: mix.out_other_m,
    },
  };
}

export function useDashboard() {
  const { data, loading, error, refetch } = useApi("/api/dashboard");
  return mapped(data, loading, error, refetch, mapDashboard);
}

// =====================================================================
//  3. useCashflow — MonthlyFlow page (+ Dashboard chart history)
// =====================================================================

export function mapCashflow(raw) {
  const c = raw || {};
  return {
    months: arr(c.months).map((m) => ({
      in: m.cash_in_m,
      out: m.out_total_m, // PERSPECTIVE-AWARE here
      net: m.net_total_m,
      cash: m.cash_running_m,
      ...monthMeta(m.year_month, m.fiscal_year),
    })),
    forecast: arr(c.forecast).map((f) => ({
      base: {
        in: f.cash_in_m,
        out: f.out_total_m,
        net: f.net_total_m,
      },
      ...monthMeta(f.year_month),
    })),
    byFiscalYear: arr(c.by_fiscal_year).map((y) => ({
      fiscalYear: y.fiscal_year,
      in: y.in_m,
      out: y.out_m,
      net: y.net_m,
    })),
  };
}

export function useCashflow(perspective = "comprehensive") {
  const { data, loading, error, refetch } = useApi("/api/cashflow/monthly", {
    params: { perspective },
  });
  return mapped(data, loading, error, refetch, mapCashflow);
}

// =====================================================================
//  4. useBreakdown — Breakdown page (+ Dashboard expense donut)
// =====================================================================

export function mapBreakdown(raw) {
  const b = raw || {};
  return {
    expCats: arr(b.expense_cats).map((c) => {
      // Normalize the API spelling `siyrafa` → page key `sayrafa`.
      const key = c.key === "siyrafa" ? "sayrafa" : c.key;
      const meta = EXP_CATS_META[key] || {};
      return {
        key,
        total: c.total_m,
        monthly: arr(c.monthly).map((mm) => ({
          yearMonth: mm.year_month,
          value: mm.amount_m,
          short: monthMeta(mm.year_month).short,
        })),
        name: meta.name,
        chart: meta.chart,
        type: meta.type,
      };
    }),
    partners: arr(b.partners).map((p) => ({
      name: p.name,
      total12: p.balance_m, // (semantics differ — see contract §17.8)
      accountId: p.account_id,
    })),
    funds: arr(b.funds).map((f) => ({
      name: f.name,
      balance: f.balance_m,
      accountId: f.account_id,
    })),
  };
}

export function useBreakdown() {
  const { data, loading, error, refetch } = useApi("/api/breakdown");
  return mapped(data, loading, error, refetch, mapBreakdown);
}

// =====================================================================
//  5. useSuppliers — Suppliers page (+ Settings caps editor + Shell search)
// =====================================================================

export function mapSuppliers(raw) {
  const s = raw || {};
  return {
    suppliers: arr(s.suppliers).map((sup) => {
      const monthly = arr(sup.monthly);
      const total12 = monthly.reduce((a, v) => a + (v || 0), 0);
      return {
        id: sup.id, // = account_id (matches data.js s.id)
        name: sup.name,
        cap: sup.cap,
        cur: sup.currency, // ⚠ currency → cur
        monthly,
        overCap: sup.over_cap, // ⚠ over_cap → overCap
        balance: sup.balance_m, // ⚠ balance_m → balance
        util: sup.util ?? null,
        active: sup.active,
        total12, // (derive) Σ monthly — API has no total12
        avg: monthly.length ? total12 / monthly.length : 0,
      };
    }),
  };
}

export function useSuppliers() {
  const { data, loading, error, refetch } = useApi("/api/suppliers");
  return mapped(data, loading, error, refetch, mapSuppliers);
}

// =====================================================================
//  6. useInstallments — Installments page
// =====================================================================

export function mapInstallments(raw) {
  const i = raw || {};
  const summary = i.summary || null;
  return {
    // ⚠ outstanding = summary.remaining_m (≈1260, NOT the discredited 4670).
    total: summary ? summary.remaining_m : 0,
    summary: summary
      ? {
          premiumCount: summary.premium_count,
          faceTotalM: summary.face_total_m,
          cashPaidM: summary.cash_paid_m,
          discountM: summary.discount_m,
          remainingM: summary.remaining_m,
        }
      : null,
    aging: arr(i.aging).map((a) => {
      // ⚠ bucket VALUE not_due → current; bucket_key → key.
      const key = a.bucket_key === "not_due" ? "current" : a.bucket_key;
      return {
        key,
        label: a.label,
        amount: a.amount_m, // ⚠ amount_m → amount
        count: a.count,
        color: AGING_COLORS[key], // client-side token
      };
    }),
    topDebtors: arr(i.top_debtors).map((d) => ({
      name: d.name,
      balance: d.balance_m,
      accountId: d.account_id,
      // contract/bucket/due have NO API source (data.js mock-only) — omitted.
    })),
  };
}

export function useInstallments() {
  const { data, loading, error, refetch } = useApi("/api/installments");
  return mapped(data, loading, error, refetch, mapInstallments);
}

// =====================================================================
//  7. useForecast — Forecast page (+ Dashboard/MonthlyFlow forecast tail)
// =====================================================================

// Map a {in_m,out_m,net_m} triple → {in,out,net}.
function triple(t) {
  const x = t || {};
  return { in: x.in_m, out: x.out_m, net: x.net_m };
}
// Map a fc_totals scenario block → {in,out,net,endCash,minCash}.
function fcTotal(t) {
  const x = t || {};
  return {
    in: x.in_m,
    out: x.out_m,
    net: x.net_m,
    endCash: x.end_cash_m,
    minCash: x.min_cash_m,
  };
}

export function mapForecast(raw) {
  const f = raw || {};
  const fc = f.fc_totals || {};
  const sc = f.scenarios || {};
  const mapScenario = (s) => {
    const x = s || {};
    return { label: x.label, inG: x.in_g, outG: x.out_g };
  };
  return {
    forecast: arr(f.forecast).map((row) => ({
      base: triple(row.base),
      opt: triple(row.opt),
      pess: triple(row.pess),
      ...monthMeta(row.year_month),
    })),
    cashPaths: {
      base: arr((f.cash_paths || {}).base),
      opt: arr((f.cash_paths || {}).opt),
      pess: arr((f.cash_paths || {}).pess),
    },
    fcTotals: {
      base: fcTotal(fc.base),
      opt: fcTotal(fc.opt),
      pess: fcTotal(fc.pess),
    },
    scenarios: {
      base: mapScenario(sc.base),
      opt: mapScenario(sc.opt),
      pess: mapScenario(sc.pess),
    },
    mape: f.mape ?? null,
    confidence: f.confidence ?? null,
  };
}

export function useForecast(scenarioId) {
  // Omit the param entirely when scenarioId is null/undefined (the client drops
  // null/undefined params, so passing it through is also safe).
  const params =
    scenarioId === null || scenarioId === undefined
      ? undefined
      : { scenario_id: scenarioId };
  const { data, loading, error, refetch } = useApi("/api/forecast", { params });
  return mapped(data, loading, error, refetch, mapForecast);
}

// =====================================================================
//  8. useSupplierPlan — SupplierPlan page (per month)
// =====================================================================

export function mapSupplierPlan(raw) {
  const p = raw || {};
  const pool = p.pool_m;
  const leftover = p.leftover_m;
  return {
    month: p.month,
    pool, // ⚠ pool_m → pool
    leftover, // ⚠ leftover_m → leftover
    alloc: arr(p.alloc).map((a) => ({
      id: a.id, // = account_id
      name: a.name,
      cur: a.currency, // ⚠ currency → cur ("USD" rows carry give=0)
      give: a.allocated_m, // ⚠ allocated_m → give (USD suppliers = 0, Option-1)
      actualPaid: a.actual_paid_m ?? null,
      // cap/want/capped have NO API source — joined/derived in the page.
    })),
    // distributed is NOT returned by the API — derive.
    distributed:
      typeof pool === "number" && typeof leftover === "number"
        ? pool - leftover
        : undefined,
  };
}

export function useSupplierPlan(month, scenarioId) {
  // `month` is REQUIRED by the API (422 otherwise). Disable the fetch until a
  // valid month is present so the hook can be mounted before a month is chosen.
  const enabled = Boolean(month);
  const params = { month };
  if (scenarioId !== null && scenarioId !== undefined) {
    params.scenario_id = scenarioId;
  }
  const { data, loading, error, refetch } = useApi("/api/supplier-plan", {
    params,
    enabled,
  });
  return mapped(data, loading, error, refetch, mapSupplierPlan);
}

/**
 * Fetch the supplier-plan for an ARRAY of months in parallel (Task D3).
 *
 * The SupplierPlan page needs ALL 12 forecast months at once — the 12-month
 * stacked chart plots `alloc[].give` per supplier per month, and the user can
 * jump between months without a refetch. The API is strictly per-month
 * (`GET /api/supplier-plan?month=YYYY-MM`), so this hook fans out one request
 * per month via `Promise.all` in a single effect, then maps each through the
 * shared `mapSupplierPlan`. The result is the array of per-month mapped objects
 * (in the SAME order as the input `months`).
 *
 * Consistency with `useApi`:
 *   - One `AbortController` cancels ALL in-flight requests on unmount / when the
 *     month set or scenario changes (so a stale batch never lands).
 *   - Never setStates after unmount (mountedRef guard).
 *   - Disabled (returns `{data:[], loading:false, error:null}`) until at least
 *     one valid month is present — mirrors `useSupplierPlan`'s `enabled` gate.
 *
 * @param {string[]} months   array of "YYYY-MM" (e.g. from useForecast().forecast[].yearMonth)
 * @param {number} [scenarioId]
 * @returns {{data: object[], loading: boolean, error: Error|null, refetch: ()=>void}}
 */
export function useSupplierPlanSeries(months, scenarioId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  // Stable list of valid month keys (drops falsy entries). Serialized for the
  // dependency array so equal month sets don't retrigger.
  const validMonths = arr(months).filter(Boolean);
  const monthsKey = JSON.stringify(validMonths);
  const scenKey =
    scenarioId === null || scenarioId === undefined ? null : scenarioId;

  useEffect(() => {
    const list = JSON.parse(monthsKey);
    if (!list.length) {
      // Nothing to fetch yet (forecast months not loaded) — idle, not loading.
      if (mountedRef.current) {
        setLoading(false);
        setError(null);
        setData([]);
      }
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const raws = await Promise.all(
          list.map((month) => {
            const params = { month };
            if (scenKey !== null && scenKey !== undefined) {
              params.scenario_id = scenKey;
            }
            return api.get("/api/supplier-plan", {
              params,
              signal: controller.signal,
            });
          })
        );
        if (!mountedRef.current || controller.signal.aborted) return;
        setData(raws.map(mapSupplierPlan));
      } catch (err) {
        if (err && err.name === "AbortError") return;
        if (!mountedRef.current || controller.signal.aborted) return;
        setError(err);
      } finally {
        if (mountedRef.current && !controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsKey, scenKey, nonce]);

  return { data, loading, error, refetch };
}

// =====================================================================
//  9. useSettings — Settings page (+ App-level prop source for all pages)
// =====================================================================

export function mapSettings(raw) {
  const s = raw || {};
  const disp = s.display || {};
  const asm = s.assumptions || {};
  return {
    // display
    accent: disp.accent,
    showAlert: disp.show_alert,
    negThreshold: disp.neg_threshold_m,
    overCapWarn: disp.over_cap_warn,
    // assumptions (editable copies of the meta globals; nullable → page applies
    // fallbacks against useMeta at the App level)
    exchangeRate: asm.usd_rate ?? null,
    reserve: asm.unexpected_reserve_m ?? null,
    fyStart: asm.fiscal_year_start_month ?? null,
    incomeGrowth: asm.income_growth_pct ?? null,
    // caps map has NO single API field — seeded from useSuppliers at the App
    // level; empty here.
    caps: {},
  };
}

export function useSettings() {
  const { data, loading, error, refetch } = useApi("/api/settings");
  return mapped(data, loading, error, refetch, mapSettings);
}
