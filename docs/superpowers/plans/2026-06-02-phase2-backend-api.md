# الخطة 2 — خلفية FastAPI — خطة تنفيذ

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** بناء واجهة FastAPI تخدم نقاط القراءة بنفس شكل بيانات `data.js` (ليتبنّاها الفرونت دون تغيير)، ونقاط الكتابة الإدارية (سقوف/سيناريوهات/خطط دفع/ملاحظات/تنبيهات/إعدادات) مع تدقيق وقيود تعارض، ومصادقة بجلسة كوكي HttpOnly، وتصدير Excel/PDF، ونقاط تشغيل ETL.

**Architecture:** FastAPI + SQLAlchemy session كاعتمادية (dependency)، طبقة `api/routers/*` رفيعة تستدعي `domain/*` (الخطة 1) وتقرأ الجداول التحليلية، ومغلّف استجابة/أخطاء موحّد. لا منطق أعمال في الراوترات.

**Tech Stack:** FastAPI، Starlette sessions/cookies، SQLAlchemy 2.x، pydantic، openpyxl (تصدير Excel، يعيد استخدام تنسيق `build_excel.py`)، WeasyPrint (PDF)، pytest + httpx TestClient.

**المرجع:** المواصفة §5 (نقاط API)، §7.5 (طبقة api-client)، §8 (المصادقة)، و`design-reference/project/src/data.js` (مرجع الحقول). **مهم:** الـ API يستخدم مخطّط **snake_case** نظيفاً وثابتاً؛ وطبقة `api-client`/hooks في الخطة 3 تُطابقه مع أسماء مكوّنات `data.js` (camelCase/المتداخلة) — كما تسمح المواصفة §7.5. لا يُطلب من الـ API إصدار أسماء `data.js` حرفياً.

**تعتمد على:** الخطة 0 (المخطّط) + الخطة 1 (`domain` + الجداول التحليلية مملوءة).

**هذه الخطة 2 من 5.**

---

## بنية الملفات (Plan 2)

```
cashflow-web/backend/app/
├── main.py                     # إنشاء تطبيق FastAPI + تركيب الراوترات + معالج الأخطاء
├── api/
│   ├── __init__.py
│   ├── deps.py                 # get_session, get_current_user
│   ├── errors.py               # مغلّف أخطاء JSON موحّد + استثناءات
│   ├── schemas.py              # نماذج pydantic للطلب/الاستجابة
│   ├── auth.py                 # تسجيل دخول/خروج/me + بذر المستخدم + كبح
│   ├── export.py               # تصدير Excel/PDF
│   └── routers/
│       ├── meta.py  dashboard.py  cashflow.py  breakdown.py  suppliers.py
│       ├── installments.py  forecast.py  supplier_plan.py
│       ├── scenarios.py  payment_plans.py  notes.py  alerts.py  settings.py
│       └── etl.py
└── tests/api/
    ├── conftest.py             # TestClient + قاعدة اختبار مُهيّأة ببيانات صغيرة
    ├── test_auth.py  test_read_endpoints.py  test_write_endpoints.py
    ├── test_export.py  test_etl_endpoints.py
```

> **حدود الوحدات:** كل راوتر ملف مستقل بمسؤولية مورد واحد. `deps.py` يوفّر الجلسة والمستخدم. `errors.py` المصدر الوحيد لشكل الأخطاء. منطق الأعمال يبقى في `domain/`.

---

## Chunk A: الهيكل + الجلسة + مغلّف الأخطاء

### Task A1: تطبيق FastAPI + اعتمادية الجلسة + معالج أخطاء موحّد

**Files:**
- Create: `app/main.py`, `app/api/deps.py`, `app/api/errors.py`
- Test: `tests/api/conftest.py`, `tests/api/test_health.py`

- [ ] **Step 1: اختبار فاشل لنقطة صحّة + شكل خطأ موحّد**

```python
# tests/api/test_health.py
def test_health_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}

def test_unknown_resource_uses_error_envelope(client):
    r = client.get("/api/does-not-exist")
    assert r.status_code == 404
    body = r.json()
    assert set(body["error"]) >= {"code", "message"}     # مغلّف موحّد
```

```python
# tests/api/conftest.py
import pytest
from fastapi.testclient import TestClient

@pytest.fixture
def client(tmp_path, monkeypatch):
    # قاعدة اختبار SQLite + إنشاء المخطّط + بيانات صغيرة
    from app.db.base import Base
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    eng = create_engine(f"sqlite:///{tmp_path/'t.db'}", future=True)
    import app.db.models  # noqa
    Base.metadata.create_all(eng)
    TestingSession = sessionmaker(bind=eng, future=True)
    from app.main import create_app
    from app.api.deps import get_session
    app = create_app()
    app.dependency_overrides[get_session] = lambda: TestingSession()
    return TestClient(app)

@pytest.fixture
def auth(client, seed_user):
    """يسجّل الدخول ويُعيد كوكي الجلسة — يُمرَّر عبر cookies= (لا headers=)."""
    client.post("/api/auth/login", json={"username": "owner", "password": "secret"})
    return {"session": client.cookies["session"]}

# fixtures seed_user / seed_analytics / seed_suppliers / seed_alerts تملأ القاعدة ببيانات صغيرة
# وتُعرَّف في هذا الـ conftest حسب حاجة كل اختبار (مستخدم owner، أشهر تحليلية، 14 مورداً، تنبيهات).
```

- [ ] **Step 2: تشغيل للفشل** — Run: `cd cashflow-web/backend && python -m pytest tests/api/test_health.py -v` → FAIL.

- [ ] **Step 3: تنفيذ `errors.py` (استثناء `ApiError(code, message, status)` + معالج يحوّله إلى `{"error": {...}}`)، `deps.py` (`get_session` yields SessionLocal)، `main.py` (`create_app()` يركّب المعالج ونقطة `/api/health`).**

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/main.py app/api/deps.py app/api/errors.py tests/api/
git commit -m "feat(api): app skeleton + session dep + unified error envelope"
```

---

## Chunk B: المصادقة (جلسة كوكي HttpOnly)

### Task B1: تسجيل الدخول/الخروج/me + بذر المستخدم + كبح المحاولات

**Files:**
- Create: `app/api/auth.py`, `app/api/routers/__init__.py`
- Test: `tests/api/test_auth.py`

- [ ] **Step 1: اختبار فاشل**

```python
# tests/api/test_auth.py
def test_login_sets_cookie_and_me_works(client, seed_user):
    bad = client.post("/api/auth/login", json={"username": "owner", "password": "wrong"})
    assert bad.status_code == 401 and "error" in bad.json()
    ok = client.post("/api/auth/login", json={"username": "owner", "password": "secret"})
    assert ok.status_code == 200 and "session" in ok.cookies
    me = client.get("/api/auth/me")
    assert me.json()["username"] == "owner"

def test_me_requires_auth(client):
    assert client.get("/api/auth/me").status_code == 401
```

(يضاف fixture `seed_user` يبذر مستخدماً `owner` بتجزئة `secret`.)

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `auth.py`**: `POST /api/auth/login` (يتحقق بـ argon2، يضبط كوكي جلسة HttpOnly موقّع بـ `APP_SECRET_KEY`)، `POST /api/auth/logout`، `GET /api/auth/me`؛ `get_current_user` في `deps.py` (يرفع 401 إن لا جلسة)؛ بذر المستخدم الأول من `.env`؛ كبح بسيط (عدّاد محاولات لكل IP/مستخدم).

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/auth.py app/api/deps.py tests/api/test_auth.py
git commit -m "feat(api): HttpOnly session auth + user seeding + throttle"
```

---

## Chunk C: نقاط القراءة (بشكل data.js)

> **عقد الـ API:** الـ API يستخدم مخطّط **snake_case** نظيفاً وثابتاً (كما في اختبارات العقد أدناه)؛ وطبقة `api-client`/hooks في الخطة 3 تُطابقه مع أسماء مكوّنات `data.js` (camelCase/المتداخلة) — تسمح بذلك المواصفة §7.5. اختبار العقد يثبّت **مفاتيح الـ API الـ snake_case** (لا أسماء data.js حرفياً).

### Task C1: meta + dashboard

**Files:**
- Create: `app/api/routers/meta.py`, `app/api/routers/dashboard.py`, `app/api/schemas.py`
- Test: `tests/api/test_read_endpoints.py`

- [ ] **Step 1: اختبار فاشل لعقد البيانات**

```python
# tests/api/test_read_endpoints.py
def test_meta_contract(client, seed_analytics, auth):
    r = client.get("/api/meta", cookies=auth)
    body = r.json()
    assert {"usd_rate", "current_cash_m", "reserve_m", "fy_start", "last_etl"} <= set(body)

def test_dashboard_contract(client, seed_analytics, auth):
    b = client.get("/api/dashboard", cookies=auth).json()
    assert {"fy_totals", "net_decline_pct", "installments", "alerts", "monthly_series", "expense_mix"} <= set(b)

import pytest
@pytest.mark.parametrize("path", ["/api/meta", "/api/dashboard", "/api/suppliers", "/api/forecast", "/api/settings"])
def test_protected_endpoints_require_auth(client, path):
    assert client.get(path).status_code == 401          # بلا جلسة → مرفوض
```

(fixtures: `seed_analytics` يملأ جداول تحليلية صغيرة؛ `auth` كوكي جلسة صالح.)

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `meta.py` و`dashboard.py`** يقرآن من الجداول التحليلية + `domain` (مؤشرات `agg/netDecline/expenseVelocity`). كل النقاط محميّة بـ `get_current_user`.

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/routers/meta.py app/api/routers/dashboard.py app/api/schemas.py tests/api/test_read_endpoints.py
git commit -m "feat(api): meta + dashboard read endpoints (data.js contract)"
```

### Task C2: cashflow/monthly + breakdown + suppliers + installments

**Files:**
- Create: `app/api/routers/{cashflow,breakdown,suppliers,installments}.py`
- Test: `tests/api/test_read_endpoints.py` (إضافة)

- [ ] **Step 1: اختبار فاشل لكل نقطة (مفاتيح + المنظور)**

```python
def test_cashflow_monthly_perspective(client, seed_analytics, auth):
    r = client.get("/api/cashflow/monthly?perspective=comprehensive", cookies=auth).json()
    assert "months" in r and "forecast" in r and "by_fiscal_year" in r
    assert {"year_month", "cash_in_m", "out_total_m", "net_total_m"} <= set(r["months"][0])

def test_suppliers_contract(client, seed_analytics, auth):
    s = client.get("/api/suppliers", cookies=auth).json()["suppliers"][0]
    assert {"id", "name", "cap", "currency", "monthly", "over_cap", "balance_m"} <= set(s)
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ الراوترات الأربعة** (تقرأ الجداول التحليلية وتشكّلها بأسماء `data.js`؛ `perspective` يبدّل عمود الإجمالي بين operational/comprehensive).

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/routers/cashflow.py app/api/routers/breakdown.py app/api/routers/suppliers.py app/api/routers/installments.py tests/api/test_read_endpoints.py
git commit -m "feat(api): cashflow/breakdown/suppliers/installments read endpoints"
```

### Task C3: forecast + supplier-plan (تعتمد domain)

**Files:**
- Create: `app/api/routers/{forecast,supplier_plan}.py`
- Test: `tests/api/test_read_endpoints.py` (إضافة)

- [ ] **Step 1: اختبار فاشل (يشمل أن الموردين الدولاريين خارج توزيع المجمّع)**

```python
def test_supplier_plan_excludes_dollar_suppliers(client, seed_analytics, auth):
    r = client.get("/api/supplier-plan?month=2026-05", cookies=auth).json()
    assert {"pool_m", "alloc", "leftover_m"} <= set(r)
    dollar = [a for a in r["alloc"] if a["currency"] == "USD"]
    assert all(a["allocated_m"] == 0 for a in dollar)     # تجسيد الخيار 1

def test_forecast_contract(client, seed_analytics, auth):
    r = client.get("/api/forecast?scenarioId=1", cookies=auth).json()
    assert {"forecast", "cash_paths", "fc_totals", "scenarios", "mape", "confidence"} <= set(r)
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ الراوترين** باستدعاء `domain.forecast`/`domain.allocation` على الجداول التحليلية + الفرضيات النشطة؛ `forecast` يرفق `mape`/`confidence`.

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/routers/forecast.py app/api/routers/supplier_plan.py tests/api/test_read_endpoints.py
git commit -m "feat(api): forecast + supplier-plan endpoints via domain"
```

---

## Chunk D: نقاط الكتابة الإدارية (+ تدقيق + تعارض)

### Task D1: السقوف المؤرّخة + السيناريوهات + الفرضيات

**Files:**
- Create: `app/api/routers/{suppliers,scenarios}.py` (إضافة كتابة), `app/api/audit.py`
- Test: `tests/api/test_write_endpoints.py`

- [ ] **Step 1: اختبار فاشل (إنشاء سقف مؤرّخ + قيد فرادة السيناريو)**

```python
# tests/api/test_write_endpoints.py
def test_create_supplier_cap_is_historized_and_audited(client, seed_suppliers, auth):
    r = client.post("/api/suppliers/1/caps", json={"monthly_cap_m": 12, "effective_from": "2026-06-01"}, cookies=auth)
    assert r.status_code == 201
    # السقف الساري الآن 12 + قيد تدقيق مُسجّل
    assert client.get("/api/suppliers", cookies=auth).json()["suppliers"][0]["cap"] == 12

def test_duplicate_active_scenario_conflict(client, auth):
    client.post("/api/scenarios", json={"name": "base", "kind": "base"}, cookies=auth)
    dup = client.post("/api/payment-plans", json={"year_month": "2026-05", "scenario_id": 1}, cookies=auth)
    dup2 = client.post("/api/payment-plans", json={"year_month": "2026-05", "scenario_id": 1}, cookies=auth)
    assert dup2.status_code == 409 and dup2.json()["error"]["code"] == "conflict"
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ نقاط الكتابة** (`POST /suppliers/{id}/caps` ينشئ صفاً مؤرّخاً؛ CRUD السيناريوهات والفرضيات)؛ `audit.py` يسجّل قبل/بعد في `audit_log`؛ التعارض يرفع 409 عبر `ApiError`.

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/routers/suppliers.py app/api/routers/scenarios.py app/api/audit.py tests/api/test_write_endpoints.py
git commit -m "feat(api): historized caps + scenarios/assumptions + audit log"
```

### Task D2: خطط الدفع + المطابقة + الملاحظات + التنبيهات + الإعدادات

**Files:**
- Create: `app/api/routers/{payment_plans,notes,alerts,settings}.py`
- Test: `tests/api/test_write_endpoints.py` (إضافة)

- [ ] **Step 1: اختبار فاشل (reconcile يملأ المنفّذ، ack يغيّر الحالة، settings تنتشر)**

```python
def test_payment_plan_reconcile_fills_actuals(client, seed_analytics, auth):
    client.post("/api/scenarios", json={"name": "base", "kind": "base"}, cookies=auth)
    pid = client.post("/api/payment-plans", json={"year_month": "2026-04", "scenario_id": 1}, cookies=auth).json()["id"]
    r = client.post(f"/api/payment-plans/{pid}/reconcile", cookies=auth).json()
    assert all("actual_paid_m" in line for line in r["lines"])     # مملوءة من per_supplier_monthly

def test_alert_ack(client, seed_alerts, auth):
    a = client.get("/api/alerts", cookies=auth).json()["alerts"][0]
    client.post(f"/api/alerts/{a['id']}/ack", cookies=auth)
    assert client.get("/api/alerts", cookies=auth).json()["alerts"][0]["status"] == "read"
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ الراوترات** (خطط الدفع + `/{id}/reconcile` idempotent يملأ `actual_paid_m`/`variance_m` من `per_supplier_monthly`؛ `notes` GET/POST/DELETE؛ `alerts` GET + `/{id}/ack`؛ `settings` GET/PUT).

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/routers/payment_plans.py app/api/routers/notes.py app/api/routers/alerts.py app/api/routers/settings.py tests/api/test_write_endpoints.py
git commit -m "feat(api): payment-plans+reconcile, notes, alerts ack, settings"
```

---

## Chunk E: التصدير (Excel/PDF)

### Task E1: تصدير Excel (إعادة استخدام تنسيق build_excel) + PDF

**Files:**
- Create: `app/api/export.py`, `app/api/routers` (تركيب `/api/export/*`)
- Test: `tests/api/test_export.py`

- [ ] **Step 1: اختبار فاشل**

```python
# tests/api/test_export.py
def test_export_excel_returns_xlsx(client, seed_analytics, auth):
    r = client.get("/api/export/excel", cookies=auth)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert r.content[:2] == b"PK"                      # توقيع ملف xlsx
    assert "attachment" in r.headers.get("content-disposition", "")   # اسم تنزيل مضبوط

def test_export_pdf_returns_pdf(client, seed_analytics, auth):
    r = client.get("/api/export/pdf", cookies=auth)
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `export.py`** (يبني المصنّف من الجداول التحليلية بإعادة استخدام دوال التنسيق من `build_excel.py`؛ PDF عبر WeasyPrint من قالب HTML للملخص). يردّ `StreamingResponse`.

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/export.py tests/api/test_export.py
git commit -m "feat(api): Excel + PDF export endpoints"
```

---

## Chunk F: نقاط تشغيل ETL

### Task F1: تشغيل ETL يدوي + الحالة

**Files:**
- Create: `app/api/routers/etl.py`
- Test: `tests/api/test_etl_endpoints.py`

- [ ] **Step 1: اختبار فاشل (يرفض تشغيلاً متزامناً)**

```python
# tests/api/test_etl_endpoints.py
def test_etl_run_rejects_when_already_running(client, auth, monkeypatch):
    monkeypatch.setattr("app.etl.pipeline._has_running_etl", lambda s: True)
    r = client.post("/api/etl/run", cookies=auth)
    assert r.status_code == 409 and r.json()["error"]["code"] == "etl_running"

def test_etl_status_shape(client, auth):
    s = client.get("/api/etl/status", cookies=auth).json()
    assert {"status", "last_run_at", "reconciliation_residual_m"} <= set(s)
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `etl.py`** (`POST /api/etl/run` يستدعي `etl.pipeline.run_etl` ويحوّل `ETLAlreadyRunning` إلى 409؛ `GET /api/etl/status` يقرأ آخر `etl_runs`). يُفضَّل تشغيل الـ ETL في خلفية (BackgroundTasks) وإرجاع 202.

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/routers/etl.py tests/api/test_etl_endpoints.py
git commit -m "feat(api): manual ETL trigger + status"
```

---

## نهاية الخطة 2

**المخرَج:** واجهة FastAPI كاملة: مصادقة بجلسة كوكي، نقاط قراءة بعقد `data.js`، نقاط كتابة إدارية بتدقيق وتعارض، تصدير Excel/PDF، وتشغيل ETL. كل النقاط مغطّاة باختبارات عقد عبر TestClient.

**التالي:** الخطة 3 — واجهة React/Vite.
