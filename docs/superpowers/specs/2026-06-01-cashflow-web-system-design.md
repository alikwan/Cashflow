# وثيقة مواصفات: نظام ويب لإدارة السيولة النقدية — معرض البيت السعيد

> **الحالة**: مُراجَعة (عدستا أنظمة + تقارير مالية/محاسبية) ومُعالَجة — جاهزة لخطة التنفيذ | **التاريخ**: 2026-06-01 | **المالك**: علي السامرائي (ali_alsamrae89@yahoo.com)
> **المرجع**: تبني هذه الوثيقة على `CLAUDE.md` (نموذج البيانات والمنطق المحاسبي) وعلى حزمة تصميم الواجهة المُسلَّمة في `design-reference/`.

---

## 1. المقدمة والأهداف

### 1.1 الغاية
تحويل أداة تحليل السيولة الحالية (سكربت Python `analysis/build_excel.py` يولّد ملف Excel من 15 ورقة، يُشغّل يدوياً شهرياً) إلى **نظام ويب تفاعلي لإدارة القرارات** يستخدمه مالك المعرض لمتابعة السيولة، إدارة سقوف الموردين، بناء سيناريوهات تنبؤ، تخطيط المدفوعات الشهرية، وتلقّي تنبيهات السيولة.

### 1.2 معايير النجاح
- لوحات تفاعلية تحلّ محل ملف Excel، تعرض 48 شهراً تاريخياً + 12 شهراً متوقعاً.
- إدخال وحفظ قرارات الإدارة (سقوف، سيناريوهات، خطط دفع، ملاحظات) في قاعدة خاصة بالتطبيق دون أي مساس بقاعدة المحاسبة.
- التصنيف وفق طريقة واحدة معتمدة (**`OperationsType` + نوع الحساب المقابل**) تلتقط الصيرفة (Type 7)، مع الفلاتر المعتمدة في `CLAUDE.md`.
- **مطابقة سيولة (tie-out)**: صافي التدفق المُصنَّف يقارب تغيّر أرصدة الصناديق الفعلية، ويُبرَز الفرق لدعم تحقّق المالك اليدوي.
- تصدير تقرير Excel/PDF عند الطلب.
- زمن استجابة الصفحات < ثانية (بفضل اللقطة الليلية المسبقة الحساب).

### 1.3 القرارات المعتمدة (من جلسة العصف الذهني)

| المحور | القرار |
|--------|--------|
| طبيعة النظام | نظام إدارة قرارات (عرض + إدخال بيانات خاصة بالتطبيق؛ قاعدة المحاسبة للقراءة فقط) |
| المستخدمون | مستخدم واحد (المالك) — مصادقة بسيطة |
| الاستضافة | محلي / شبكة محلية، على نفس جهاز Docker الحالي |
| حداثة البيانات | تحديث مجدول ليلي (ETL) + زر تحديث يدوي |
| القاعدة المحاسبية | منتج محاسبي خارجي، قراءة فقط، لا تعديل على مخطّطها |
| ما يُدار | سقوف/خطط الموردين، سيناريوهات + فرضيات، خطة دفع شهرية + متابعة، ملاحظات + إقرار تنبيهات |
| نموذج التنبؤ | موسمي×CAGR افتراضي + Prophet اختياري للمقارنة |
| المخرجات | عرض ويب + تصدير Excel/PDF عند الطلب |
| الإطلاق | النظام كامل دفعة واحدة (مع بناء داخلي متدرّج لإدارة المخاطر) |
| تفصيل الفروع | إجمالي الآن، تصميم البيانات يسمح بتفصيل الصناديق السبعة لاحقاً |
| الحماية | تسجيل دخول بسيط (مستخدم/كلمة مرور) + جلسة آمنة |
| التنبيهات | داخل التطبيق فقط (لا بريد/واتساب في النسخة الأولى) |
| طبقة الويب (المعمارية) | **البديل ب**: FastAPI (خلفية) + React/Vite (واجهة) |
| الواجهة الأمامية | تُعتمد حزمة التصميم المُسلَّمة (`design-reference/`) كمصدر الحقيقة للواجهة |
| طريقة التصنيف | `OperationsType` + نوع الحساب المقابل (تلتقط الصيرفة Type 7)؛ يُلغى تصنيف عضوية الصندوق |
| معالجة الصيرفة في التوزيع | تبقى بنداً (= تمويل الموردين الدولاريين)؛ التوزيع الشهري لموردي الدينار فقط — بلا ازدواج |
| رصيد الصندوق | مُثبَّت على رصيد `tAccounts` الافتتاحي الحقيقي + مطابقة تدعم التحقّق اليدوي للمالك |

---

## 2. المعمارية

### 2.1 المكوّنات (من المصدر إلى المستخدم)

```
البرنامج المحاسبي التجاري
        │ (يكتب)
        ▼
SQL Server: AlBaytAlSaeid        ← قراءة فقط، لا نعدّل مخطّطها، نفس جهاز Docker
        │
        │  مهمة ETL ليلية (Python: pymssql + pandas، تعيد استخدام منطق build_excel.py بعد استخراجه — §4.4)
        ▼
PostgreSQL (Docker)
        ├── جداول تحليلية   (يكتبها ETL، التطبيق يقرأها)
        └── جداول التطبيق   (يكتبها المستخدم عبر API)
        │  (SQLAlchemy + Alembic)
        ▼
FastAPI (خلفية Python)  — REST/JSON، تنبؤ، توزيع، تنبيهات، تصدير Excel/PDF، مصادقة
        │  (HTTP/JSON عبر الشبكة المحلية)
        ▼
React/Vite (واجهة عربية RTL + رسوم SVG)
        ▼
المالك — متصفّح على الشبكة المحلية

المُجدوِل (APScheduler داخل الخلفية، أو cron) → يشغّل ETL ليلاً ثم يعيد توليد التنبيهات.
```

### 2.2 القرار المعماري الجوهري — الفصل التام
- قاعدة المحاسبة `AlBaytAlSaeid` **للقراءة فقط**؛ يلمسها ETL فقط ضمن استعلامات `SELECT`. لا يكتب التطبيق فيها إطلاقاً.
- قاعدة التطبيق PostgreSQL منفصلة، فيها مجموعتان لا تتداخلان: جداول تحليلية (يعيد ETL بناءها) وجداول التطبيق (كتابات المستخدم). هذا يمنع أي تعارض بين التحديث الليلي وكتابات المستخدم، ويحمي البيانات المحاسبية تماماً.

### 2.3 الوحدات وحدودها (Units & boundaries)
| الوحدة | المسؤولية | المدخلات | المخرجات |
|--------|-----------|----------|----------|
| `etl` | استخراج وتحويل وتحميل | قراءة من SQL Server | كتابة الجداول التحليلية + سجل `etl_runs` |
| `domain` (منطق مشترك) | منطق التنبؤ والتوزيع والتنبيهات | جداول تحليلية + فرضيات | سلاسل تنبؤ، توزيع موردين، قائمة تنبيهات |
| `api` (FastAPI) | عرض REST + مصادقة + تصدير | الجداول + `domain` | JSON بشكل يطابق `data.js` |
| `web` (React) | عرض وتفاعل | API | واجهة المستخدم |
| `scheduler` | جدولة ETL | الوقت | تشغيل `etl` + إعادة توليد التنبيهات |

كل وحدة قابلة للفهم والاختبار باستقلال؛ `domain` لا يعرف شيئاً عن HTTP؛ `web` لا يعرف شيئاً عن SQL.

---

## 3. نموذج البيانات (PostgreSQL)

> كل المبالغ تُخزَّن بوحدة **مليون دينار** (M) كما في `build_excel.py` و`data.js`، عدا الحقول المعلّمة صراحةً.

### 3.1 الجداول التحليلية (يكتبها ETL؛ تُعاد بناؤها كل ليلة)

**`etl_runs`** — سجل تشغيل ETL
| عمود | نوع | ملاحظة |
|------|-----|--------|
| id | bigserial PK | |
| started_at, finished_at | timestamptz | |
| status | text | `running` / `success` / `failed` |
| source_max_date | date | أحدث تاريخ سند مُعالَج (لاستبعاد المستقبلية) |
| rows_loaded | int | |
| usd_rate_used | numeric | متوسط Rate1 آخر 12 شهر |
| error_message | text | عند الفشل |
| opening_cash_m | numeric | الرصيد الافتتاحي المُثبَّت من `tAccounts` |
| reconciliation_residual_m | numeric | فرق المطابقة: (إغلاق−افتتاح فعلي) − Σ(صافي مُصنَّف) |
| source_tz | text | المنطقة الزمنية المعتمدة (`Asia/Baghdad`) |

**`monthly_cashflow`** — صف لكل شهر تاريخي (نافذة 48 شهراً)
`year_month text PK ('YYYY-MM')`, `cash_in_m`, `out_suppliers_m`, `out_drawings_m`, `out_refunds_m`, `out_purchases_m`, `out_salaries_m`, `out_other_m`, `out_siyrafa_m`, `internal_transfers_m`, `out_total_operational_m`, `out_total_comprehensive_m`, `net_operating_m`, `net_total_m`, `cash_running_m`, `bond_count int`, `fiscal_year text`. كل المبالغ `numeric`. (`cash_running_m` مُثبَّت على الرصيد الافتتاحي الحقيقي من `tAccounts` — §4.3، لا رقم مفترض.)

**`per_supplier_monthly`** — `(supplier_account_id int, year_month text)` PK مركّب، `paid_m`, `paid_iqd_m`, `paid_usd_m`, `recv_m`.

**`balances_snapshot`** — PK مركّب **`(snapshot_date, account_id, currency_id)`** (الحسابات الدولارية لها صف لكل عملة)، `account_name text`, `account_kind text` (`supplier`/`cashbox`/`debtor`/`partner`), `balance_m`, `balance_iqd_m`, `last_active date`. تُحفظ اللقطات تاريخياً.

**`installments_summary`** — `snapshot_date date PK`, `premium_count int`, `total_committed_m`, `paid_m`, `remaining_m`.

**`installments_aging`** — PK مركّب **`(snapshot_date, bucket_key)`** (`current`/`b0_30`/`b31_60`/`b61_90`/`b91_120`/`b120`), `label text`, `amount_m`, `count int`. تُحسب من تواريخ استحقاق `Premiums`/`PremiumPays` (مرهون بالتحقق §15)؛ **يفرض ETL** Σ(amount_m) = `installments_summary.remaining_m`.

**`seasonal_index`** — `series_key text`, `fm_pos int (0..11)` PK مركّب، `avg_value_m`. (الموضع الشهري المالي: أيار=0 … نيسان=11)

**`forecast_base`** — `series_key text`, `year_month text`, `engine text` (`seasonal`/`prophet`) PK مركّب، `value_m`, `cagr numeric`, `mape numeric`.

> `series_key ∈ { cash_in, out_suppliers, out_drawings, out_refunds, out_purchases, out_salaries, out_other, out_siyrafa }`.

### 3.2 جداول التطبيق (يكتبها المستخدم؛ لا يلمسها ETL)

**`users`** — `id`, `username unique`, `password_hash`, `display_name`, `is_active bool`, `created_at`, `last_login`.

**`suppliers`** — سجل الموردين القابل للتحرير (يُزرَع بالـ14 الحاليين)
`id PK`, `account_id int unique` (المعرّف المحاسبي), `name text`, `currency text` (`IQD`/`USD`/`MIX`), `display_order int`, `active bool`, `created_at`.

**`supplier_caps`** — سقوف مؤرّخة (لا تعديل في المكان)
`id PK`, `supplier_id FK→suppliers`, `monthly_cap_m`, `plan_low_m`, `plan_high_m`, `user_monthly_m`, `effective_from date`, `created_by FK→users`, `created_at`. السقف الساري = أحدث صف `effective_from ≤ today`.

**`scenarios`** — `id PK`, `name text`, `kind text` (`base`/`optimistic`/`pessimistic`/`custom`), `is_baseline bool`, `description text`, `created_by`, `created_at`.

**`assumptions`** — فرضيات عامة أو خاصة بسيناريو
`id PK`, `scenario_id FK→scenarios NULLABLE` (NULL = الافتراضات العامة), `usd_rate numeric`, `unexpected_reserve_m numeric`, `income_growth_pct numeric`, `in_growth_factor numeric`, `out_growth_factor numeric`, `cagr_floor numeric`, `cagr_cap numeric`, `forecast_horizon int`, `fiscal_year_start_month int`, `forecast_engine text`, `updated_at`. قيد فريد: صف عام وحيد (`scenario_id IS NULL`) + صف واحد لكل سيناريو (partial unique index) — لمنع فرضيات ملتبسة تغذّي التنبؤ.

**`scenario_adjustments`** — `id PK`, `scenario_id FK`, `series_key text`, `adjust_pct numeric NULLABLE`, `override_value_m numeric NULLABLE`, `year_month text NULLABLE` (NULL = كل الأشهر).

**`payment_plans`** — رأس الخطة الشهرية
`id PK`, `year_month text`, `scenario_id FK`, `pool_for_suppliers_m`, `reserve_m`, `status text` (`draft`/`approved`), `created_by`, `created_at`, `approved_at NULLABLE`. قيد فريد `(year_month, scenario_id)`.

**`payment_plan_lines`** — سطر لكل مورد
`id PK`, `payment_plan_id FK`, `supplier_id FK`, `planned_m`, `cap_applied_m`, `allocated_m`, `actual_paid_m` (يُملأ من `per_supplier_monthly` للشهر), `variance_m` (= allocated − actual).

**`notes`** — تعليقات متعددة الأهداف
`id PK`, `target_type text` (`month`/`supplier`/`alert`/`scenario`/`dashboard`), `target_key text`, `body text`, `created_by`, `created_at`.

**`alerts`** — تنبيهات مُولّدة + حالة الإقرار
`id PK`, `alert_type text` (`liquidity_deficit`/`cap_exceeded`/`net_decline`/`expense_velocity`/`reconciliation_gap`/`etl_failure`), `severity text` (`info`/`warning`/`danger`), `title text`, `body text`, `related_key text` (شهر أو معرّف مورد), `generated_at`, `status text` (`new`/`read`/`resolved`), `acknowledged_by NULLABLE`, `acknowledged_at NULLABLE`.

**`app_settings`** — إعدادات واجهة المستخدم المفردة (تقابل إعدادات `localStorage` في النموذج)
`id PK (=1)`, `accent text` (`أزرق`/`كحلي`/`أخضر`), `show_alert bool`, `neg_threshold_m numeric`, `over_cap_warn bool`, `updated_at`. (الفرضيات المالية في `assumptions`؛ هنا تفضيلات العرض.)

**`audit_log`** — `id PK`, `user_id FK`, `action text`, `entity text`, `entity_id text`, `before_json jsonb`, `after_json jsonb`, `at timestamptz`.

### 3.3 العلاقات
- `suppliers 1—* supplier_caps` (تأريخ)
- `suppliers 1—* payment_plan_lines *—1 payment_plans`
- `scenarios 1—* assumptions / scenario_adjustments / payment_plans`
- `per_supplier_monthly` يغذّي `payment_plan_lines.actual_paid_m` (مخطّط مقابل منفّذ)

---

## 4. خط ETL

### 4.1 طريقة التصنيف المعتمدة (مصدر حقيقة واحد)
- التصنيف يعتمد **`OperationsType` + نوع الحساب المقابل** (نهج `build_excel.py`) — الطريقة الوحيدة التي تلتقط **الصيرفة (Type 7)**.
- `analysis/sql/02_monthly_cashflow.sql` (تصنيف عضوية الصندوق، يُسقط الصيرفة) **مُلغىً** ولا يُعاد استخدامه؛ يُحذف أو يُعاد كتابته ليطابق الطريقة المعتمدة — تفادياً لخطأ "391M المخفية" الذي حذّر منه `CLAUDE.md`.
- وصف الواجهة لطريقة التصنيف يُحرّر ليطابق الطريقة الفعلية.

### 4.2 السلوك والتحميل الذرّي
- **idempotent**: يُبنى كل تحميل في جداول **staging** (`*_stg`)، ثم **تبديل ذرّي** في معاملة واحدة (swap/RENAME)؛ القرّاء يرون دائماً آخر لقطة سليمة، ولا يرون جداول نصف-مبنية. (هذا يثبت وعد "استجابة <1s من لقطة متّسقة".)
- يستبعد السندات المستقبلية والمحذوفة (`Deleted=1`) والمعدّلة (`IsEdit=1`) وفق `CLAUDE.md`.
- **المنطقة الزمنية**: "اليوم" ونافذة الاستبعاد (`Date > today`) وتجميع الأشهر تُحسب بتوقيت **Asia/Baghdad** (UTC+3) صراحةً وتُمرّر كوسيط مربوط، ويُحفظ القطع في `etl_runs.source_max_date`. (لا يُهردكد التاريخ كما يفعل السكربت الحالي.)
- **قفل تشغيل أحادي**: الجدولة الليلية وزر "تحديث الآن" لا يتعارضان (advisory lock / حارس `status='running'`؛ يُرفض تشغيل يدوي أثناء تشغيل قائم).
- يحسب الفئات الست + الصيرفة + التحويلات الداخلية والمنظورين A (الشامل) وC (الاقتصادي)؛ يسجّل النتيجة في `etl_runs` مع تسجيل مُهيكل (توقيت كل خطوة + عدد صفوف كل جدول).
- يحسب `seasonal_index` و`forecast_base` (محرّك `seasonal` افتراضياً، و`prophet` إن فُعّل في الفرضيات).

### 4.3 تثبيت الرصيد ومطابقة السيولة (تدعم تحقّق المالك اليدوي)
- **الرصيد الافتتاحي**: يُثبَّت من أرصدة صناديق `tAccounts` الفعلية (`AccountTypeId IN (1811,1812)`) عند بداية النافذة، أو back-solve = الرصيد الحالي − Σ الصافي التاريخي. منه يُحسب `cash_running_m` ومسارات التنبؤ — لا من رقم مفترض.
- **مطابقة (tie-out)**: خطوة تقارن (إغلاق − افتتاح) لأرصدة الصناديق الفعلية بـ Σ(صافي مُصنَّف) لكل فترة، وتحفظ الفرق في `etl_runs.reconciliation_residual_m`، وتُبرزه على صفحة التدقيق + تنبيه عند تجاوز عتبة. **هذه أداة تساعد المالك في تحقّقه اليدوي العام للسيولة والرصيد — لا بوابة آلية صارمة تمنع التشغيل.**

### 4.4 إعادة هيكلة المنطق القابل لإعادة الاستخدام (Refactor — خطوة لازمة)
"إعادة استخدام `build_excel.py`" تتطلب استخراجاً فعلياً، لأن الواقع الحالي:
- `get_*` و`compute_seasonal_forecast` قابلة للاستيراد ✔️، لكن **`allocate_to_suppliers` مدفونة داخل `main()`**، ومنطق التنبؤ-لكل-مورد وخطة السداد inline داخل `main()`، و`query_df` يفتح اتصالاً جديداً بكل نداء بـ `DB` مثبّت.
- يُستخرَج المنطق إلى وحدات نقية قابلة للاستيراد والاختبار: `domain/classify.py`، `domain/forecast.py`، `domain/allocation.py`، مع **حقن الاتصال** (connection/transaction).
- **View B (الدينار النقي) غير موجود فعلياً** في السكربت (سطر 1323: `out_b = out_c`)؛ خارج النطاق في النسخة الأولى (المنظوران A وC يكفيان لاحتياج المالك)، ويُبنى لاحقاً كاستعلام `Currency1Id=1` مستقل — ولا يُقدَّم كموجود.

### 4.5 الجدولة والتشغيل اليدوي والأقساط
- **APScheduler** بتوقيت Asia/Baghdad يشغّل ETL يومياً (افتراضياً 02:00).
- `POST /api/etl/run` يدوي (محميّ بالقفل الأحادي)؛ الحالة عبر `GET /api/etl/status`.
- بعد كل تشغيل ناجح: تُولَّد التنبيهات (§5.4) وتُجرى المطابقة (§4.3).
- **الشركاء (`PARTNERS`)**: تُشتق سحوبات الشركاء من حسابات نوع `2518` وتبقى مُصنَّفة كسحوبات (ليست مصاريف تشغيلية)؛ تمييز الثلاثة بالاسم يتطلب فحص الحسابات الفعلية (مهمة تحقّق إلزامية §15)، وإلا تُعرض كإجمالي.
- **أعمار الأقساط (`installments_aging`)**: تتطلب التحقق من حقول تاريخ الاستحقاق في `Premiums`/`PremiumPays` (مهمة تحقّق إلزامية §15). يفرض ETL Σ(الشرائح) = `remaining_m`؛ وإن لم توجد حقول استحقاق، يُكتفى برقم "متبقٍ" واحد بدل شرائح مُختلقة.

---

## 5. الخلفية — FastAPI

### 5.1 نقاط القراءة (تطابق شكل `data.js` ليتبنّاها الواجهة دون تغيير بنية البيانات)
| نقطة | تُعيد |
|------|-------|
| `GET /api/meta` | سعر الصرف الحالي، الرصيد الحالي، احتياطي افتراضي، بداية السنة المالية، معلومات آخر ETL |
| `GET /api/dashboard` | مؤشرات السنوات المالية، تراجع الصافي، الأقساط، التنبيهات النشطة، سلسلة الرسم، تركيب المصروفات |
| `GET /api/cashflow/monthly?perspective=` | `months[]` + `forecast[]` + جدول لكل سنة مالية (منظور: شامل/تشغيلي/دينار نقي) |
| `GET /api/breakdown` | فئات متراكمة شهرياً، الشركاء، الصناديق السبعة |
| `GET /api/suppliers` | الموردون + `monthly[]` + `overCap` + `balance` + `util` + السقف الساري |
| `GET /api/installments` | الإجمالي، أعمار الديون، كبار المدينين |
| `GET /api/forecast?scenarioId=` | `forecast[]`، `cashPaths`، `fcTotals`، `SCENARIOS`، `MAPE` |
| `GET /api/supplier-plan?month=&scenarioId=` | نتيجة التوزيع (المجمّع، التوزيع بعد السقوف، الفائض) + مخطّط مقابل منفّذ |

> جميع نقاط القراءة تُعيد السلاسل الكاملة المحدودة (60 شهراً، 14 مورداً) دون ترقيم صفحات (pagination) — مقصود لمستخدم محلي واحد؛ لا يُضاف ترقيم.

### 5.2 نقاط الكتابة (إدارة)
- `GET/POST/PUT /api/suppliers` و `POST /api/suppliers/{id}/caps` (إنشاء سقف مؤرّخ جديد).
- `GET/POST/PUT/DELETE /api/scenarios` و `PUT /api/scenarios/{id}/assumptions`.
- `GET/POST/PUT /api/payment-plans` (+ الأسطر)؛ `POST /api/payment-plans/{id}/reconcile` لملء المنفّذ من `per_supplier_monthly`.
- `GET/POST/DELETE /api/notes` (الملاحظات قابلة للحذف؛ بينما `supplier_caps` يبقى append-only مؤرّخاً بالتصميم).
- `GET /api/alerts`، `POST /api/alerts/{id}/ack`.
- `GET/PUT /api/settings` (تفضيلات العرض + الفرضيات العامة).

> الكتابات تستخدم **مغلّف أخطاء JSON موحّد** و**409 عند التعارض**؛ عمليتا `caps` و`reconcile` **idempotent**، و`payment_plans` فريد `(year_month, scenario_id)`.

### 5.3 المصادقة والتشغيل
- **جلسة كوكي HttpOnly** (مُعتمدة بدل JWT لمستخدم محلي واحد — أبسط وأأمن، لا أكشاك توكِن): `POST /api/auth/login`، `POST /api/auth/logout`، `GET /api/auth/me`. يُبذَر المستخدم الأول من `.env` (اسم + تجزئة أولية)، مع **كبح محاولات الدخول** (login throttle).
- `POST /api/etl/run`، `GET /api/etl/status`.
- `GET /api/export/excel`، `GET /api/export/pdf`.

### 5.4 مولّد التنبيهات (`domain`)
بعد كل ETL: يُنشئ صفوف `alerts` لقواعد: شهر متوقع بصافٍ < عتبة المستخدم (`liquidity_deficit`)، دفعة مورد > سقفه (`cap_exceeded`)، تراجع الصافي السنوي، نمو المصروفات أسرع من المقبوضات، **فرق مطابقة السيولة يتجاوز عتبة (`reconciliation_gap`)**، فشل ETL (`etl_failure`). يحافظ على حالة الإقرار للتنبيهات القائمة (لا يكرّرها).

---

## 6. التنبؤ (`domain`)

- **المحرك الافتراضي**: موسمي × CAGR كما في `compute_seasonal_forecast` (CAGR مقيّد بـ [−10%, +15%]، سنة مالية تبدأ مايو، احتياطي شهري).
- **محرك اختياري**: Prophet (يُختار في الفرضيات لكل سلسلة؛ يُخزَّن مع `engine='prophet'` للمقارنة).
- **السيناريوهات**: `base/opt/pess` كما في النموذج (عوامل نمو IN/OUT)، قابلة للتوسعة بـ `custom` عبر `scenario_adjustments`. يحسب مسارات رصيد الصناديق لكل سيناريو بعد خصم الاحتياطي. منزلق «نمو المقبوضات المتوقع» العام (`income_growth_pct`) يُركَّب **ضرباً** فوق عامل IN الخاص بكل سيناريو (مطابق لسلوك النموذج)، لا بديلاً عنه؛ هذا هو عقد `domain` للتنبؤ.
- **التحقق (Backtest)**: تدريب على 2022–2024 وتنبؤ 2025-05→2026-04 وحساب MAPE لكل سلسلة، يُعرض مع مؤشر ثقة (عالية/متوسطة/منخفضة).
- **توزيع الموردين (معالَج لإزالة ازدواج الصيرفة)**: الصيغة المعتمدة:
  `Pool = Forecast_IN − salaries − purchases − refunds − partners − siyrafa − reserve`
  ويُوزَّع `Pool` على **موردي الدينار فقط** (تطبيق السقوف ← إعادة توزيع الفائض ← `leftover`). أما **الموردون الدولاريون** (الحافظ، المهندس، ميديا فوكس، الريان) فدفعتهم = تمويلهم عبر **الصيرفة** نفسها (تُعرض بالدولار) ولا تدخل توزيع مجمّع الدينار — تفادياً لعدّها مرتين (قرار المالك: الخيار 1). **ملاحظة**: صيغتا `allocate()` في `data.js` و`build_excel.py` الحاليتان تختلفان وتُوحَّدان على هذه الصيغة المعتمدة.

---

## 7. الواجهة الأمامية — React/Vite

### 7.1 المصدر
تُعتمد حزمة `design-reference/` **مصدرَ الحقيقة للواجهة**. يُعاد بناء النموذج (الذي يعمل عبر React UMD + Babel في المتصفّح) كمشروع **Vite + React** إنتاجي، مع الحفاظ على المخرَج البصري كما هو (pixel-parity).

### 7.2 نظام التصميم (يُنقل كما هو)
- `design-reference/project/src/colors_and_type.css` = مصدر التوكنات الوحيد: أزرق `#2563EB`، CTA برتقالي `#F97316`، رمادي slate، سلالم الحالة (success/warning/danger/info)، خطوط **Cairo** (المتن) و**Tajawal** (العناوين)، تباعد 4px، أنصاف أقطار 8/12/16، ظلال، حركة. RTL + أرقام لاتينية + `tabular-nums`.
- مكتبة المكوّنات: أزرار، بطاقات، حقول، شارات (badges)، نقاط حالة، هياكل تحميل (skeletons).

### 7.3 الصفحات الثماني والتنقّل (من `Shell.jsx`)
| المجموعة | الصفحة (id) |
|----------|-------------|
| عام | اللوحة التنفيذية (`dashboard`) |
| التدفق النقدي | التدفق الشهري (`monthly`) · المقبوضات والمصروفات (`breakdown`) |
| الموردون والأقساط | الموردون الـ14 (`suppliers`) · الأقساط المفتوحة (`installments`) |
| التخطيط والتنبؤ | التنبؤ والسيناريوهات (`forecast`) · توزيع موردين تنبؤي (`supplierplan`) |
| النظام | الإعدادات (`settings`) |

الهيكل: قائمة جانبية يمنى (256px، sticky)، شريط علوي (breadcrumb + بحث عام باختصار `/` + شارة سعر الصرف + جرس تنبيهات بقائمة منسدلة + إعدادات)، لوحة "تعديل سريع" عائمة.

### 7.4 الرسوم (من `Charts.jsx`)
رسوم SVG خفيفة تفاعلية: `LineChart` (منطقة + خط منقّط لمنطقة التنبؤ + tooltip)، `BarChart` (صافٍ موجب/سالب)، `StackedBarChart` (فئات المصروفات)، `Donut` (أعمار الديون/التركيب).

### 7.5 التحوّلات عن النموذج
- **`data.js` (وهمي) ← استدعاءات API**: طبقة `api-client` تجلب من نقاط §5 وتعيد الكائنات بنفس الأسماء التي تتوقّعها المكوّنات الحالية. يُحافظ على المُنسّقات (`fmt`) في الواجهة.
- **`localStorage` (إعدادات) ← قاعدة التطبيق + مصادقة**: صفحة الإعدادات و"تعديل سريع" تقرأ/تكتب عبر `GET/PUT /api/settings` و`/api/scenarios`.
- **حساب التنبؤ/التوزيع ← الخلفية**: يُزال من المتصفّح ويُستهلك من API.
- **لوحة «تعديل سريع»**: مكوّن `tweaks-panel.jsx` في الحزمة هو **أداة سقالة من Claude Design** (لا تظهر إلا عبر `postMessage` من محرّر خارجي)، فلا يُنقل حرفياً؛ يُعاد بناؤه كلوحة داخلية **متاحة دائماً** بزرّ فتح/إغلاق خاص بها، مع إبقاء محتواها الفعلي (لون التمييز، إظهار الإنذار، الاحتياطي، نمو المقبوضات).
- **شاشة دخول** جديدة قبل الـ Shell.
- **متابعة المنفّذ مقابل المخطّط** في صفحة "توزيع موردين تنبؤي" (ميزة تتجاوز النموذج).
- **شارة MAPE/الثقة** تُضاف على صفحة "التنبؤ والسيناريوهات" (عالية/متوسطة/منخفضة) كي لا تُقرأ التوقعات كحقائق.
- **توحيد وصف التصنيف** في صفحة "المقبوضات والمصروفات": يُحرّر النص ليطابق الطريقة المعتمدة (`OperationsType` + الحساب المقابل).

---

## 8. الأمان والمصادقة
- **مستخدم SQL للقراءة فقط** (أولوية أولى): تسجيل دخول منفصل بصلاحية قراءة على `AlBaytAlSaeid` بدل حساب `sa` (المشترك مع البرنامج المحاسبي — **لا تُدوَّر** كلمة مروره؛ يُنشأ حساب مستقل). يمنع أي كتابة عرضية ويقلّص المخاطر.
- **نقل الأسرار خارج الكود** (أولوية ثانية): كلمة مرور SQL ومفتاح الجلسة (مكشوفة حالياً في `build_excel.py:29` و`docker-compose.yml:9`) تُنقل إلى `.env`. لا مستودع Git حالياً؛ يُضاف `.gitignore` فور تهيئته.
- المصادقة: جلسة **كوكي HttpOnly** (§5.3)، تجزئة كلمة المرور بـ `argon2`/`bcrypt`.
- التطبيق على الشبكة المحلية فقط؛ لا تعريض للإنترنت في النسخة الأولى.
- **تحويل العملة (FX)**: طريقة واحدة معلنة — **السعر الآني الحالي** (متوسط آخر 12 شهراً) لتحويل أرصدة الموردين الدولاريين؛ تُزال القيمة المثبّتة `1350` من السكربت (أوراق 13/14) كي لا يظهر للرصيد الواحد قيمتان مختلفتان.
- `audit_log` يسجّل كل كتابة إدارية (مَن غيّر سقفاً/خطة ومتى).

---

## 9. النشر (Docker)
- يُوسَّع `docker-compose.yml` الحالي بإضافة خدمات: `postgres`، `backend` (uvicorn/FastAPI)، `frontend` (nginx يخدم بناء React الثابت)، و`scheduler` (مدموج في الخلفية عبر APScheduler).
- بإضافة الخدمات لنفس ملف compose تنضم تلقائياً لشبكة المشروع `sqlserver-docker_default`، فيصل `backend` لقاعدة المحاسبة عبر اسم الخدمة **`mssql`** (المنفذ 1433) للقراءة فقط — **دون** الحاجة لتعريف external network.
- وحدات تخزين دائمة: بيانات `postgres`.
- **نسخ احتياطي**: مهمة `pg_dump` ليلية **لجداول التطبيق** (البيانات غير القابلة للاستبدال: السقوف المؤرّخة، السيناريوهات، الخطط، الملاحظات، `audit_log` — الجداول التحليلية تُعاد بناؤها من المصدر)، مع احتفاظ N يوماً و**إجراء استعادة موثّق**.
- ملف `.env` للأسرار (كلمات المرور، مفتاح الجلسة).

---

## 10. المتطلبات غير الوظيفية
- **RTL + عربي** افتراضياً، أرقام لاتينية مع `tabular-nums` (مضمّن في نظام التصميم).
- **الأداء**: الصفحات تقرأ من اللقطة الليلية المسبقة الحساب → استجابة < 1s؛ لا استعلامات ثقيلة لحظية على القاعدة الحيّة.
- **إتاحة الوصول**: حركة مخفّضة عند `prefers-reduced-motion`، تباين كافٍ، تنقّل لوحة مفاتيح في البحث.
- **التدويل الرقمي**: كل المبالغ مليون/مليار د.ع بنفس منطق `fmtM` في النموذج.

---

## 11. استراتيجية الاختبار
- **ETL (وحدة)**: مجاميع الفئات وحساب المنظورين A/C؛ **التصنيف يلتقط الصيرفة (Type 7)** (اختبار انحدار ضد خطأ "391M المخفية")؛ مطابقة عدد السندات مقابل تدقيق `Bonds`؛ صحة حدود المنطقة الزمنية (`Asia/Baghdad`) في قطع `Date > today`.
- **مطابقة السيولة (غير دائرية)**: اختبار أن (إغلاق − افتتاح) لأرصدة `tAccounts` يقارب Σ(صافي مُصنَّف) ضمن عتبة — مقابل **دفتر المصدر**، لا مقابل أرقام النموذج نفسها.
- **الأقساط**: Σ(شرائح الأعمار) = `installments_summary.remaining_m`.
- **التحميل الذرّي**: إعادة تشغيل ETL أثناء قراءة لا تُظهر بيانات نصف-مبنية (القارئ يرى آخر لقطة سليمة)؛ idempotency (نتيجة متطابقة).
- **التنبؤ**: backtest يعطي MAPE ضمن المدى؛ التوزيع يحترم السقوف ويعيد توزيع الفائض على **موردي الدينار فقط** دون ازدواج صيرفة.
- **عقد الـ API**: كل نقطة تعيد مفاتيح `data.js` (snapshot)؛ مغلّف الأخطاء الموحّد و409.
- **الواجهة**: اختبارات مكوّنات للأساسيات والرسوم؛ e2e (Playwright) للتنقّل وحفظ الإعدادات وانتشارها وRTL.
- **التكامل**: دورة تسجيل دخول → عرض → تعديل سقف → انعكاسه.

---

## 12. خريطة التطابق (نموذج → جدول تحليلي → API)
| كائن في `data.js` | جدول/مصدر | نقطة API |
|--------------------|-----------|----------|
| `months[]` | `monthly_cashflow` | `/api/cashflow/monthly` |
| `forecast[]`, `cashPaths`, `fcTotals`, `SCENARIOS` | `forecast_base` + `domain` | `/api/forecast` |
| `SUPPLIERS[]` (+monthly/overCap/balance) | `suppliers`+`per_supplier_monthly`+`balances_snapshot`+`supplier_caps` | `/api/suppliers` |
| `supplierForecast`, `allocate()` | `domain` | `/api/supplier-plan` |
| `INSTALLMENTS_TOTAL`, `AGING`, `TOP_DEBTORS` | `installments_summary`+`installments_aging`+`balances_snapshot` | `/api/installments` |
| `FUNDS`, `PARTNERS` | `balances_snapshot` | `/api/breakdown` |
| `EXP_CATS`, تركيب المصروفات | `monthly_cashflow` | `/api/breakdown` |
| `agg`, `netDecline`, `expenseVelocity` | `domain` فوق `monthly_cashflow` | `/api/dashboard` |
| `ALERTS` | `alerts` | `/api/alerts`, `/api/dashboard` |
| إعدادات `localStorage` | `app_settings`+`assumptions` | `/api/settings` |

---

## 13. خارج النطاق (النسخة الأولى)
- الكتابة في النظام المحاسبي (`AlBaytAlSaeid`).
- تعدّد المستخدمين والأدوار، والاستضافة السحابية.
- تنبيهات بريد/واتساب.
- تفصيل الفروع/الصناديق كلوحات مستقلة (التصميم يسمح به لاحقاً).

## 14. مستقبلاً
تفصيل الفروع السبعة · تحليل aging أعمق · تكامل Power BI · نماذج تنبؤ متقدمة إضافية · إشعارات خارجية.

## 15. المخاطر والتخفيف
> **مهام تحقّق إلزامية (Gating)** — تُنفَّذ مقابل القاعدة الحيّة **قبل** بناء ETL، وقد تُعدّل بعض التفاصيل بناءً على نتائجها:

| الخطر | التخفيف / المهمة الإلزامية |
|-------|---------|
| اختلاف مخطّط القاعدة عن `CLAUDE.md` | **إلزامي**: فحص المخطّط الفعلي قبل بناء ETL |
| حقول تاريخ استحقاق الأقساط غير مؤكدة | **إلزامي**: التحقق من `Premiums`/`PremiumPays`؛ وإلا رقم "متبقٍ" واحد بدل شرائح |
| تمييز الشركاء الثلاثة (حسابات 2518) | **إلزامي**: فحص الحسابات — التوزيع التنبؤي يطرح الشركاء فيُحسم مبكراً (وإلا عرض إجمالي) |
| فرق مطابقة السيولة كبير (الصناديق ناقصة في المصدر) | المطابقة تُبرز الفرق للمالك لتحقّقه اليدوي العام؛ ليست بوابة مانعة للتشغيل |
| كلمة مرور القاعدة مكشوفة + حساب `sa` مفرط الصلاحية | مستخدم قراءة-فقط منفصل + نقل الأسرار لـ `.env` (أول إجراء) |
| انجراف الواجهة عن التصميم | `design-reference/` مرجع ملزم + مراجعة بصرية |

---

## 16. مرجع حزمة التصميم
- `design-reference/README.md` — تعليمات الحزمة.
- `design-reference/chats/chat1.md` — محادثة التصميم (النية والتكرارات).
- `design-reference/project/src/` — `colors_and_type.css`, `Shell.jsx`, `Primitives.jsx`, `Charts.jsx`, `data.js`, وصفحات: `Dashboard/MonthlyFlow/Breakdown/Suppliers/Installments/Forecast/SupplierPlan/Settings`.
- `design-reference/project/screenshots/` — لقطات مرجعية لكل شاشة.
