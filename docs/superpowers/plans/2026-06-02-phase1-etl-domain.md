# الخطة 1 — ETL + domain — خطة تنفيذ

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** استخراج منطق الأعمال من `analysis/build_excel.py` إلى وحدات Python نقية قابلة للاختبار (`domain/{classify,forecast,allocation,alerts}`)، وبناء خط ETL ليلي يقرأ من SQL Server (قراءة فقط) ويملأ الجداول التحليلية في PostgreSQL عبر تحميل ذرّي (staging→swap)، مع تثبيت الرصيد الافتتاحي ومطابقة السيولة وقفل تشغيل أحادي وجدولة بتوقيت Asia/Baghdad.

**Architecture:** `domain/` دوال نقية تأخذ DataFrames/قيم وتُعيد قيماً (لا تعرف SQL ولا HTTP). `etl/` يتولّى الاستخراج (pymssql، اتصال محقون) والتحميل (staging ثم تبديل ذرّي) والتنسيق (pipeline) والجدولة. كل شيء يقرأ التهيئة من `app.config`.

**Tech Stack:** Python 3.12، pandas، pymssql، SQLAlchemy 2.x، APScheduler، pytest، zoneinfo (Asia/Baghdad).

**المرجع:** المواصفة `docs/superpowers/specs/2026-06-01-cashflow-web-system-design.md` (§4 ETL، §6 التنبؤ، §3.1 الجداول التحليلية)، والمصدر `analysis/build_excel.py`، ومخرجات تحقّق الخطة 0 (`cashflow-web/docs/discovery/*`).

**تعتمد على:** الخطة 0 (المخطّط، Postgres، مستخدم القراءة-فقط، `.env`).

**هذه الخطة 1 من 5.**

---

## بنية الملفات (Plan 1)

```
cashflow-web/backend/app/
├── domain/
│   ├── __init__.py
│   ├── classify.py        # تصنيف الحركات الشهرية + المنظوران A/C  (منطق نقي)
│   ├── forecast.py        # موسمي×CAGR + backtest MAPE              (منطق نقي)
│   ├── allocation.py      # توزيع المجمّع على موردي الدينار + السقوف (منطق نقي)
│   └── alerts.py          # توليد التنبيهات من النتائج               (منطق نقي)
├── etl/
│   ├── __init__.py
│   ├── extract.py         # استعلامات القراءة من SQL Server (اتصال محقون)
│   ├── load.py            # كتابة staging + تبديل ذرّي في معاملة
│   ├── reconcile.py       # تثبيت الرصيد الافتتاحي + مطابقة السيولة
│   ├── pipeline.py        # تنسيق: extract→transform(domain)→load + etl_runs + قفل
│   └── scheduler.py       # APScheduler بتوقيت Asia/Baghdad
└── tests/
    ├── domain/{test_classify,test_forecast,test_allocation,test_alerts}.py
    └── etl/{test_load_swap,test_reconcile,test_pipeline}.py
```

> **حدود الوحدات:** كل ملف `domain/*` مسؤولية واحدة ولا يستورد SQLAlchemy/pymssql. `etl/extract` المصدر الوحيد لـ SQL النصّي للقراءة. `etl/load` المسؤول الوحيد عن التبديل الذرّي.

---

## Chunk A: domain/classify.py — التصنيف الشهري + المنظوران

> يجسّد قرار المواصفة §4.1: التصنيف بـ **`OperationsType` + نوع الحساب المقابل**، مع عمود صيرفة مستقل (Type 7). الإدخال DataFrame خام (سند لكل صف بأعمدته)، الإخراج DataFrame شهري بالفئات.

### Task A1: تصنيف الحركات الشهرية

**Files:**
- Create: `app/domain/classify.py`
- Test: `tests/domain/test_classify.py`

- [ ] **Step 1: كتابة اختبار فاشل**

```python
# tests/domain/test_classify.py
import pandas as pd
from app.domain.classify import classify_monthly

def _bond(ym, optype, amt, to_type=None, from_type=None, cur=1):
    return {"year_month": ym, "OperationsType": optype, "Amount1": amt,
            "to_type": to_type, "from_type": from_type, "Currency1Id": cur}

def test_perspectives_and_categories():
    rows = [
        _bond("2026-04", 0, 100_000_000),                 # مقبوضات
        _bond("2026-04", 1, 30_000_000, to_type=2614),    # موردون
        _bond("2026-04", 1, 44_000_000, to_type=2518),    # سحوبات شركاء
        _bond("2026-04", 5, 5_000_000,  to_type=3121),    # أجور
        _bond("2026-04", 7, 40_000_000),                  # صيرفة
        _bond("2026-04", 3, 9_000_000),                   # تحويل داخلي (يُستبعد)
    ]
    out = classify_monthly(pd.DataFrame(rows)).set_index("year_month")
    r = out.loc["2026-04"]
    assert r["cash_in_m"] == 100.0
    assert r["out_suppliers_m"] == 30.0
    assert r["out_drawings_m"] == 44.0
    assert r["out_salaries_m"] == 5.0
    assert r["out_siyrafa_m"] == 40.0
    assert r["internal_transfers_m"] == 9.0
    # تشغيلي = موردون+سحوبات+مرتجعات+مشتريات+أجور+أخرى (بلا صيرفة)
    assert r["out_total_operational_m"] == 79.0
    # شامل = تشغيلي + صيرفة
    assert r["out_total_comprehensive_m"] == 119.0
    assert r["net_operating_m"] == 21.0      # 100 - 79
    assert r["net_total_m"] == -19.0         # 100 - 119
```

- [ ] **Step 2: تشغيل الاختبار للتأكد من فشله**

Run: `cd cashflow-web/backend && python -m pytest tests/domain/test_classify.py -v`
Expected: FAIL (`ModuleNotFoundError: app.domain.classify`).

- [ ] **Step 3: تنفيذ `classify.py`**

```python
# app/domain/classify.py
import pandas as pd

M = 1_000_000.0
def _sum(df, mask): return float(df.loc[mask, "Amount1"].sum()) / M

def classify_monthly(bonds: pd.DataFrame) -> pd.DataFrame:
    """bonds: صفوف خام تحوي year_month, OperationsType, Amount1, to_type, from_type, Currency1Id.
    يُعيد صفاً لكل شهر بالفئات والمنظورين A/C."""
    out = []
    for ym, g in bonds.groupby("year_month"):
        cash_in   = _sum(g, g.OperationsType == 0)
        suppliers = _sum(g, (g.OperationsType == 1) & (g.to_type == 2614))
        drawings  = _sum(g, (g.OperationsType == 1) & (g.to_type == 2518))
        refunds   = _sum(g, (g.OperationsType == 1) & (g.to_type == 1631))
        purchases = _sum(g, (g.OperationsType == 5) & (g.to_type == 3110))
        salaries  = _sum(g, (g.OperationsType == 5) & (g.to_type == 3121))
        other     = _sum(g, (g.OperationsType == 5) & (g.to_type.isin([3124, 2110])))
        siyrafa   = _sum(g, g.OperationsType == 7)
        internal  = _sum(g, g.OperationsType == 3)
        op  = suppliers + drawings + refunds + purchases + salaries + other
        comp = op + siyrafa
        out.append(dict(
            year_month=ym, cash_in_m=cash_in, out_suppliers_m=suppliers,
            out_drawings_m=drawings, out_refunds_m=refunds, out_purchases_m=purchases,
            out_salaries_m=salaries, out_other_m=other, out_siyrafa_m=siyrafa,
            internal_transfers_m=internal, out_total_operational_m=op,
            out_total_comprehensive_m=comp, net_operating_m=cash_in - op,
            net_total_m=cash_in - comp, bond_count=int(len(g))))
    return pd.DataFrame(out).sort_values("year_month").reset_index(drop=True)
```

- [ ] **Step 4: تشغيل الاختبار للتأكد من نجاحه**

Run: `python -m pytest tests/domain/test_classify.py -v` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/classify.py tests/domain/test_classify.py
git commit -m "feat(domain): monthly classification + A/C perspectives"
```

### Task A2: تسمية السنة المالية وعمود fiscal_year

**Files:**
- Modify: `app/domain/classify.py`
- Test: `tests/domain/test_classify.py`

- [ ] **Step 1: اختبار فاشل لـ fiscal_year (تبدأ مايو)**

```python
def test_fiscal_year_starts_may():
    from app.domain.classify import fiscal_year_label
    assert fiscal_year_label("2026-05") == "2026-2027"
    assert fiscal_year_label("2026-04") == "2025-2026"
```

- [ ] **Step 2: تشغيل للتأكد من الفشل** — Run: `python -m pytest tests/domain/test_classify.py::test_fiscal_year_starts_may -v` → FAIL.

- [ ] **Step 3: تنفيذ `fiscal_year_label` وإضافة العمود في `classify_monthly`**

```python
def fiscal_year_label(ym: str) -> str:
    y, m = map(int, ym.split("-")); s = y if m >= 5 else y - 1
    return f"{s}-{s+1}"
```
(وأضف `fiscal_year=fiscal_year_label(ym)` داخل dict المخرجات.)

- [ ] **Step 4: تشغيل كل اختبارات classify** — Run: `python -m pytest tests/domain/test_classify.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/classify.py tests/domain/test_classify.py
git commit -m "feat(domain): fiscal-year labeling (May start)"
```

---

## Chunk B: domain/forecast.py — التنبؤ الموسمي + backtest

> يجسّد §6: موسمي × CAGR مقيّد [−0.10, +0.15]، احتياطي شهري، وحساب MAPE بتدريب 2022–2024 وتنبؤ 2025-05→2026-04. منطق مستخرَج من `compute_seasonal_forecast` في `build_excel.py`.

### Task B1: التنبؤ الموسمي مع CAGR والاحتياطي

**Files:**
- Create: `app/domain/forecast.py`
- Test: `tests/domain/test_forecast.py`

- [ ] **Step 1: اختبار فاشل**

```python
# tests/domain/test_forecast.py
import pandas as pd
from app.domain.forecast import seasonal_forecast

def _series():
    # 36 شهراً ثابتة القيمة = 10 لكل شهر → CAGR=0، موسمي=10
    idx = [f"{y}-{m:02d}" for y in (2023, 2024, 2025) for m in range(1, 13)]
    return pd.Series([10.0]*36, index=idx)

def test_flat_series_forecasts_minus_reserve():
    fc = seasonal_forecast(_series(), horizon=12, reserve_m=2.0)
    assert len(fc.values) == 12
    # 10 × (1+0) − 2 = 8 لكل شهر
    assert all(abs(v - 8.0) < 1e-6 for v in fc.values)
    assert fc.index[0] == "2026-05"            # تبدأ مايو
    assert -0.10 <= fc.cagr <= 0.15
```

- [ ] **Step 2: تشغيل للفشل** — Run: `python -m pytest tests/domain/test_forecast.py -v` → FAIL.

- [ ] **Step 3: تنفيذ `forecast.py`** (دالة `seasonal_forecast(series, horizon, reserve_m, base_year=2026, fy_start=5) -> ForecastResult` تُعيد `index/values/cagr/mape`؛ تستخرج منطق CAGR من إجماليات السنوات المالية المقيّد، والموسمي من متوسط كل شهر تقويمي؛ تُولّد 12 شهراً من مايو). MAPE يُحسب في Task B2. **ملاحظة تنفيذ:** اشتقّ بداية التنبؤ من **آخر شهر تاريخي فعلي** في السلسلة (لا تثبّت 2026) تفادياً لتاريخ مُهردكَد (§4.2)؛ `base_year` افتراضي للاختبار فقط.

- [ ] **Step 4: تشغيل للنجاح** — Run: `python -m pytest tests/domain/test_forecast.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/forecast.py tests/domain/test_forecast.py
git commit -m "feat(domain): seasonal x CAGR forecast with reserve"
```

### Task B2: backtest وحساب MAPE + مؤشر الثقة

**Files:**
- Modify: `app/domain/forecast.py`
- Test: `tests/domain/test_forecast.py`

- [ ] **Step 1: اختبار فاشل لـ MAPE وثقة**

```python
def test_backtest_mape_and_confidence():
    from app.domain.forecast import backtest_mape, confidence_label
    s = _series()
    mape = backtest_mape(s)                 # سلسلة ثابتة → خطأ ~0%
    assert mape is not None and mape < 1.0
    assert confidence_label(10) == "عالية"
    assert confidence_label(40) == "متوسطة"
    assert confidence_label(80) == "منخفضة"
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `backtest_mape` (تدريب FY حتى 2024-2025 وتنبؤ 2025-05→2026-04 ومقارنة بالفعلي) و`confidence_label` (<25 عالية، <50 متوسطة، وإلا منخفضة).**

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/forecast.py tests/domain/test_forecast.py
git commit -m "feat(domain): backtest MAPE + confidence label"
```

---

## Chunk C: domain/allocation.py — توزيع المجمّع (مُعالَج لإزالة ازدواج الصيرفة)

> يجسّد قرار المالك (الخيار 1، §6): المجمّع يُطرح منه الصيرفة، ويُوزَّع على **موردي الدينار فقط**؛ الموردون الدولاريون لا يدخلون التوزيع.

### Task C1: حساب المجمّع وتوزيعه على موردي الدينار مع السقوف

**Files:**
- Create: `app/domain/allocation.py`
- Test: `tests/domain/test_allocation.py`

- [ ] **Step 1: اختبار فاشل (يتضمن منع الازدواج)**

```python
# tests/domain/test_allocation.py
from app.domain.allocation import compute_pool, allocate_dinar

def test_pool_subtracts_fixed_costs_and_siyrafa():
    pool = compute_pool(forecast_in=120, salaries=5, purchases=7, refunds=3,
                        partners=32, siyrafa=40, reserve=15)
    assert pool == 18.0

def test_allocation_excludes_dollar_suppliers():
    # موردان دينار (سقف 10 لكلٍّ) ومورد دولاري — الدولاري لا يأخذ شيئاً
    suppliers = [
        {"id": 1, "name": "دينار-أ", "currency": "IQD", "cap": 10, "share": 0.5},
        {"id": 2, "name": "دينار-ب", "currency": "IQD", "cap": 10, "share": 0.3},
        {"id": 3, "name": "الحافظ",  "currency": "USD", "cap": 40, "share": 0.2},
    ]
    res = allocate_dinar(pool_m=18, suppliers=suppliers)
    by = {a["id"]: a["allocated_m"] for a in res["alloc"]}
    assert by[3] == 0.0                       # الدولاري مستبعَد (يُموَّل عبر الصيرفة)
    assert abs((by[1] + by[2]) - 18.0) < 1e-6 # كل المجمّع على موردي الدينار
    assert res["leftover_m"] == 0.0
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `allocation.py`**

```python
# app/domain/allocation.py
def compute_pool(forecast_in, salaries, purchases, refunds, partners, siyrafa, reserve):
    return max(0.0, forecast_in - salaries - purchases - refunds - partners - siyrafa - reserve)

def allocate_dinar(pool_m: float, suppliers: list[dict]) -> dict:
    """يوزّع pool على موردي الدينار فقط (currency != 'USD') حسب الحصة، يطبّق السقف،
    يعيد توزيع الفائض على غير المكتمِلين، ويُخرج leftover. الدولاريون allocated=0."""
    dinar = [s for s in suppliers if s["currency"] != "USD"]
    wsum = sum(s["share"] for s in dinar) or 1.0
    alloc = {s["id"]: pool_m * s["share"] / wsum for s in dinar}
    # تطبيق السقوف + جمع الفائض
    overflow = 0.0
    for s in dinar:
        cap = s["cap"]
        if cap > 0 and alloc[s["id"]] > cap:
            overflow += alloc[s["id"]] - cap; alloc[s["id"]] = cap
    # إعادة توزيع الفائض (جولات محدودة) على من لم يبلغ سقفه
    for _ in range(6):
        if overflow <= 1e-9: break
        open_s = [s for s in dinar if s["cap"] == 0 or alloc[s["id"]] < s["cap"]]
        wo = sum(s["share"] for s in open_s)
        if wo <= 0: break
        for s in open_s:
            room = (s["cap"] - alloc[s["id"]]) if s["cap"] > 0 else overflow
            add = min(overflow * s["share"] / wo, room)
            alloc[s["id"]] += add; overflow -= add
    out = [{"id": s["id"], "name": s["name"], "currency": s["currency"],
            "allocated_m": round(alloc.get(s["id"], 0.0), 6)} for s in suppliers]
    distributed = sum(a["allocated_m"] for a in out)
    return {"alloc": out, "leftover_m": round(max(0.0, pool_m - distributed), 6)}
```

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/allocation.py tests/domain/test_allocation.py
git commit -m "feat(domain): pool allocation to dinar suppliers (no siyrafa double-count)"
```

---

## Chunk D: domain/alerts.py — توليد التنبيهات

> يجسّد §5.4 + §4.3: قواعد `liquidity_deficit`/`cap_exceeded`/`net_decline`/`expense_velocity`/`reconciliation_gap`/`etl_failure`.

### Task D1: قواعد توليد التنبيهات

**Files:**
- Create: `app/domain/alerts.py`
- Test: `tests/domain/test_alerts.py`

- [ ] **Step 1: اختبار فاشل**

```python
# tests/domain/test_alerts.py
from app.domain.alerts import generate_alerts

def test_liquidity_deficit_and_reconciliation_gap():
    ctx = {
        "forecast_net_by_month": {"2026-09": -5.0, "2026-10": 3.0},
        "neg_threshold_m": 0.0,
        "reconciliation_residual_m": 80.0, "reconciliation_threshold_m": 50.0,
        "cap_exceedances": [], "net_decline_pct": 0.10, "expense_velocity": 1.2,
    }
    alerts = generate_alerts(ctx)
    types = {a["alert_type"] for a in alerts}
    assert "liquidity_deficit" in types          # شهر 2026-09 سالب
    assert "reconciliation_gap" in types          # 80 > 50
    deficit = next(a for a in alerts if a["alert_type"] == "liquidity_deficit")
    assert deficit["severity"] == "danger" and "2026-09" in deficit["related_key"]
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `generate_alerts(ctx) -> list[dict]`** يطبّق القواعد ويُخرج dicts بحقول (`alert_type`, `severity`, `title`, `body`, `related_key`). قاعدة العجز: أي شهر `net < neg_threshold`؛ المطابقة: `residual > threshold`؛ التراجع/السرعة عند تجاوز عتبات معقولة.

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/domain/alerts.py tests/domain/test_alerts.py
git commit -m "feat(domain): alert generation rules"
```

---

## Chunk E: etl/extract.py — الاستخراج من SQL Server (قراءة فقط)

> اتصال **محقون** (لا اتصال جديد بكل نداء كما في `query_df` الحالي)، بمستخدم القراءة-فقط، وقطع زمني بتوقيت Asia/Baghdad.

### Task E1: دوال الاستخراج باتصال محقون وقطع زمني صحيح

**Files:**
- Create: `app/etl/extract.py`
- Test: `tests/etl/test_extract.py`

- [ ] **Step 1: اختبار فاشل لحساب القطع الزمني (Asia/Baghdad)**

```python
# tests/etl/test_extract.py
from datetime import datetime
from zoneinfo import ZoneInfo
from app.etl.extract import baghdad_today

def test_baghdad_today_is_utc_plus_3(monkeypatch):
    # 2026-06-01 23:30 UTC = 2026-06-02 02:30 بغداد → "اليوم" = 2026-06-02
    import app.etl.extract as ex
    monkeypatch.setattr(ex, "_utcnow", lambda: datetime(2026, 6, 1, 23, 30, tzinfo=ZoneInfo("UTC")))
    assert baghdad_today().isoformat() == "2026-06-02"
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `extract.py`**: `baghdad_today()` (يحوّل `_utcnow()` إلى Asia/Baghdad ويُعيد `date`)، ودوال `fetch_bonds(conn, start, end_exclusive)`, `fetch_balances(conn, kinds)`, `fetch_installments(conn)`, `fetch_avg_usd_rate(conn, asof)` — كلها تأخذ `conn` كوسيط وتعيد DataFrame، وتطبّق الفلاتر (`Deleted=0`, `ISNULL(IsEdit,0)=0`, `Date < end_exclusive`). تُعيد استخدام نصوص SQL من `build_excel.py` لكن مع join لجلب `to_type`/`from_type` (نوع الحساب المقابل) كما يتطلّب التصنيف.

- [ ] **Step 4: تشغيل للنجاح** → PASS (اختبار الوحدة للقطع الزمني؛ دوال الجلب تُختبر تكاملياً عند توفّر القاعدة).

- [ ] **Step 5: Commit**

```bash
git add app/etl/extract.py tests/etl/test_extract.py
git commit -m "feat(etl): read-only extraction with injected conn + Baghdad cutoff"
```

---

## Chunk F: etl/load.py + reconcile.py + pipeline.py — التحميل الذرّي والمطابقة والتنسيق

### Task F1: التحميل الذرّي (staging → swap)

**Files:**
- Create: `app/etl/load.py`
- Test: `tests/etl/test_load_swap.py`

- [ ] **Step 1: اختبار فاشل (القارئ لا يرى بيانات نصف-مبنية)**

```python
# tests/etl/test_load_swap.py — على Postgres اختبار
import pandas as pd
from sqlalchemy import create_engine, text
from app.config import settings
from app.etl.load import atomic_replace

def test_atomic_replace_swaps_in_one_txn():
    eng = create_engine(settings.postgres_url, future=True)
    df1 = pd.DataFrame([{"year_month": "2026-01", "cash_in_m": 1}])
    atomic_replace(eng, "monthly_cashflow", df1)
    df2 = pd.DataFrame([{"year_month": "2026-02", "cash_in_m": 2}])
    atomic_replace(eng, "monthly_cashflow", df2)         # استبدال كامل
    with eng.connect() as c:
        rows = c.execute(text("SELECT year_month FROM monthly_cashflow")).scalars().all()
    assert rows == ["2026-02"]                            # لا بقايا من التحميل السابق
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `atomic_replace(engine, table, df)`**: يكتب إلى `{table}_stg` ثم في معاملة واحدة: `TRUNCATE {table}; INSERT INTO {table} SELECT * FROM {table}_stg;` (أو تبديل أسماء). يضمن أن القارئ يرى دائماً الحالة القديمة حتى الـ COMMIT.

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/etl/load.py tests/etl/test_load_swap.py
git commit -m "feat(etl): atomic staging->swap loader"
```

### Task F2: تثبيت الرصيد الافتتاحي والمطابقة

**Files:**
- Create: `app/etl/reconcile.py`
- Test: `tests/etl/test_reconcile.py`

- [ ] **Step 1: اختبار فاشل**

```python
# tests/etl/test_reconcile.py
from app.etl.reconcile import running_balance, reconciliation_residual

def test_running_balance_anchored_to_opening():
    nets = [("2026-01", 5.0), ("2026-02", -2.0)]
    rb = running_balance(opening_m=100.0, monthly_nets=nets)
    assert rb["2026-01"] == 105.0 and rb["2026-02"] == 103.0

def test_reconciliation_residual():
    # (إغلاق−افتتاح) فعلي = 50، Σ صافي مُصنَّف = 47 → الفرق 3
    assert reconciliation_residual(actual_delta_m=50.0, classified_net_sum_m=47.0) == 3.0
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `running_balance(opening_m, monthly_nets)` و`reconciliation_residual(actual_delta_m, classified_net_sum_m)`.** الرصيد الافتتاحي: **يُفضَّل** من أرصدة `tAccounts` الفعلية (صناديق 1811/1812) عبر `etl/extract.fetch_balances`؛ وback-solve (الرصيد الحالي − Σ الصافي التاريخي) **بديل احتياطي فقط** (§4.3).

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/etl/reconcile.py tests/etl/test_reconcile.py
git commit -m "feat(etl): opening-balance anchor + reconciliation residual"
```

### Task F3: تنسيق ETL + سجل التشغيل + قفل أحادي

**Files:**
- Create: `app/etl/pipeline.py`
- Test: `tests/etl/test_pipeline.py`

- [ ] **Step 1: اختبار فاشل للقفل الأحادي**

```python
# tests/etl/test_pipeline.py
import pytest
from app.etl.pipeline import run_etl, ETLAlreadyRunning

def test_single_flight_lock(monkeypatch):
    # محاكاة وجود تشغيل قائم (status='running') → يرفض تشغيلاً ثانياً
    monkeypatch.setattr("app.etl.pipeline._has_running_etl", lambda session: True)
    with pytest.raises(ETLAlreadyRunning):
        run_etl(session=object(), conn=object())
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `run_etl(session, conn, today=None)`**: يتحقق من القفل (`_has_running_etl`)، يكتب `etl_runs(status='running', source_tz='Asia/Baghdad', source_max_date=today)`، ثم: extract → classify → forecast → allocation-inputs → reconcile → `atomic_replace` لكل جدول تحليلي → توليد التنبيهات → تحديث `etl_runs(status='success', opening_cash_m, reconciliation_residual_m, rows_loaded)`. عند الاستثناء: `status='failed'` + `error_message` + تنبيه `etl_failure`.

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/etl/pipeline.py tests/etl/test_pipeline.py
git commit -m "feat(etl): pipeline orchestration with run log + single-flight lock"
```

---

## Chunk G: etl/scheduler.py — الجدولة الليلية

### Task G1: APScheduler بتوقيت Asia/Baghdad

**Files:**
- Create: `app/etl/scheduler.py`
- Test: `tests/etl/test_scheduler.py`

- [ ] **Step 1: اختبار فاشل لإعداد المهمة**

```python
# tests/etl/test_scheduler.py
from app.etl.scheduler import build_scheduler

def test_daily_job_registered_in_baghdad_tz():
    sched = build_scheduler(run_at="02:00", tz="Asia/Baghdad", job=lambda: None)
    jobs = sched.get_jobs()
    assert len(jobs) == 1
    assert str(jobs[0].trigger.timezone) == "Asia/Baghdad"
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `build_scheduler(run_at, tz, job)`** بـ `BackgroundScheduler` و`CronTrigger(hour, minute, timezone=tz)`. لا يبدأ تلقائياً في الاختبار.

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/etl/scheduler.py tests/etl/test_scheduler.py
git commit -m "feat(etl): nightly scheduler (Asia/Baghdad)"
```

---

## نهاية الخطة 1

**المخرَج:** وحدات `domain` نقية مُختبَرة (تصنيف/تنبؤ/توزيع/تنبيهات تجسّد كل المعالجات المالية)، وخط ETL يملأ الجداول التحليلية بتحميل ذرّي مع رصيد مُثبَّت ومطابقة وقفل وجدولة. **اختبارات تكامل** (عند توفّر القاعدة): (1) تشغيل `run_etl` فعلي ومطابقة الإجماليات السنوية مع `CLAUDE.md`؛ (2) **اختبار انحدار Type 7**: التأكد أن الصيرفة محتسَبة ضمن المنظور الشامل (لا تتكرّر فجوة 391M المخفية، §11).

**التالي:** الخطة 2 — خلفية FastAPI.
