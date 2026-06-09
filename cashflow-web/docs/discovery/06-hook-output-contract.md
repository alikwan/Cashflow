# 06 — Per-Hook Output Contract (`src/api/hooks.js` — Task D1)

> **Purpose:** the keystone mapping for the whole frontend. For each of the **9 hooks** that
> replace the old global `window.DATA`, this fixes (1) the endpoint(s) it calls, (2) which
> page(s) consume it and the exact fields read, (3) the **output shape** the hook must return —
> using the COMPONENT field names the pages already read, each annotated with the SOURCE API
> field, (4) every rename/gotcha, and (5) what the page derives itself vs. what the hook must supply.
>
> **Read alongside:**
> - `design-reference/project/src/data.js` — the old `window.DATA` target shapes.
> - `cashflow-web/docs/discovery/05-api-response-shapes.md` — the snake_case SOURCE shapes (§17 = mapping notes).
> - The 8 page components + `Shell.jsx` in `design-reference/project/src/`.
>
> **Money:** everything is already in **millions of dinars (M)**. The API uses `_m` suffixes; the
> pages drop them. No unit conversion — only renames. All API money fields are JSON `float`.
>
> **Conventions in the skeletons below:**
> - `// ← API foo_bar` means "this component field maps from the API field `foo_bar`".
> - `// (derive)` = the hook (or page) computes it locally; not a raw API field.
> - `// (client-side)` = a static/display constant kept in the frontend (chart-color tokens, names) — NOT from the API.
> - `// (NO API source)` = the page reads a field that has no clean API origin — flagged for D1/D2/D3.

---

## Cross-cutting decisions (apply to ALL hooks)

1. **The pages read `window.DATA`.** D1's hooks return a sub-object; the page port (D2/D3) replaces
   `const D = window.DATA` with `const D = useXxx()` (or destructures). So **each hook output must
   carry the field NAMES the pages already use** (e.g. `m.in`, `s.overCap`, `fcTotals.base.endCash`).
   That is the whole point of this document.

2. **`fmt` helpers stay client-side.** `D.fmt.{fmtInt,fmtM,unitM,fmtFull,fmtUSD,fmtPct}` are pure
   formatters defined in `data.js`. They have **no API source** — port them into a shared
   `src/format.js` (or keep on `window`). Hooks do NOT supply `fmt`.

3. **Month label/short derivation.** The API only gives `year_month` (`"YYYY-MM"`) + `fiscal_year`
   (`"2022-2023"`). The pages read `m.label` (Arabic `"شباط 2026"`), `m.short` (`"02/26"`),
   `m.greg` (gregorian month int), `m.year`, `m.fy` (`"FY25"`), `m.fmPos`. **None of these exist in
   the API.** A shared helper `monthMeta(year_month, fiscal_year)` must derive them from `year_month`
   (greg = month part; year = year part; short = `MM/YY`; label = `FM_NAMES_by_greg[greg] + year`;
   `fy`/`fmPos` from `fiscal_year` + fiscal-year-start). Put this in the hook layer so pages get
   `label`/`short`/`greg` ready. `FM_NAMES` and the greg→Arabic-name table are **client-side constants**
   (copy from `data.js` lines 43–44; note `FM_NAMES` is indexed by fiscal-month position, but the
   page-facing label is by gregorian month — keep a greg-indexed name table).

4. **`id` duality.** In `suppliers[]`, `alloc[]`, `funds[]`, `top_debtors[]`, `partners[]` the API
   `id`/`account_id` = the **account_id** (matches `data.js` `s.id` by design). The **PK** (`suppliers.id`)
   only appears in WRITE responses (`CapOut.supplier_id`, `PaymentPlanLineOut.supplier_id`). Pages
   never read the PK. Keep them distinct only when wiring the cap-write POST.

5. **Spelling/value traps that bite silently** (full list per hook below):
   `siyrafa`(API) ↔ `sayrafa`(page); `not_due`(API) ↔ `current`(page); `over_cap`→`overCap`;
   `currency`→`cur`; `*_m`→drop suffix; `reserve_m`(meta) vs `unexpected_reserve_m`(settings);
   `fy_start`(meta) vs `fiscal_year_start_month`(settings).

---

## 1. `useMeta` → global constants + exchange rate (Shell + most pages)

### Endpoint
`GET /api/meta` (no query params).

### Consumed-by
- **Shell.jsx `Header`** reads `exchangeRate` (top-bar `د.ع/$` badge). Source = `usd_rate`.
- **Dashboard / Breakdown / Forecast / SupplierPlan / Installments** read `D.CURRENT_CASH`,
  `D.RESERVE_M`, `D.USD_RATE`.
  - Dashboard: `D.CURRENT_CASH` (KPI + chart), `D.INSTALLMENTS_TOTAL` (see note).
  - Breakdown: `D.CURRENT_CASH` (funds card header).
  - Forecast: `D.CURRENT_CASH` (cash-path origin), `D.RESERVE_M` (default `reserve` prop).
  - SupplierPlan: `D.RESERVE_M` (default), `D.CURRENT_CASH` not used directly.
  - Suppliers: `D.USD_RATE` (fallback when `exchangeRate` prop absent).

### Output shape
```js
{
  USD_RATE:        number,   // ← API usd_rate         (also surfaced as exchangeRate; data.js calls both)
  exchangeRate:    number,   // ← API usd_rate         (alias — Shell/Header & Suppliers read this name)
  CURRENT_CASH:    number,   // ← API current_cash_m   (drop _m)
  RESERVE_M:       number,   // ← API reserve_m        (⚠ meta name; settings calls the SAME concept unexpected_reserve_m)
  fyStart:         number,   // ← API fy_start         (int month 1..12; settings calls it fiscal_year_start_month)
  lastEtl: {                 // ← API last_etl  (object | null)
    status:        string,   // ← API last_etl.status
    finishedAt:    string|null, // ← API last_etl.finished_at  (Settings "آخر تحديث للبيانات" can use this)
    rowsLoaded:    number,   // ← API last_etl.rows_loaded
    reconciliationResidualM: number|null, // ← API last_etl.reconciliation_residual_m
  } | null,
}
```

### Gotchas
- **`reserve_m` (meta) vs `unexpected_reserve_m` (settings.assumptions)** — same concept, two API
  names. `useMeta.RESERVE_M` ← `meta.reserve_m`. `useSettings` exposes the editable copy from
  `assumptions.unexpected_reserve_m`. Forecast/SupplierPlan default `reserve` prop to `RESERVE_M`,
  but the Settings slider value (from `useSettings`) overrides it at the App level — wire the App
  to prefer the settings value.  Direction: `reserve_m` → `RESERVE_M`; `unexpected_reserve_m` → `reserve` (settings).
- **`fy_start` (meta) vs `fiscal_year_start_month` (settings.assumptions)** — same concept, two API
  names. `useMeta.fyStart` ← `meta.fy_start`. Settings page binds `draft.fyStart` to the editable
  `assumptions.fiscal_year_start_month`. Direction: `fy_start` → `fyStart`; `fiscal_year_start_month` → `fyStart` (settings).
- **`START_CASH` has NO API source** — opening cash is internal to ETL (data.js `START_CASH=60`).
  Pages never read it directly (only used inside data.js to seed the running balance, which the API
  already provides as `cash_running_m`). **Drop it.**
- **`D.INSTALLMENTS_TOTAL`** is read by Dashboard (a KPI tile) and Installments, but it is NOT a meta
  field — it comes from `useInstallments`/`useDashboard` (`installments.remaining_m`). See hooks 4 & 9.
  Do not put it on `useMeta`.
- `last_etl` is `null` when no ETL run rows exist — guard in Settings/Shell.

---

## 2. `useDashboard` → Dashboard page

### Endpoint
`GET /api/dashboard` (no query params).

### Consumed-by — Dashboard.jsx
Reads (all currently off `window.DATA`):
- `D.agg.FY25` and `D.agg.FY24` → `.in`, `.out`, `.net` (KPI tiles + trend %).
- `D.netDecline` (KPI trend on صافي السيولة).
- `D.months` → per-month `.short`, `.in`, `.out`, `.net`, `.cats[key]` (60-month chart + FY25 expense donut via `last12`).
- `D.forecast` → per-month `.short`, `.base.in`, `.base.out`, `.base.net` (chart tail).
- `D.EXP_CATS` → `.name`, `.chart`, `.key` (expense donut segments; reads `m.cats[c.key]` over last 12).
- `D.CURRENT_CASH`, `D.INSTALLMENTS_TOTAL` (KPI tiles).
- `D.ALERTS` → `.tone`, `.title`, `.body` ("رؤى ومنبّهات" cards via `alertStyle(tone)`).
- `D.fmt.*` (client-side).

> **Architecture choice for D1:** the dashboard chart needs `months[]` (historical, with `out`/`net`/
> `cats`) AND `forecast[]` (base scenario tail) AND the FY25 expense mix. `GET /api/dashboard` supplies
> `monthly_series` (⚠ comprehensive-only OUT, no per-category `cats`) and `expense_mix` (window-total,
> not per-month). It does NOT give per-month `cats` nor a forecast tail. So **Dashboard must compose
> several hooks**, not just `useDashboard`:
> - 60-month chart history → `useCashflow()` `months[]` (has perspective-aware out/net) ; forecast tail → `useCashflow().forecast` or `useForecast().forecast`.
> - FY25 expense donut: data.js builds it from `last12 m.cats[c.key]`. The API's per-category monthly
>   series lives in `useBreakdown().expenseCats[].monthly[]` (last-12-summable), OR use dashboard
>   `expense_mix` (whole-window, not just FY25 — **semantics differ**; prefer breakdown's last-12 sum
>   to match the page's "آخر سنة مالية كاملة" label).
> Keep `useDashboard` focused on what `/api/dashboard` uniquely provides: `fyTotals`/`agg`,
> `netDecline`, `alerts`, `installments` summary, and a fallback `monthlySeries`.

### Output shape (`useDashboard`)
```js
{
  // FY totals — page reads D.agg.FY25 / D.agg.FY24 as {in,out,net}; also D.FY-like labels.
  agg: {                          // (derive) keyed by FY code from API fy_totals[]
    FY22: { in, out, net },       // ← fy_totals[i].{in_m,out_m,net_m}  (drop _m)
    FY23: { in, out, net },
    FY24: { in, out, net },
    FY25: { in, out, net },       // map fiscal_year "2025-2026" → "FY25" via helper
  },
  fyTotals: [ {                   // ← API fy_totals[]  (raw, ascending) — keep for generic use
    fiscalYear: string,           // ← fy_totals[].fiscal_year   ("2022-2023")  (page also wants "FY25"/"2025 / 2026" labels → derive)
    in:  number,                  // ← fy_totals[].in_m
    out: number,                  // ← fy_totals[].out_m
    net: number,                  // ← fy_totals[].net_m
  } ],
  netDecline: number,             // ← API net_decline_pct   (camelCase rename)

  installments: {                 // ← API installments  (object | null)
    premiumCount: number,         // ← installments.premium_count
    faceTotalM:   number,         // ← installments.face_total_m
    cashPaidM:    number,         // ← installments.cash_paid_m
    discountM:    number,         // ← installments.discount_m
    remainingM:   number,         // ← installments.remaining_m
  } | null,
  // page's D.INSTALLMENTS_TOTAL KPI ← installments.remaining_m  (NOTE: real ≈1.26B, NOT data.js's 4670)

  alerts: [ {                     // ← API alerts[]  (AlertOut — 7 fields, NO acknowledged_at)
    id:          number,          // ← alerts[].id
    tone:        string,          // ← alerts[].severity   (⚠ severity → tone; value vocab may differ — see gotcha)
    title:       string,          // ← alerts[].title
    body:        string|null,     // ← alerts[].body
    alertType:   string,          // ← alerts[].alert_type
    relatedKey:  string|null,     // ← alerts[].related_key
    status:      string,          // ← alerts[].status
    generatedAt: string,          // ← alerts[].generated_at
  } ],

  monthlySeries: [ {              // ← API monthly_series[]  (ALL rows, ascending; OUT is COMPREHENSIVE only)
    yearMonth:  string,           // ← monthly_series[].year_month
    in:    number,                // ← monthly_series[].cash_in_m
    out:   number,                // ← monthly_series[].out_total_comprehensive_m   (⚠ always comprehensive here)
    net:   number,                // ← monthly_series[].net_total_m
    cash:  number,                // ← monthly_series[].cash_running_m
    // + label/short/greg/year via monthMeta(year_month)  (derive — no API field)
  } ],

  expenseMix: {                   // ← API expense_mix  (Σ over FULL window per category — NOT last-12)
    suppliers: number,            // ← expense_mix.out_suppliers_m
    partners:  number,            // ← expense_mix.out_drawings_m     (⚠ drawings → partners)
    siyrafa:   number,            // ← expense_mix.out_siyrafa_m      (⚠ API spelling siyrafa; page key sayrafa)
    purchases: number,            // ← expense_mix.out_purchases_m
    salaries:  number,            // ← expense_mix.out_salaries_m
    refunds:   number,            // ← expense_mix.out_refunds_m
    other:     number,            // ← expense_mix.out_other_m        (API-only; no data.js EXP_CATS entry)
  },
}
```

### Fields the page derives itself (hook supplies raw inputs only)
- KPI trend percentages: `(FY25.in − FY24.in)/FY24.in`, `(FY25.out − FY24.out)/FY24.out` — derived in
  the page from `agg`. Hook supplies `agg` only.
- `inGrowth`, `outGrowth`, `expenseVelocity` — **NOT in API** (§17.11). Dashboard does not read these
  three directly, but if needed they're derived from `fyTotals`. Don't put on hook output.
- The expense donut `expSeg` — page builds from `last12 m.cats[c.key]`. Hook does NOT need to supply
  the donut; it supplies the per-category numbers (via `useBreakdown` last-12 OR `expenseMix`).

### Gotchas
- **`severity`(API) → `tone`(page).** `alertStyle()`/`NotificationsBell` expect `danger|warning|info`.
  Verify the API's `severity` vocabulary matches; if it uses different tokens, map them
  (e.g. `critical→danger`, else fall back to `info`). Direction: `severity` → `tone`.
- **Dashboard `alerts[]` is `AlertOut` (no `acknowledged_at`)** — the `/api/alerts` list (`useAlerts`,
  not built here) is `AlertDetailOut` (9 fields). Do not assume they're interchangeable.
- **`out_drawings_m` → `partners`** and **`out_siyrafa_m` → `siyrafa`** — the page category keys are
  `partners` / `sayrafa`. The `siyrafa`↔`sayrafa` spelling flip is the single easiest bug to ship.
- **`expense_mix` is whole-window**, but the Dashboard donut is labelled "آخر سنة مالية كاملة" (FY25).
  Match the page's intent with last-12 category sums (from `useBreakdown`), not `expense_mix`.
- **`agg.FY25`/`FY24` keying** requires mapping API `fiscal_year` (`"2025-2026"`) → `"FY25"`. Build a
  helper: `fyCode("2025-2026") => "FY25"` (take the start year's last two digits, prefix `FY`).
- **`INSTALLMENTS_TOTAL` KPI**: data.js shows `4670` (the discredited 4.67B). The real value is
  `installments.remaining_m ≈ 1260`. The page's static "4.67 مليار" copy string must be dropped
  (it also appears hard-coded in Installments — see hook 9).

---

## 3. `useCashflow` → MonthlyFlow page (+ Dashboard chart history)

### Endpoint
`GET /api/cashflow/monthly?perspective=comprehensive|operational` (default `comprehensive`).
- The page currently has no perspective toggle, so call with the default `comprehensive` (matches
  data.js, whose `out` includes siyrafa). The `perspective` param exists for a future toggle;
  D1 should accept it as a hook arg defaulting to `comprehensive`.

### Consumed-by
- **MonthlyFlow.jsx**: `D.months` → `.short`, `.label`, `.in`, `.out`, `.net`, `.cash`, `.fy`;
  `D.forecast` → `.short`, `.label`, `.base.{in,out,net}`. Builds the 60-month line chart, per-FY
  tabs (filter by `m.fy`), per-FY aggregates, net bars, and the months table (with running `cash`).
- **Dashboard.jsx**: same `D.months` + `D.forecast` for the 60-month chart (see hook 2 note).

### Output shape
```js
{
  months: [ {                     // ← API months[]  (ALL rows, ascending)
    in:    number,                // ← months[].cash_in_m
    out:   number,                // ← months[].out_total_m       (PERSPECTIVE-AWARE)
    net:   number,                // ← months[].net_total_m       (PERSPECTIVE-AWARE)
    cash:  number,                // ← months[].cash_running_m
    yearMonth: string,            // ← months[].year_month        ("2022-05")
    fy:    string,                // (derive) ← fyCode(months[].fiscal_year)   "2022-2023" → "FY22"
    fyLabel: string,              // (derive) ← months[].fiscal_year → "2022 / 2023"  (page tab labels)
    label: string,                // (derive) monthMeta — Arabic "أيار 2022"
    short: string,                // (derive) monthMeta — "05/22"
    greg:  number,                // (derive) monthMeta — gregorian month int (5)
    year:  number,                // (derive) monthMeta — 2022
    fmPos: number,                // (derive) fiscal-month position 0..11 (if a page needs it; MonthlyFlow does not)
  } ],

  forecast: [ {                   // ← API forecast[]  (pivoted seasonal base; may be [])
    base: {                       // page reads m.base.{in,out,net}
      in:  number,                // ← forecast[].cash_in_m
      out: number,                // ← forecast[].out_total_m     (perspective-aware: operational drops siyrafa)
      net: number,                // ← forecast[].net_total_m
    },
    yearMonth: string,            // ← forecast[].year_month
    label: string,                // (derive) monthMeta
    short: string,                // (derive) monthMeta
  } ],

  byFiscalYear: [ {               // ← API by_fiscal_year[]  (page derives its own FY aggs, but this is ready-made)
    fiscalYear: string,           // ← by_fiscal_year[].fiscal_year
    in:  number,                  // ← by_fiscal_year[].in_m
    out: number,                  // ← by_fiscal_year[].out_m
    net: number,                  // ← by_fiscal_year[].net_m
  } ],
}
```

### Fields the page derives itself (hook supplies raw inputs only)
- MonthlyFlow's per-FY `agg` (sum of in/out/net for the active tab), per-row cumulative `cum`,
  and the labels array — all derived in-page from `months`/`forecast`. The hook only supplies the
  raw per-month numbers + `fy`/`short`/`label`.
- `byFiscalYear` is optional (the page recomputes aggregates from `months`); include it because it's
  free and matches Dashboard's `agg`.

### Gotchas
- **`cash_in_m`→`in`, `out_total_m`→`out`, `net_total_m`→`net`, `cash_running_m`→`cash`.** (`in` is a
  near-reserved word; pages still use the bare key `in` on plain objects — fine in JS object literals.)
- **`out` is perspective-aware HERE** (`out_total_m`), unlike Dashboard's `out_total_comprehensive_m`.
  Two different API field names for "out" depending on endpoint. With the default `comprehensive`
  perspective they're equal, but keep the distinction in code.
- **No `cats` on cashflow months.** The MonthlyFlow page does NOT read `m.cats` (only Dashboard's
  donut + Breakdown do). Per-category data comes from `useBreakdown`. Do not try to source `cats` here.
- **Forecast `base` only.** The cashflow forecast has just one (seasonal base) track —
  `opt`/`pess` scenarios live in `useForecast`. MonthlyFlow only ever reads `m.base.*`, so this is fine.
- **`fy`/`fyLabel` format transform.** API `fiscal_year` = `"2022-2023"`; page `fy` = `"FY22"`,
  `fyLabel`/tab-label = `"2022 / 2023"` (data.js) or `"2022/2023"` (MonthlyFlow tabs). Derive both.
- **Forecast may be `[]`** on an empty/early DB — guard the chart tail.

---

## 4. `useBreakdown` → Breakdown page (+ Dashboard expense donut)

### Endpoint
`GET /api/breakdown` (no query params).

### Consumed-by — Breakdown.jsx
- `D.months.slice(-12)` → per-month `m.cats[c.key]` (stacked bars) and `m.in` (receipts bars).
- `D.EXP_CATS` → `.key`, `.name`, `.chart`, `.type` (category list, stacked-bar legend, table).
- `D.PARTNERS` → `.name`, `.total12` (partner withdrawal bars).
- `D.FUNDS` → `.name`, `.balance`, `.share` (funds list).
- `D.CURRENT_CASH` (funds card header — from `useMeta`).
- Finds category by key: `catTotals.find(c => c.key === 'sayrafa')`, `'partners'`. **(page key = `sayrafa`)**

> **Note:** Breakdown needs **per-month category amounts for the last 12 months** (stacked bars) AND
> per-month receipts (`m.in`). The API's `expense_cats[].monthly[]` gives per-category monthly amounts;
> receipts (`cash_in_m`) per month come from `useCashflow().months` (last 12). So Breakdown composes
> `useBreakdown` (categories, partners, funds) + `useCashflow` (receipts `m.in`).

### Output shape
```js
{
  // EXP_CATS-shaped: page reads c.key, c.name, c.chart, c.type, and c.total / per-month c.value.
  expCats: [ {                    // ← API expense_cats[]  (EXACTLY 6: suppliers,partners,siyrafa,purchases,salaries,refunds)
    key:    string,               // ← expense_cats[].key   (⚠ API uses "siyrafa"; data.js EXP_CATS key is "sayrafa")
    total:  number,               // ← expense_cats[].total_m
    monthly: [ {                  // ← expense_cats[].monthly[]
      yearMonth: string,          // ← monthly[].year_month
      value: number,              // ← monthly[].amount_m
      short: string,              // (derive) monthMeta — page stacked bars label by m.short
    } ],
    name:  string,                // (client-side) Arabic label — NOT in API; copy from data.js EXP_CATS
    chart: string,                // (client-side) chart-color token (e.g. "--chart-1") — NOT in API
    type:  string,                // (client-side) AccountTypeId string ("2518", "7"…) — NOT in API
  } ],

  partners: [ {                   // ← API partners[]  (balances_snapshot kind='partner', DESC)
    name:    string,              // ← partners[].name
    total12: number,              // ← partners[].balance_m   (⚠ balance, not a 12-month flow — semantics differ; see gotcha)
    accountId: number,            // ← partners[].account_id
  } ],

  funds: [ {                      // ← API funds[]  (balances_snapshot kind='cashbox', unsorted)
    name:    string,              // ← funds[].name
    balance: number,              // ← funds[].balance_m
    accountId: number,            // ← funds[].account_id
    // share: (NO direct API field) — data.js FUNDS[].share is a fraction of total; API gives absolute balance_m only.
    //        If the page's "%" column is needed, derive: share = balance / Σ(funds.balance).
  } ],
}
```

### CRITICAL: client-side category metadata
The 6-category **order, Arabic `name`, `chart` color token, and `type` (AccountTypeId)** are NOT in
the API (`column` was deliberately removed). Keep a static `EXP_CATS_META` keyed by API `key`
(remember the API key is **`siyrafa`**, so key the metadata by `siyrafa` — and if the page code still
literally does `find(c => c.key === 'sayrafa')`, either (a) rename the API key to `sayrafa` inside the
hook, OR (b) update those two `.find()` calls in Breakdown to `'siyrafa'`). **Recommended: normalize
to the page's `sayrafa` inside the hook** so the page diff stays minimal — but then keep that rename
consistent with the Dashboard `expense_mix.siyrafa` and Forecast/SupplierPlan deduction keys.

### Fields the page derives itself
- `expTotal`, `opExp` (= expTotal − sayrafa), `partnersTotal`, `recvTotal`, per-row share %,
  avg/month — all derived in-page from `expCats[].total` and receipts. Hook supplies raw `total`/
  `monthly`/`value` only.
- The stacked-bar `stacked` array and the receipts `recv` array are built in-page from
  `expCats[].monthly` + `months[].in`.

### Gotchas
- **`siyrafa`(API key) ↔ `sayrafa`(page key)** — appears in `expCats[].key`, and the page does
  `catTotals.find(c => c.key === 'sayrafa')` twice (lines 20, and indirectly). Pick ONE spelling and
  apply it everywhere (recommend normalizing to `sayrafa` in the hook).
- **`out_drawings_m`/`partners`** — the breakdown category `key` for partner withdrawals is already
  `partners` (good); only the dashboard `expense_mix` uses `out_drawings_m`. Don't cross them.
- **`partners[].balance_m` → `total12`** — **semantic mismatch flagged in §17.8**: data.js `total12`
  is a 12-month withdrawal FLOW; the API `balance_m` is a snapshot BALANCE. The page renders it as a
  "آخر 12 شهراً" withdrawal bar. (verify against live — the value may not equal a 12-month flow.) Map
  `balance_m` → `total12` but be aware the label may overstate/understate. Direction: `balance_m` → `total12`.
- **`funds[].share` has NO API field** — derive `share = balance / Σ balances` if the % column is kept.
- **Funds are unsorted** in the API; data.js `FUNDS` is in a fixed order. Sort client-side if order matters.
- `partners`/`funds` may be `[]` (no snapshot) — guard.

---

## 5. `useSuppliers` → Suppliers page (+ Settings caps editor + Shell search)

### Endpoint
`GET /api/suppliers` (no query params). (Cap WRITE = `POST /api/suppliers/{account_id}/caps` — a
separate mutation, not part of the read hook; see Settings note.)

### Consumed-by
- **Suppliers.jsx**: `D.SUPPLIERS` → per-supplier `.id`, `.name`, `.cur`, `.cap`, `.monthly[]`,
  `.total12`, `.balance`, `.overCap` (heat-grid table, USD-balance KPI, over-cap count).
  `D.last12` → `.greg`, `.label` (column month labels + tooltip month). `D.USD_RATE`/`exchangeRate`.
- **Settings.jsx**: `D.SUPPLIERS` → `.id`, `.name`, `.cur` (cap editor rows; binds `draft.caps[s.id]`).
- **Shell.jsx `buildSearchIndex`**: `D.SUPPLIERS` → `.name` (search entries `{kind:'مورد', label:s.name}`).

### Output shape
```js
{
  suppliers: [ {                  // ← API suppliers[]  (ordered by display_order asc)
    id:       number,             // ← suppliers[].id        (= account_id, matches data.js s.id)
    name:     string,             // ← suppliers[].name
    cap:      number,             // ← suppliers[].cap       (active monthly_cap_m, else 0)
    cur:      string,             // ← suppliers[].currency  (⚠ currency → cur; values IQD|USD|MIX)
    monthly:  number[],           // ← suppliers[].monthly   (last-12 paid_m, ascending, len 0..12)
    overCap:  number,             // ← suppliers[].over_cap  (⚠ over_cap → overCap)
    balance:  number,             // ← suppliers[].balance_m (⚠ balance_m → balance; balance_iqd_m)
    util:     number|null,        // ← suppliers[].util
    active:   boolean,            // ← suppliers[].active
    total12:  number,             // (derive) Σ monthly  — data.js precomputes; API does NOT (compute in hook)
    avg:      number,             // (derive) total12/12 (or /monthly.length) — data.js-only
    mean:     number,             // (NO API field) — data.js calibration constant; NOT needed by the page render → omit
  } ],
}
```

### Fields the page derives itself / hook must supply
- **`total12` MUST be supplied (or derived in hook)** — Suppliers.jsx reads `s.total12` directly
  (table "الإجمالي" column, `totalAll`). API has no `total12`; compute `Σ monthly` in the hook.
- `avg`, `util` — `util` comes from API; `avg` is data.js-derived (`total12/12`). The page reads
  `s.util`? — actually Suppliers.jsx does NOT read `util`/`avg`/`mean` in its render (only the
  heat-grid uses `monthly`, `cap`, `total12`, `balance`, `cur`, `overCap`, `name`, `id`). So
  `mean`/`avg`/`util` are **not strictly required** by the Suppliers page — supply `util` (free from
  API) and `total12` (needed); `mean`/`avg` can be omitted.
- `maxCell`, `totalAll`, `totalOver`, `usdBalance` — derived in-page from `monthly`/`balance`/`cur`.
- The `caps` override (`capOf(s)`) comes from **Settings draft state**, not the supplier hook — the
  page already accepts a `caps` prop that overrides `s.cap` per id.

### Gotchas
- **`currency`(API) → `cur`(page).** Values `IQD|USD|MIX`. The page's `CurBadge`/USD logic keys on
  `s.cur === 'USD'` / `'MIX'`. Direction: `currency` → `cur`.
- **`over_cap`(API) → `overCap`(page).** Direction: `over_cap` → `overCap`.
- **`balance_m`(API) → `balance`(page).** API `balance_m` = `balance_iqd_m` (dinar millions); data.js
  `balance` mixed a USD×rate heuristic. For USD suppliers the page calls `F.fmtUSD(s.balance, rate)`
  which divides dinar-millions by the rate — so feeding dinar `balance_m` is correct. Direction:
  `balance_m` → `balance`.
- **`id` = account_id**, NOT the suppliers PK. The cap-write POST path needs the **account_id**
  (`POST /api/suppliers/{account_id}/caps`) — so `s.id` is the right value to POST with. The PK
  (`supplier_id`) only comes back in the `CapOut`/`PaymentPlanLine` responses; pages never read it.
- **`monthly` may be shorter than 12** (early DB). The heat-grid maps `s.monthly` and zips with
  `D.last12[mi]` for month labels — **lengths must align**. `last12` month labels come from
  `useCashflow().months.slice(-12)` (the API supplies no separate "last 12 month label" list for
  suppliers). If `monthly.length < 12`, the page's `D.last12[mi].label` lookup can go out of range —
  D1/D2 should align the heat-grid to `Math.min(monthly.length, last12.length)`.
- **`mean`/`SUP_MEAN`/`SUP_SHARE` are data.js synthetic constants** with no API source. `SUP_SHARE`
  (allocation weights) is irrelevant now — the API does allocation server-side (`useSupplierPlan`). Omit.

---

## 6. `useInstallments` → Installments page

### Endpoint
`GET /api/installments` (no query params).

### Consumed-by — Installments.jsx
- `D.INSTALLMENTS_TOTAL` → `total` (KPIs, donut center, info banner).
- `D.AGING` → per-bucket `.key`, `.label`, `.amount`, `.color`, `.count` (donut, aging bars,
  `find(a => a.key === 'current')`, `find(a => a.key === 'b120')`, filter `['b61_90','b91_120','b120']`).
- `D.TOP_DEBTORS` → `.name`, `.contract`, `.balance`, `.bucket`, `.due` (debtors table).

### Output shape
```js
{
  total: number,                  // ← API summary.remaining_m   (⚠ data.js used 4670; real ≈1260. The page's hard-coded "4.67 مليار" string must be removed.)
  summary: {                      // ← API summary  (object | null) — full 5-field snapshot if other KPIs wanted
    premiumCount: number,         // ← summary.premium_count
    faceTotalM:   number,         // ← summary.face_total_m
    cashPaidM:    number,         // ← summary.cash_paid_m
    discountM:    number,         // ← summary.discount_m
    remainingM:   number,         // ← summary.remaining_m   (== total)
  } | null,

  aging: [ {                      // ← API aging[]  (ordered not_due→b0_30→b31_60→b61_90→b91_120→b120)
    key:    string,               // ← aging[].bucket_key  (⚠ bucket_key → key; AND value "not_due"(API) → "current"(page))
    label:  string,               // ← aging[].label
    amount: number,               // ← aging[].amount_m    (⚠ amount_m → amount)
    count:  number,               // ← aging[].count
    color:  string,               // (client-side) bucket color token — NOT in API; map by key from data.js AGING colors
  } ],

  topDebtors: [ {                 // ← API top_debtors[]  (top 10, DESC by balance)
    name:     string,             // ← top_debtors[].name
    balance:  number,             // ← top_debtors[].balance_m
    accountId: number,            // ← top_debtors[].account_id
    contract: string,             // (NO API field) — data.js mock contract number; API top_debtors is account-level, not contract-level
    bucket:   string,             // (NO API field) — data.js mock aging bucket per debtor
    due:      string,             // (NO API field) — data.js mock status (متعثّر/متأخر/متابعة/جاري)
  } ],
}
```

### Gotchas (this hook has the densest renames)
- **`bucket_key`(API) → `key`(page).** Direction: `bucket_key` → `key`.
- **Bucket VALUE `not_due`(API) → `current`(page).** The page does `aging.find(a => a.key === 'current')`
  for the "لم يستحق بعد" tile. If you keep the API value `not_due`, that `.find` returns undefined and
  the page crashes (`.amount` of undefined). **Normalize `not_due` → `current` inside the hook** (or
  change the two `.find('current')` calls in Installments to `'not_due'`). Other buckets
  (`b0_30/b31_60/b61_90/b91_120/b120`) match 1:1. Direction: `not_due` → `current`.
- **`amount_m`(API) → `amount`(page).** Direction: `amount_m` → `amount`.
- **`color` is a client-side token** keyed by bucket (`--bucket-0-30`, `--bucket-120-plus`, `#EA580C`,
  …). Copy the color map from data.js `AGING`. NOT in API.
- **`top_debtors` has NO `contract`/`bucket`/`due`** — those three are data.js mock-only (contract-level
  fiction). API `top_debtors` is **account-level**. The page's debtors table renders `d.contract`,
  `d.bucket`, `d.due` and a `tone` derived from `d.due`. **Flag for D2/D3:** either drop those three
  columns, or show placeholders. `(no direct API field — may be approximated/omitted)`.
- **`total` ← `summary.remaining_m`** (not `face_total_m`). The page's `total` drives the donut center
  and the "إجمالي الأقساط المستحقة" KPI and the info banner. data.js conflated the face total and the
  outstanding; per CLAUDE.md §6 the **outstanding (remaining) is the correct "مستحقة" figure ≈1.26B**.
- **Remove the hard-coded "4.67 مليار د.ع" string** in the info banner (Installments.jsx line ~94).
- `summary` may be `null` and `aging`/`top_debtors` may be `[]` — guard the `.find()`/`reduce()` calls.

---

## 7. `useForecast` → Forecast page (+ Dashboard/MonthlyFlow forecast tail)

### Endpoint
`GET /api/forecast?scenario_id=<int?>` (scenario_id optional; non-existent id is non-fatal → 200).

### Consumed-by — Forecast.jsx
- `D.forecast` → per-month `.label`, `.short`, and `m.base/opt/pess.{in,out}` (recomputes net with a
  live `incomeGrowth` multiplier and `reserve` deduction).
- `D.CURRENT_CASH` (cash-path origin, from `useMeta`).
- `D.RESERVE_M` (default `reserve` prop, from `useMeta`/`useSettings`).
- `D.SCENARIOS[scn].label` (`SectionHeader` title).
- **NEW:** `mape` / `confidence` (MAPE badge) — no data.js equivalent.

### Output shape
```js
{
  forecast: [ {                   // ← API forecast[]  (per month, ascending; 12 at full horizon)
    base: { in, out, net },       // ← forecast[].base.{in_m,out_m,net_m}   (⚠ in_m/out_m/net_m → in/out/net)
    opt:  { in, out, net },       // ← forecast[].opt.{in_m,out_m,net_m}
    pess: { in, out, net },       // ← forecast[].pess.{in_m,out_m,net_m}
    yearMonth: string,            // ← forecast[].year_month
    label: string,                // (derive) monthMeta — "أيار 2026"
    short: string,                // (derive) monthMeta — "05/26"
  } ],

  cashPaths: {                    // ← API cash_paths   (⚠ cash_paths → cashPaths)
    base: number[],               // ← cash_paths.base   (running cash, reserve already subtracted server-side)
    opt:  number[],               // ← cash_paths.opt
    pess: number[],               // ← cash_paths.pess
  },

  fcTotals: {                     // ← API fc_totals   (⚠ fc_totals → fcTotals)
    base: {
      in:      number,            // ← fc_totals.base.in_m
      out:     number,            // ← fc_totals.base.out_m
      net:     number,            // ← fc_totals.base.net_m
      endCash: number,            // ← fc_totals.base.end_cash_m   (⚠ end_cash_m → endCash)
      minCash: number,            // ← fc_totals.base.min_cash_m   (⚠ min_cash_m → minCash)
    },
    opt:  { in, out, net, endCash, minCash },   // ← fc_totals.opt.*
    pess: { in, out, net, endCash, minCash },   // ← fc_totals.pess.*
  },

  scenarios: {                    // ← API scenarios
    base: { label, inG, outG },   // ← scenarios.base.{label,in_g,out_g}   (⚠ in_g/out_g → inG/outG)
    opt:  { label, inG, outG },   // ← scenarios.opt.*
    pess: { label, inG, outG },   // ← scenarios.pess.*
    // chart: (client-side) color token per scenario — NOT in API; keep ['--chart-1','--chart-2','--chart-5'] map.
  },

  mape:       number|null,        // ← API mape         (NEW — no data.js equivalent; MAPE badge)
  confidence: string|null,        // ← API confidence   (NEW — Arabic: عالية/متوسطة/منخفضة)
}
```

### Fields the page derives itself (IMPORTANT — avoid double-supplying)
- The Forecast page **recomputes** `net`, `cashPaths`, and `totals` locally in a `useMemo` from
  `m.base/opt/pess.in/out` + the live `incomeGrowth` (`g`) and `reserve` props (because the user can
  drag the reserve slider / income-growth slider and re-project without a refetch). **So the hook's
  `cashPaths`/`fcTotals` are the server's defaults (reserve = the saved assumption, g = 1).** When the
  user changes sliders, the page ignores the hook's `cashPaths`/`fcTotals` and recomputes from
  `forecast[].{base,opt,pess}.{in,out}`. ⇒ The hook MUST supply the raw per-month `in`/`out` per
  scenario; `cashPaths`/`fcTotals` are convenience defaults for the un-adjusted view.
- `runwayMonths` (pess.min / avgOut) is derived in-page.

### Gotchas
- **`in_m/out_m/net_m` → `in/out/net`** (nested under `base/opt/pess`).
- **`fc_totals`→`fcTotals`, `end_cash_m`→`endCash`, `min_cash_m`→`minCash`, `in_m/out_m/net_m`→`in/out/net`.**
- **`cash_paths`→`cashPaths`**; **`scenarios[s].in_g/out_g`→`inG/outG`.**
- **`mape`/`confidence` are NEW** — the MAPE badge has no data.js source. They are `null` when no MAPE
  on the `cash_in` forecast series — render the badge only when non-null.
- **`scenarios[s].chart` color token is client-side** (data.js `--chart-1/2/5`). NOT in API.
- **CRITICAL (dollar-supplier semantics):** see hook 8 — the dollar suppliers no longer get a pool
  share. Forecast itself doesn't allocate, but its `fcTotals`/pool feed SupplierPlan; the Option-1
  treatment (siyrafa funds the dollar suppliers) is already baked into the server pool. Do not
  re-introduce data.js's old `allocate()` logic anywhere.
- **`scenario_id`** can be passed to re-weight income growth server-side; for the baseline page leave
  it unset. A non-existent id silently falls back (200), so no error handling needed beyond the envelope.

---

## 8. `useSupplierPlan` → SupplierPlan page

### Endpoint
`GET /api/supplier-plan?month=YYYY-MM&scenario_id=<int?>`
- **`month` is REQUIRED** (pattern `^\d{4}-(0[1-9]|1[0-2])$`). Missing/malformed → **422**.
- The page has a 12-month selector and currently builds **all 12 months at once** in a `useMemo`
  (`D.forecast.map(m => allocate(m, ...))`). The API is **per-month**, so the hook must call the
  endpoint **once per forecast month** (12 calls) — or D1 exposes `useSupplierPlan(month)` and the
  page fetches the selected month on demand (preferred: 1 call per selected month + lazy-load others,
  or fetch all 12 in parallel on mount). **This is a structural change from data.js's synchronous
  `allocate()`** — call out to D2/D3.

### Consumed-by — SupplierPlan.jsx
Per selected month `cur`:
- `cur.pool` (المجمّع المتاح), `cur.leftover` (فائض سيولة badge).
- `cur.alloc[]` → per-supplier `.id`, `.name`, `.cur`, `.cap`, `.want`, `.give`, `.capped`
  (distribution table + 12-month stacked bars `a.give`).
- `cur.month` → `m.label`, `m.short`, `m.base.in`, `m.cats.{partners,sayrafa,salaries,purchases,refunds}`
  (the pool-breakdown panel "حساب المجمّع").

### Output shape (per month)
```js
{
  month:    string,               // ← API month   (echoes request "2026-05")
  pool:     number,               // ← API pool_m            (⚠ pool_m → pool)
  leftover: number,               // ← API leftover_m        (⚠ leftover_m → leftover)
  alloc: [ {                      // ← API alloc[]  (active suppliers, display_order)
    id:        number,            // ← alloc[].id            (= account_id)
    name:      string,            // ← alloc[].name
    cur:       string,            // ← alloc[].currency      (⚠ currency → cur; "USD" rows have give=0)
    give:      number,            // ← alloc[].allocated_m   (⚠ allocated_m → give)
    actualPaid: number|null,      // ← alloc[].actual_paid_m (API-only; nullable)
    cap:       number,            // (NO API field) — data.js had per-supplier cap; pull from useSuppliers[id].cap (join client-side)
    want:      number,            // (NO API field) — data.js intermediate "requested before cap"; API omits. See gotcha.
    capped:    boolean,           // (NO API field) — data.js flag; derive: capped = (cap > 0 && give >= cap - ε)
  } ],
  distributed: number,            // (derive) = pool − leftover   (API does NOT return distributed)
}
```

### CRITICAL semantic note (dollar suppliers — Option 1)
- **The dollar suppliers — الحافظ (4937), كهربائيات المهندس (6444), د. يوسف ميديا فوكس (6552),
  شركة الريان (6918) — now have `allocated_m = 0`** and are "مموَّلون عبر الصيرفة" (funded via the
  siyrafa line, which is already deducted from the pool). The server's `allocate_dinar` distributes
  the dinar pool to **dinar suppliers only**, to avoid double-counting their payment (CLAUDE.md §4
  decision 4, §10 lesson 5).
- **The page MUST NOT replicate data.js's old `allocate()`** (data.js lines 233–268), which gave every
  supplier — including the four USD ones — a `SUP_SHARE` pool slice. That is the discredited behavior.
  Use the server's `alloc[].allocated_m` verbatim. For USD rows, `give === 0`; the page should label
  them "مموَّل عبر الصيرفة" (a small UI change from the current table, which just shows a دولار badge).
- **`SUP_SHARE` weights are gone** — allocation is server-side. Do not port them.

### Fields the page reads that have NO direct API field (flag for D2/D3)
- **`a.want`** (requested-before-cap) — data.js intermediate. The API returns only the final
  `allocated_m`. The page's table has a "المطلوب" column showing `a.want`. **No API source.** Options:
  (a) drop the "المطلوب" column, or (b) approximate `want = give` (loses the over-cap visual). Flag it.
- **`a.cap`** — the page shows each supplier's cap in the plan table. Not in the supplier-plan response;
  **join from `useSuppliers()` by `id`** (account_id) client-side.
- **`a.capped`** — derive client-side: `cap > 0 && give >= cap − ε`. (Without `want`, you can't tell a
  "capped" row from a coincidentally-equal one, but this is good enough for the badge.)
- **`cur.month.base.in` and `cur.month.cats.*`** (the pool-breakdown panel deductions: partners,
  sayrafa, salaries, purchases, refunds, reserve) — these come from **`useForecast().forecast[]`**
  for the same `year_month`, NOT from the supplier-plan response. The supplier-plan endpoint returns
  only `pool_m`/`leftover_m`/`alloc`. So the "حساب المجمّع" panel must join: `pool` from supplier-plan
  + the deduction line-items from the forecast month's `cats`. **However** the forecast API
  (`/api/forecast`) returns only `{in_m,out_m,net_m}` per scenario — it does NOT break out per-category
  `cats` (partners/sayrafa/salaries/…). **⚠ The per-category forecast `cats` have NO API source** in
  the documented shapes. The pool breakdown panel's individual deduction rows therefore cannot be
  reconstructed exactly — **flag for D2/D3:** either (a) show only the resulting `pool` (drop the
  itemized deduction list), or (b) request a backend addition exposing forecast `cats`. The server
  DOES compute the pool from those components internally (`pool = forecast_in − salaries − purchases −
  refunds − partners − siyrafa − reserve`, §9 of doc 05), but only the net `pool_m` is exposed.

### Gotchas
- **`pool_m`→`pool`, `leftover_m`→`leftover`, `allocated_m`→`give`, `currency`→`cur`.**
- **`distributed` is NOT returned** — derive `distributed = pool − leftover`.
- **`actual_paid_m`→`actualPaid`** is an API-only addition (nullable) — the page doesn't currently
  render it; available if a "actual vs planned" column is added.
- **Per-month fan-out:** 12 endpoint calls (one per forecast month) vs data.js's single synchronous
  pass. Fetch the selected month eagerly + others lazily/in-parallel.
- **`month` is required** — never call this hook without a valid `YYYY-MM` or you get 422.

---

## 9. `useSettings` → Settings page (+ App-level prop source for all pages)

### Endpoint
`GET /api/settings` (read) and `PUT /api/settings` (partial upsert — the save button).

### Consumed-by — Settings.jsx (via a `settings` prop the App builds)
The App composes a `settings` object that flows as props into pages:
- `draft.accent`, `draft.showAlert` (display).
- `draft.fyStart`, `draft.exchangeRate` (fiscal year + USD rate).
- `draft.reserve`, `draft.incomeGrowth` (forecast assumptions).
- `draft.negThreshold`, `draft.overCapWarn` (alert thresholds).
- `draft.caps[s.id]` (per-supplier cap overrides).

These props are then read by: Dashboard (`showAlert`), MonthlyFlow (`negThreshold`), Suppliers
(`caps`, `overCapWarn`, `exchangeRate`), Forecast (`reserve`, `incomeGrowth`), SupplierPlan
(`reserve`, `incomeGrowth`, `caps`), Shell/Header (`exchangeRate`).

### Output shape (flattened to the page's `settings` prop shape)
```js
{
  // display
  accent:       string,           // ← API display.accent          (Arabic "أزرق"/"كحلي"/"أخضر")
  showAlert:    boolean,          // ← API display.show_alert       (⚠ show_alert → showAlert)
  negThreshold: number,           // ← API display.neg_threshold_m  (⚠ neg_threshold_m → negThreshold; may serialize as int 0)
  overCapWarn:  boolean,          // ← API display.over_cap_warn    (⚠ over_cap_warn → overCapWarn)

  // assumptions (editable copies of the meta globals)
  exchangeRate: number,           // ← API assumptions.usd_rate           (⚠ usd_rate → exchangeRate; nullable → fall back to meta.usd_rate)
  reserve:      number,           // ← API assumptions.unexpected_reserve_m (⚠ unexpected_reserve_m → reserve; nullable → fall back to meta.reserve_m)
  fyStart:      number,           // ← API assumptions.fiscal_year_start_month (⚠ fiscal_year_start_month → fyStart; nullable → fall back to meta.fy_start)
  incomeGrowth: number,           // ← API assumptions.income_growth_pct  (nullable → default 0; data.js used a raw %; page slider is -15..15)

  // per-supplier caps — page binds draft.caps[account_id]
  caps: {                         // (derive) { [account_id]: cap_m }
    // ← built from useSuppliers().suppliers[].{id, cap}   (the GET /api/settings has NO caps map;
    //    caps live on suppliers / supplier_caps. Seed from current supplier caps; writes go to
    //    POST /api/suppliers/{account_id}/caps, NOT PUT /api/settings.)
  },
}
```

### Save path (PUT /api/settings)
On save, the page sends back the changed fields. Map page→API (reverse direction):
- `showAlert`→`display.show_alert`, `negThreshold`→`display.neg_threshold_m`,
  `overCapWarn`→`display.over_cap_warn`, `accent`→`display.accent`.
- `exchangeRate`→`assumptions.usd_rate`, `reserve`→`assumptions.unexpected_reserve_m`,
  `fyStart`→`assumptions.fiscal_year_start_month`, `incomeGrowth`→`assumptions.income_growth_pct`.
- **Cap edits do NOT go through PUT /api/settings** — each changed `caps[id]` is a separate
  `POST /api/suppliers/{id}/caps` (with `monthly_cap_m` + `effective_from`). Flag for D2/D3: the
  Settings save button must split the payload (settings PUT vs N cap POSTs).

### Gotchas
- **Two API homes for the same three globals:** `usd_rate`/`unexpected_reserve_m`/`fiscal_year_start_month`
  appear in BOTH `/api/meta` (read-only display names `usd_rate`/`reserve_m`/`fy_start`) AND
  `/api/settings.assumptions` (editable names `usd_rate`/`unexpected_reserve_m`/`fiscal_year_start_month`).
  `useSettings` is the **editable** source; `useMeta` is the **display** source. When an assumption is
  `null` in settings, fall back to the meta value. Directions:
  - `reserve_m`(meta) → `RESERVE_M`; `unexpected_reserve_m`(settings) → `reserve`.
  - `fy_start`(meta) → `fyStart`; `fiscal_year_start_month`(settings) → `fyStart`.
  - `usd_rate` is the same key in both; → `USD_RATE`/`exchangeRate`.
- **`show_alert`→`showAlert`, `neg_threshold_m`→`negThreshold`, `over_cap_warn`→`overCapWarn`.**
  `neg_threshold_m` may serialize as integer `0` (not `0.0`) — treat as number either way.
- **`caps` map has NO single API field** — GET /api/settings returns no caps. Build the initial
  `caps` object from `useSuppliers().suppliers[].{id, cap}`; writes go to the supplier caps POST.
- **Assumptions are nullable** — every `assumptions.*` can be `null` (no global Assumption row). Apply
  fallbacks to the page-facing defaults (data.js: reserve 15, usd 1350, fyStart 5, incomeGrowth 0).
- The "آخر تحديث للبيانات" timestamp on Settings is currently hard-coded; source it from
  `useMeta().lastEtl.finishedAt`.

---

## Appendix A — Shell.jsx wiring (already ported)

`Shell.jsx` consumes three things that span hooks:

| Shell need | Source hook(s) | Field |
|------------|----------------|-------|
| `exchangeRate` (Header top-bar badge) | `useMeta` (or `useSettings.exchangeRate` override) | `usd_rate` |
| `alerts` (NotificationsBell — reads `a.tone`, `a.title`, `a.body`; badge count = `alerts.length`) | `useDashboard().alerts` OR a dedicated `useAlerts()` (`GET /api/alerts`) | `severity`→`tone`, `title`, `body` |
| `searchIndex` (`buildSearchIndex`) | `useSuppliers().suppliers[].name` + `useInstallments().topDebtors[].name` (+ `d.contract` for `meta:`) | suppliers `name`; debtors `name` (`contract` is **mock-only — no API field**) |

- **NotificationsBell `a.tone`** ← `severity` (same rename as Dashboard alerts). Verify the severity
  vocabulary maps to `danger|warning|info`.
- **Search debtor `meta: 'عقد ${d.contract}'`** — `contract` is data.js mock-only. With no API
  `contract`, drop the `meta` line for debtors (or use `account_id`).
- The 9th "hook" `useMeta` plus `useDashboard`/`useSuppliers`/`useInstallments` together feed the Shell;
  there is no separate Shell hook.

## Appendix B — Master rename table (quick reference for D1)

| Page field | API field | Endpoint | Direction |
|------------|-----------|----------|-----------|
| `in` | `cash_in_m` | cashflow/dashboard | API→page |
| `out` | `out_total_m` (cashflow) / `out_total_comprehensive_m` (dashboard) | cashflow/dashboard | API→page |
| `net` | `net_total_m` | cashflow/dashboard | API→page |
| `cash` | `cash_running_m` | cashflow/dashboard | API→page |
| `fy` (`FY22`) / `fyLabel` (`2022 / 2023`) | `fiscal_year` (`2022-2023`) | cashflow/dashboard | derive |
| `agg.FYxx.{in,out,net}` | `fy_totals[].{in_m,out_m,net_m}` | dashboard | API→page |
| `netDecline` | `net_decline_pct` | dashboard | API→page |
| `cur` | `currency` | suppliers / supplier-plan alloc | API→page |
| `overCap` | `over_cap` | suppliers | API→page |
| `balance` | `balance_m` (`balance_iqd_m`) | suppliers / funds | API→page |
| `total12` (supplier) | (derive Σ `monthly`) | suppliers | derive |
| `total12` (partner) | `balance_m` | breakdown.partners | API→page (semantics differ) |
| `id` (=account_id) | `id` / `account_id` | suppliers/alloc/funds/debtors | API→page |
| `sayrafa` | `siyrafa` | breakdown/dashboard/forecast/plan | API→page (SPELLING) |
| `partners` (cat key) | `partners` (breakdown) / `out_drawings_m` (dashboard mix) | breakdown/dashboard | API→page |
| `AGING.key` | `aging.bucket_key` | installments | API→page |
| `current` (bucket) | `not_due` | installments | API→page (VALUE) |
| `AGING.amount` | `aging.amount_m` | installments | API→page |
| `TOP_DEBTORS.balance` | `top_debtors.balance_m` | installments | API→page |
| `TOP_DEBTORS.{contract,bucket,due}` | (none — mock) | installments | NO SOURCE |
| `fcTotals` | `fc_totals` | forecast | API→page |
| `fcTotals[s].endCash` / `minCash` | `fc_totals[s].end_cash_m` / `min_cash_m` | forecast | API→page |
| `forecast[].{base,opt,pess}.{in,out,net}` | `…{in_m,out_m,net_m}` | forecast | API→page |
| `cashPaths` | `cash_paths` | forecast | API→page |
| `SCENARIOS[s].{inG,outG}` | `scenarios[s].{in_g,out_g}` | forecast | API→page |
| `mape` / `confidence` | `mape` / `confidence` | forecast | API→page (NEW) |
| `pool` / `leftover` | `pool_m` / `leftover_m` | supplier-plan | API→page |
| `alloc[].give` | `alloc[].allocated_m` | supplier-plan | API→page |
| `alloc[].{want,cap,capped}` | (none — derive/join) | supplier-plan | NO SOURCE / derive |
| `distributed` | (derive `pool − leftover`) | supplier-plan | derive |
| `showAlert` / `negThreshold` / `overCapWarn` | `show_alert` / `neg_threshold_m` / `over_cap_warn` | settings.display | API→page |
| `exchangeRate` / `USD_RATE` | `usd_rate` | meta / settings | API→page |
| `RESERVE_M` (meta) / `reserve` (settings) | `reserve_m` / `unexpected_reserve_m` | meta / settings | API→page |
| `fyStart` (both) | `fy_start` (meta) / `fiscal_year_start_month` (settings) | meta / settings | API→page |
| `CURRENT_CASH` | `current_cash_m` | meta | API→page |
| `INSTALLMENTS_TOTAL` | `summary.remaining_m` | dashboard/installments | API→page (≈1260, NOT 4670) |
| `tone` (alert) | `severity` | dashboard/alerts | API→page |
| `START_CASH` | (none) | — | DROP |
| `fmt.*`, `EXP_CATS.{name,chart,type}`, `AGING.color`, `SCENARIOS[s].chart` | (none) | — | client-side |
