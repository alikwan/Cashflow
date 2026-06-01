# الخطة 4 — التكامل والنشر — خطة تنفيذ

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ربط كل الأنظمة في حزمة Docker Compose واحدة تعمل على الشبكة المحلية، وإضافة نسخ احتياطي/استعادة لقاعدة التطبيق، واختبارات شاملة (e2e) للمسار الكامل، وقائمة تحقّق يدوي تربط الأرقام بالواقع، ودليل تشغيل شهري.

**Architecture:** خدمات `backend`/`frontend`/`postgres` تنضم لشبكة المشروع القائمة `sqlserver-docker_default` مع حاوية `mssql` القائمة (للقراءة فقط). الجدولة مدموجة في الخلفية. نسخ احتياطي `pg_dump` لجداول التطبيق.

**Tech Stack:** Docker Compose، Dockerfiles (python-slim للخلفية، node→nginx للواجهة)، Playwright (e2e)، pg_dump/pg_restore، cron/مهمة مجدولة.

**المرجع:** المواصفة §9 (النشر)، §10 (غير الوظيفية)، §11 (الاختبار)، §4.3 (المطابقة)، §15 (المهام الإلزامية).

**تعتمد على:** الخطط 0–3 (مكتملة).

**هذه الخطة 4 من 5 (الأخيرة).**

---

## بنية الملفات (Plan 4)

```
cashflow-web/
├── backend/Dockerfile                # python-slim + uvicorn
├── frontend/Dockerfile               # node build → nginx static
├── docker/
│   ├── compose.cashflow.yml          # (تُحدَّث) postgres + backend + frontend
│   ├── nginx.conf                    # يخدم الواجهة + يمرّر /api للخلفية
│   └── backup/{backup.sh,restore.sh} # pg_dump/pg_restore لجداول التطبيق
├── e2e/
│   ├── playwright.config.js
│   └── tests/{login,navigate,edit-cap,rtl}.spec.js
└── docs/
    ├── RUNBOOK.md                    # التشغيل الشهري + استكشاف الأعطال
    └── verification-checklist.md     # تحقّق يدوي مقابل الواقع
```

---

## Chunk A: حاويات الخدمات + ربط Compose + الشبكة

### Task A1: Dockerfile للخلفية + تشغيلها مع المُجدوِل

**Files:**
- Create: `backend/Dockerfile`
- Modify: `docker/compose.cashflow.yml`
- Test: (تكامل) فحص صحّة الحاوية

- [ ] **Step 1: كتابة `backend/Dockerfile`** (python:3.12-slim، تثبيت التبعيات من `pyproject.toml`، تشغيل `uvicorn app.main:app` + بدء المُجدوِل عند الإقلاع).

- [ ] **Step 2: إضافة خدمة `backend` إلى compose** (تقرأ `.env`، تعتمد على `postgres`، تنضم لشبكة `sqlserver-docker_default`، تطبّق `alembic upgrade head` عند الإقلاع). **تحقّق من اسم خدمة SQL Server القابل للحلّ** (DNS على الشبكة يحلّ باسم **الخدمة** لا `container_name`): `docker compose -p sqlserver-docker -f /Users/ak/Documents/sqlserver-docker/docker-compose.yml config --services` — مؤكَّد حالياً أنه **`mssql`** (الحاوية `mssql-server`)، فاضبط `MSSQL_HOST` عليه. **القراءة-فقط تُفرَض بمستخدم `cashflow_ro`** (الخطة 0 B3) لا بعضوية الشبكة.

- [ ] **Step 3: التشغيل والتحقق من الصحّة**

Run:
```bash
cd "/Users/ak/Documents/sqlserver-docker/Monthly cash flow/cashflow-web"
docker compose -p sqlserver-docker --env-file .env -f docker/compose.cashflow.yml up -d backend
curl -fsS http://localhost:8000/api/health
```
Expected: `{"status":"ok"}`، وقدرة `backend` على الوصول لـ `mssql` (سجلّ ETL أول تشغيل ينجح).

- [ ] **Step 4: Commit**

```bash
git add backend/Dockerfile docker/compose.cashflow.yml
git commit -m "feat(deploy): backend container + scheduler + join mssql network"
```

### Task A2: Dockerfile للواجهة + nginx + التمرير للـ API

**Files:**
- Create: `frontend/Dockerfile`, `docker/nginx.conf`
- Modify: `docker/compose.cashflow.yml`

- [ ] **Step 1: كتابة `frontend/Dockerfile`** (مرحلة build: `npm ci && npm run build`؛ مرحلة nginx تخدم `dist/`).

- [ ] **Step 2: كتابة `nginx.conf`** (يخدم الملفات الثابتة، ويمرّر `/api/*` إلى `backend:8000`، ويعيد كل المسارات الأخرى إلى `index.html` لتوجيه SPA).

- [ ] **Step 3: إضافة خدمة `frontend` + التشغيل والتحقق**

Run:
```bash
docker compose -p sqlserver-docker --env-file .env -f docker/compose.cashflow.yml up -d --build frontend
curl -fsS http://localhost:8080/ | grep -q "<div id=\"root\""
```
Expected: الصفحة تُخدَم، و`/api/health` عبرها يعمل.

- [ ] **Step 4: Commit**

```bash
git add frontend/Dockerfile docker/nginx.conf docker/compose.cashflow.yml
git commit -m "feat(deploy): frontend container (nginx) + /api proxy"
```

---

## Chunk B: النسخ الاحتياطي والاستعادة

### Task B1: pg_dump لجداول التطبيق + استعادة موثّقة

**Files:**
- Create: `docker/backup/backup.sh`, `docker/backup/restore.sh`
- Test: `tests/etl/test_backup_roundtrip.py` (أو سكربت تحقّق)

- [ ] **Step 1: اختبار فاشل (دورة نسخ→حذف→استعادة تُرجع البيانات)**

```bash
# نمط الاختبار (يُنفَّذ يدوياً/في CI):
# 1) أدخل سيناريو + سقفاً  2) backup.sh  3) احذف الصفوف  4) restore.sh  5) تأكد رجوعها
```

- [ ] **Step 2: كتابة `backup.sh`** (`pg_dump` لجداول التطبيق فقط: `users,suppliers,supplier_caps,scenarios,assumptions,scenario_adjustments,payment_plans,payment_plan_lines,notes,alerts,app_settings,audit_log` — الجداول التحليلية تُستثنى لأنها تُعاد بناؤها؛ مع طابع زمني واحتفاظ N يوماً).

- [ ] **Step 3: كتابة `restore.sh`** (استعادة من ملف نسخة محدّد) + توثيق الإجراء في `docs/RUNBOOK.md`. (ملاحظة توثيقية: بعد الاستعادة وإعادة تشغيل ETL، يوفّق منطق §5.4 صفوف `alerts` دون تكرار — لا يُعَدّ ذلك تلفاً.)

- [ ] **Step 4: تشغيل دورة التحقق** — Expected: البيانات المُدخَلة تعود بعد الحذف والاستعادة.

- [ ] **Step 5: Commit**

```bash
git add docker/backup/ docs/RUNBOOK.md
git commit -m "feat(ops): app-tables pg_dump backup + documented restore"
```

---

## Chunk C: اختبارات e2e (المسار الكامل)

### Task C1: تهيئة Playwright + سيناريوهات أساسية

**Files:**
- Create: `e2e/playwright.config.js`, `e2e/tests/{login,navigate,edit-cap,rtl}.spec.js`

- [ ] **Step 1: كتابة اختبار e2e فاشل (دخول → لوحة)**

```js
// e2e/tests/login.spec.js
import { test, expect } from "@playwright/test";
test("login then dashboard renders KPIs", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("اسم المستخدم").fill("owner");
  await page.getByLabel("كلمة المرور").fill(process.env.E2E_PW);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByText("اللوحة التنفيذية")).toBeVisible();
  await expect(page.getByText(/مقبوضات السنة/)).toBeVisible();
});
```

> **ملاحظة:** حاذِ مُحدِّدات الـ e2e مع تسميات النموذج الفعلية في `Login.jsx` (الخطة 3)، و`E2E_PW` يجب أن تساوي كلمة مرور المستخدم `owner` المبذورة من `.env` (الخطة 2) — وثّق مصدرها في RUNBOOK.

- [ ] **Step 2: تشغيل للفشل** — Run: `cd cashflow-web/e2e && npx playwright test login` → FAIL (قبل رفع الحزمة).

- [ ] **Step 3: كتابة بقية السيناريوهات**: `navigate` (التنقّل بين الصفحات الثماني)، `edit-cap` (تعديل سقف مورد في الإعدادات → انعكاسه في صفحة الموردين)، `rtl` (اتجاه الصفحة RTL + الأرقام لاتينية). تشغيل الحزمة عبر `docker compose up` ثم `playwright test`.

- [ ] **Step 4: تشغيل للنجاح** → PASS (كل السيناريوهات).

- [ ] **Step 5: Commit**

```bash
git add cashflow-web/e2e/
git commit -m "test(e2e): login, navigation, edit-cap propagation, RTL"
```

---

## Chunk D: التحقّق اليدوي مقابل الواقع + إيقاف القديم

### Task D1: قائمة تحقّق يدوي للسيولة + مطابقة الإجماليات

**Files:**
- Create: `docs/verification-checklist.md`

- [ ] **Step 1: تشغيل ETL فعلي ومقارنة الإجماليات السنوية بـ `CLAUDE.md`**

Run: `POST /api/etl/run` ثم راجع `/api/dashboard` و`/api/cashflow/monthly`. قارن إجماليات السنوات المالية (IN/OUT/net) بالأرقام في `CLAUDE.md` ووثّق أي فرق.

- [ ] **Step 2: تحقّق المالك اليدوي للرصيد**

وثّق في `verification-checklist.md`: مقارنة `current_cash_m` وفرق المطابقة (`reconciliation_residual_m`) بما يعرفه المالك فعلياً عن أرصدة الصناديق (هذا هو التحقّق اليدوي العام المتّفق عليه — §4.3). سجّل العتبة المقبولة للفرق.

- [ ] **Step 3: تأكيد اختبار انحدار Type 7**

تأكد أن الصيرفة تظهر في المنظور الشامل وأن الفجوة السنوية لا تقترب من "391M مخفية".

- [ ] **Step 4: Commit**

```bash
git add docs/verification-checklist.md
git commit -m "docs(verify): manual liquidity/balance + annual totals checklist"
```

### Task D2: إيقاف الأداة القديمة وتحديث المراجع

**Files:**
- Modify: `analysis/sql/02_monthly_cashflow.sql` (وسم/إيقاف)، `CLAUDE.md`

- [ ] **Step 1: وسم `02_monthly_cashflow.sql` كمُلغى** (طريقة عضوية الصندوق التي تُسقط الصيرفة — §4.1) بتعليق في رأس الملف يحيل إلى منطق `domain/classify.py`.

- [ ] **Step 2: تحديث `CLAUDE.md`** بإضافة قسم يشير إلى أن النظام الويب أصبح المخرَج الأساسي، مع مواقع المواصفة والخطط، وأن `build_excel.py` بقي كمولّد Excel/مرجع منطق فقط.

- [ ] **Step 3: Commit**

```bash
git add analysis/sql/02_monthly_cashflow.sql CLAUDE.md
git commit -m "chore: deprecate cash-box SQL + point CLAUDE.md to web system"
```

---

## Chunk E: دليل التشغيل (Runbook)

### Task E1: RUNBOOK للتشغيل الشهري والأعطال

**Files:**
- Modify: `docs/RUNBOOK.md`

- [ ] **Step 1: توثيق التشغيل**: كيفية رفع الحزمة (`docker compose -p sqlserver-docker ... up -d`)، الوصول (`http://<host>:8080`)، تشغيل ETL يدوياً، قراءة حالة ETL، أخذ نسخة احتياطية/استعادة، واستكشاف أعطال شائعة (mssql متوقف، فشل ETL، فرق مطابقة كبير).

- [ ] **Step 2: قائمة "التشغيل الشهري"**: الخطوات الدورية للمالك (مراجعة التنبيهات، خطة الدفع، التصدير).

- [ ] **Step 3: Commit**

```bash
git add docs/RUNBOOK.md
git commit -m "docs(ops): runbook for monthly operation + troubleshooting"
```

---

## نهاية الخطة 4 (واكتمال المشروع)

**المخرَج:** نظام كامل قابل للنشر بأمر واحد على الشبكة المحلية، مع نسخ احتياطي/استعادة، اختبارات e2e للمسار الكامل، تحقّق يدوي موثّق يربط الأرقام بالواقع، وإيقاف الأداة القديمة، ودليل تشغيل. **بهذا تكتمل الخطط الخمس** وتصبح حزمة التخطيط جاهزة للتنفيذ بالكامل.
