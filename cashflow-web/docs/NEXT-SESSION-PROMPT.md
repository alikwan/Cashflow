# برومبت الجلسة القادمة — الخطة 3 (واجهة React/Vite)

> ⚠️ **مُتجاوَز (2026-06-09):** الخطتان 3 و4 **منجزتان** — الواجهة بُنيت (PR `alikwan/Cashflow#1`)
> والنظام منشور عبر Docker. هذا الملف أرشيفي. للحالة الحالية انظر `CLAUDE.md` §0 و`cashflow-web/docs/RUNBOOK.md`.

> انسخ ما تحت الخط إلى بداية الجلسة الجديدة.

---

أكمل بناء **نظام ويب لإدارة السيولة النقدية لمعرض البيت السعيد**. جلسة **استئناف** — **الخطط 0 و1 و2 مكتملة** (الأساس + ETL يملأ القاعدة + خلفية FastAPI كاملة ومُختبَرة ومُدخَّنة حيّاً). ابدأ **الخطة 3 (واجهة React/Vite)**. نفّذ عبر **`superpowers:subagent-driven-development`** مع الالتزام بعد كل مهمة على فرع `cashflow-web`.

## اقرأ أولاً (إلزامي قبل أي كود)
- **الذاكرة التلقائية** `cashflow-web-project.md` (تُحمَّل تلقائياً — فيها كل الحالة والقرارات والمتبقّي والدروس).
- **خطة الخطة 3:** `docs/superpowers/plans/2026-06-02-phase3-frontend.md` (5 أجزاء A–E، بنية الملفات، اختبارات Vitest+MSW).
- **المواصفة §7** (الواجهة الأمامية)، و**§7.5** (التحوّلات عن النموذج: data.js→api-client، التعديل السريع، شارة MAPE، شاشة الدخول).
- **المرجع البصري الملزم:** `design-reference/project/src/` (نظام التصميم `colors_and_type.css`، `Shell.jsx`/`Primitives.jsx`/`Charts.jsx`، الصفحات الثماني، `data.js` كعقد بيانات، `tweaks-panel.jsx`) + لقطات `design-reference/project/screenshots/`.

## الحالة (فرع `cashflow-web`، شجرة نظيفة، ~51 التزاماً)
- ✅ **الخطة 0:** Postgres + مخطّط 20 جدولاً + هجرة Alembic + `cashflow_ro` + `.env`.
- ✅ **الخطة 1:** وحدات `domain/` نقية + خط `etl/` كامل؛ قاعدة `cashflow` مملوءة.
- ✅ **الخطة 2 (خلفية FastAPI):** **37 مساراً · 250 اختباراً ينجح · دُخّنت حيّاً ضد Postgres الحقيقي.** المغلّف الموحّد للأخطاء، مصادقة كوكي HttpOnly + argon2 + throttle، تدقيق `audit_log`، تصدير Excel/PDF (خط عربي مضمّن)، تشغيل ETL + جدولة ليلية. **الـ API كله snake_case ثابت.**

## 🔑 الـ API الذي ستستهلكه الواجهة (الخطة 2)
- **قراءة:** `GET /api/meta · /api/dashboard · /api/cashflow/monthly?perspective=comprehensive|operational · /api/breakdown · /api/suppliers · /api/installments · /api/forecast?scenario_id= · /api/supplier-plan?month=YYYY-MM&scenario_id=`
- **مصادقة:** `POST /api/auth/login {username,password}` (يضبط كوكي `session` HttpOnly) · `POST /api/auth/logout` · `GET /api/auth/me`. غير المصادَق → **401 بمغلّف** `{"error":{"code":"unauthorized","message":...}}`.
- **كتابة:** `POST /api/suppliers/{account_id}/caps` · scenarios CRUD + `PUT /api/scenarios/{id}/assumptions` · payment-plans CRUD + `POST /api/payment-plans/{id}/reconcile` · notes GET/POST/DELETE · `POST /api/alerts/{id}/ack` · `GET/PUT /api/settings`. التعارض → **409** `code:"conflict"`؛ التحقّق → **422**.
- **ETL/تصدير:** `POST /api/etl/run` (202/409) · `GET /api/etl/status` · `GET /api/export/excel` · `GET /api/export/pdf`.
- **مغلّف الأخطاء موحّد** لكل 401/404/409/422/500 → `{"error":{"code","message"}}`. `api/client.js` يحوّل 4xx/5xx لاستثناء يحمل `status`+`error`، و401 → `AuthError`.
- **بيانات الدخول (للتطوير):** `owner` / كلمة المرور في `cashflow-web/.env` (`APP_OWNER_PASSWORD`). create_app يرفض `APP_SECRET_KEY` الفارغ.

## ⚠️ أول قرار في الخطة 3 — CORS / الوصول من المتصفّح
الخلفية **لا تحوي CORS عمداً**. عند تطوير Vite (منفذ 5173، أصل مختلف عن الخلفية) **لن تُرسَل كوكي الجلسة عبر الأصول**. الخياران:
- **(مُفضَّل للتطوير)** **Vite dev proxy:** في `vite.config.js` وجّه `/api` إلى الخلفية (مثل `server.proxy['/api'] = 'http://127.0.0.1:8000'`) — يصبح same-origin من منظور المتصفّح، الكوكي يعمل، **بلا تعديل خلفية**.
- **(بديل)** أضِف `CORSMiddleware(allow_credentials=True, allow_origins=["http://localhost:5173"])` في `app/main.py`. **للإنتاج:** nginx يخدم بناء React + الـ API خلف نفس المضيف (same-origin، §9) — لا CORS.
استخدم `credentials:"include"` في كل نداءات `fetch`.

## ابدأ الخطة 3 بهذا الترتيب (Chunks A–E)
- **A1 — السقالة:** Vite+React، نسخ `colors_and_type.css` حرفياً، `index.html` بـ`<html dir="rtl" lang="ar">`، خطوط Cairo/Tajawal. (اختبار دخان: التطبيق يُركّب + `document.dir==="rtl"`.)
- **B1 — `api/client.js`:** fetch موحّد (`credentials:"include"`، يفكّ مغلّف الأخطاء، 401→`AuthError`). **B2 — `AuthContext` + `Login.jsx` + حارس المسارات** (يستدعي `/api/auth/me` عند الإقلاع؛ لا مستخدم → شاشة دخول).
- **C1 — نقل `Primitives.jsx`+`Charts.jsx`+`lib/format.js`** (تحويل `window.*`→`export`، إبقاء الأنماط بكسلياً). **C2 — نقل `Shell.jsx`** (قائمة يمنى بالصفحات الثماني + Header + بحث + جرس تنبيهات؛ تُغذّى من API).
- **D1 — `api/hooks.js`** (`useDashboard/useCashflow/useSuppliers/...` تعيد `{data,loading,error}`). **🔑 طبقة التطابق:** الـ hooks تحوّل مفاتيح snake_case → أسماء المكوّنات (camelCase/المتداخلة: `s.cur`/`s.overCap`/`pool`/`m.in`/`negThreshold`↔`neg_threshold_m`…). مساعد اختبار مشترك `renderWithProviders`+MSW في `tests/setup.js`. **D2** اللوحة+الشهري+المقبوضات/المصروفات. **D3** الموردون+الأقساط+التنبؤ (شارة MAPE/الثقة)+توزيع الموردين.
- **E1 — الإعدادات** (حفظ عبر `PUT /api/settings` و`/api/suppliers/{id}/caps`) + **`TweaksPanel` داخلية متاحة دائماً** (لا أداة postMessage) + **Toasts** عبر سياق React (`ToastHost`، لا `window.showToast`).

## ⚠️ دروس حرجة تنتقل للواجهة (لا تكرّرها)
- **توزيع الموردين (الخيار 1):** الموردون الدولاريون (الحافظ/المهندس/ميديا فوكس/الريان) `allocated_m=0` ويُعرَضون كـ **«مموَّلون عبر الصيرفة»** لا حصة من المجمّع. لا تنسخ `allocate()` من `data.js` حرفياً في `SupplierPlan.jsx` — الدلالات تغيّرت.
- **الأقساط:** القائم الحقيقي ≈**1.3 مليار** (لا 4.67) — اعرض ما تُرجعه `/api/installments` كما هو.
- **الرصيد الجاري:** الافتتاحي سالب (back-solve) — اعرضه **كاتجاه نسبي لا رقماً مطلقاً** حتى تتراكم لقطات الأرصدة.
- **شارة MAPE/الثقة** على صفحة التنبؤ (عالية/متوسطة/منخفضة) كي لا تُقرأ التوقعات كحقائق.
- RTL + أرقام لاتينية + `tabular-nums`؛ احترم `prefers-reduced-motion`.

## قرارات مثبّتة (لا تغيّرها دون إذن المالك)
FastAPI + React/Vite · مستخدم واحد محلي · ETL ليلي → PostgreSQL منفصلة · `AlBaytAlSaeid` قراءة فقط · التصنيف `OperationsType`+الحساب المقابل · الصيرفة الخيار 1 · Asia/Baghdad · `design-reference/` مرجع بصري ملزم (pixel-parity).

## ⏸️ مؤجّل للإنتاج (بقرار المالك — لا تنفّذه الآن)
كلمة مرور SA المكشوفة (`build_excel.py:29` + تاريخ git) → تدوير + `.env` + `git filter-repo`. ربط MSSQL على مستوى الشبكة/جدار الحماية. (الخطة 4 = docker-compose الكامل + نسخ احتياطي/استعادة + e2e + نشر.)

## البيئة
- **الخلفية:** `cashflow-web/backend/.venv` (python3.12). شغّلها للواجهة: `cd cashflow-web/backend && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`. الاختبارات: `.venv/bin/python -m pytest` (250 تنجح).
- **الواجهة (ستُنشأ):** `cashflow-web/frontend/` (Vite). الاختبارات: `npm test` (Vitest+RTL+MSW).
- **Docker:** `cashflow-postgres` على `127.0.0.1:5433` (قاعدة `cashflow` مملوءة + `cashflow_test`) · `mssql-server`. تأكّد أولاً: `docker ps | grep -E 'mssql-server|cashflow-postgres'`.
- الأسرار في `cashflow-web/.env` (غير متعقّب).
