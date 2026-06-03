# برومبت الجلسة القادمة — الخطة 2 (خلفية FastAPI)

> انسخ ما تحت الخط إلى بداية الجلسة الجديدة.

---

أكمل بناء **نظام ويب لإدارة السيولة النقدية لمعرض البيت السعيد**. جلسة **استئناف** — **الخطتان 0 و1 مكتملتان** (الأساس + الـ ETL يملأ القاعدة فعلياً). ابدأ **الخطة 2 (خلفية FastAPI)**. نفّذ عبر **`superpowers:subagent-driven-development`** مع الالتزام بعد كل مهمة على فرع `cashflow-web`.

## اقرأ أولاً (إلزامي قبل أي كود)
- **الذاكرة التلقائية** `cashflow-web-project.md` (تُحمَّل تلقائياً — فيها كل الحالة والقرارات والمتبقّي والدروس).
- **خطة الخطة 2:** `docs/superpowers/plans/2026-06-02-phase2-backend-api.md`
- **المواصفة:** `docs/superpowers/specs/2026-06-01-cashflow-web-system-design.md` (§5 الخلفية، §8 الأمان، §12 خريطة `data.js`→API).
- **عقد بيانات الواجهة:** `design-reference/project/src/data.js` (شكل المفاتيح التي تتوقّعها الواجهة — نقاط القراءة يجب أن تطابقها).
- مرجع MSSQL/الأقساط عند اللزوم: DC-System `app/Services/ExternalData/Drivers/MssqlDriver.php`.

## الحالة (فرع `cashflow-web`، ~33 التزاماً، شجرة نظيفة)
- ✅ **الخطة 0:** Postgres + مخطّط 20 جدولاً + هجرة Alembic + مستخدم `cashflow_ro` قراءة-فقط + `.env`.
- ✅ **الخطة 1:** وحدات `domain/` نقية (classify/forecast/allocation/alerts) + خط `etl/` كامل (extract/load/reconcile/pipeline/scheduler). **قاعدة `cashflow` مملوءة** بالجداول السبعة (34 اختباراً تنجح).
- ✅ **مراجعة معمارية/أمنية:** تحميل ذرّي عبر الجداول (معاملة واحدة) + لقطات تاريخية تتراكم + استبعاد الشهر الجزئي + ربط Postgres بـ`127.0.0.1` + تنظيف ملفات Excel.

## ابدأ الخطة 2 بهذا الترتيب
0. **أولاً (مؤجّل من الخطة 1، لازم):** **زرع جدول `suppliers` بالـ14 مورّداً** (account_id + العملة IQD/USD/MIX + السقوف). المصدر: `pipeline.SUPPLIER_ACCOUNTS` + `analysis/build_excel.py:SUPPLIERS`. بدونه: التوزيع/السقوف/تنبيه `cap_exceeded` بلا بيانات.
1. **نقاط القراءة (§5.1)** تطابق مفاتيح `data.js`: `/api/meta`, `/api/dashboard`, `/api/cashflow/monthly`, `/api/breakdown`, `/api/suppliers`, `/api/installments`, `/api/forecast`, `/api/supplier-plan`. (تقرأ الجداول التحليلية المملوءة + تستدعي `domain` للتوزيع/التنبؤ.)
2. **المصادقة (§5.3):** جلسة كوكي HttpOnly + تجزئة argon2/bcrypt + بذر المستخدم الأول من `.env` + كبح محاولات الدخول.
3. **نقاط الكتابة (§5.2):** suppliers/caps · scenarios/assumptions · payment-plans (+reconcile) · notes · alerts/ack · settings — مع مغلّف أخطاء JSON موحّد + 409 + `audit_log`.
4. **تشغيل ETL:** `POST /api/etl/run` + `GET /api/etl/status` (القفل الأحادي جاهز) + جدولة `scheduler.build_scheduler` ليلاً.
5. **تصدير** Excel/PDF.

## عالِجها في/قبل الخطة 2 (من المراجعة — مدوّنة في الذاكرة)
- **قائمة جداول مسموحة** في `etl/load.py` (حقن كامن) قبل أن تلمسه أي مدخلات مستخدم.
- **قيود فرادة:** `scenario_adjustments(scenario_id,series_key,year_month)` · `supplier_caps(supplier_id,effective_from)` · `payment_plan_lines(payment_plan_id,supplier_id)` · سيناريو أساسي واحد (partial unique على `is_baseline`). (هجرة جديدة.)
- **ربط `audit_log`** بكل كتابة إدارية · **مُحقّق `app_secret_key`** غير فارغ قبل الجلسات.
- `numpy` لـ pyproject · لفّ pymssql بـ SQLAlchemy (تحذير DBAPI2) · فئة `OpType=1&to_type=2110` (سحب رأس مال ~14M مُهمَل).

## قرارات مثبّتة (لا تغيّرها دون إذن المالك)
FastAPI + React/Vite · مستخدم واحد محلي · ETL ليلي → PostgreSQL منفصلة · `AlBaytAlSaeid` قراءة فقط · التصنيف `OperationsType` + الحساب المقابل (يلتقط الصيرفة) · الصيرفة الخيار 1 (توزيع لموردي الدينار فقط) · Asia/Baghdad · تحميل ذرّي.

## ⚠️ دروس حرجة (لا تكرّرها)
- **الأقساط:** `PremiumPays.Amount` = الرصيد المتبقّي لا المدفوع (DC-System)؛ قائم ≈1.26–1.32B. **لا منطق `build_excel.py` المقلوب.**
- `Amount1` بالدينار — **لا تضربه بـ `Rate1`**. فلتر `Deleted=0` و`IsEdit=0` واستبعد المستقبلية.
- الرصيد الافتتاحي سالب (back-solve + نقص بيانات الصناديق)؛ `reconciliation_residual_m=0` حتى تتراكم لقطات `balances_snapshot` (يصير حقيقياً تلقائياً مع الزمن). اعرض الرصيد الجاري كاتجاه نسبي لا رقماً مطلقاً.

## ⏸️ مؤجّل للإنتاج (بقرار المالك — لا تنفّذه الآن)
كلمة مرور SA المكشوفة (`build_excel.py:29` + تاريخ git) → تدوير + نقل لـ`.env` + `git filter-repo` (يمسح أيضاً تاريخ ملفات Excel دفعةً). وربط MSSQL على مستوى الشبكة/جدار الحماية (برنامج المحاسبة يصله عبر LAN).

## البيئة
- venv بـ **python3.12** في `cashflow-web/backend/.venv` (شغّل: `cd cashflow-web/backend && .venv/bin/python -m pytest`).
- Postgres: حاوية `cashflow-postgres` على `127.0.0.1:5433` (قاعدتان: `cashflow` مملوءة + `cashflow_test`). MSSQL: `mssql-server`، مستخدم `cashflow_ro`.
- الأسرار في `cashflow-web/.env` (غير متعقّب). تشغيل ETL يدوياً: `from app.etl.pipeline import run_etl; from app.etl.extract import connect_mssql` + session لـ `settings.postgres_url`.
- تأكّد أولاً: `docker ps | grep -E 'mssql-server|cashflow-postgres'`.
