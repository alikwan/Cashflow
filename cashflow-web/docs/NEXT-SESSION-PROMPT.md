# برومبت الجلسة القادمة — استئناف بناء نظام السيولة

> انسخ ما تحت الخط إلى بداية الجلسة الجديدة.

---

أكمل بناء **نظام ويب لإدارة السيولة النقدية لمعرض البيت السعيد**. هذه جلسة **استئناف** — لا تبدأ من الصفر، البنية والقرارات جاهزة.

## اقرأ أولاً (إلزامي قبل أي كود)
- **المواصفة المعتمدة:** `docs/superpowers/specs/2026-06-01-cashflow-web-system-design.md`
- **خطط التنفيذ الخمس:** `docs/superpowers/plans/2026-06-02-phase0..4-*.md` (0=الأساس، 1=ETL+domain، 2=خلفية FastAPI، 3=واجهة React، 4=تكامل/نشر)
- **نتائج التحقّق من القاعدة الحيّة:** `cashflow-web/docs/discovery/00..03 + 04`
- **مرجع الواجهة الملزم (نموذج التصميم):** `design-reference/` (نظام تصميم Cairo/Tajawal، أزرق #2563EB، RTL، 8 صفحات، `data.js` كعقد بيانات)
- **🔑 مرجع حاسم لقراءة MSSQL والأقساط:** نظام **DC-System** على `/Users/ak/Documents/DC-System-Workspace/DC-System/` — خاصة `app/Services/ExternalData/Drivers/MssqlDriver.php` (وملف `CLAUDE.md` فيه). يتعامل مع نفس القاعدة وحلّ دلالات الأقساط/الدفعات.

## حالة العمل
- مستودع Git على فرع **`cashflow-web`** (جذر "Monthly cash flow"). راجع `git log`.
- ✅ **منجز:** مهام التحقّق (Chunk A من الخطة 0) — المخطّط (208,339 سند، مطابق)، الشركاء (2535/2536/2537)، الأقساط، المطابقة.
- ⏭️ **التالي:** الخطة 0 **Chunk B** (سقالة المشروع + خدمة Postgres + مستخدم قراءة-فقط `cashflow_ro` + `.env`) ثم **Chunk C** (نماذج SQLAlchemy + هجرات Alembic). ثم الخطط 1 → 4 بالتسلسل.
- **نفّذ عبر منهجية `superpowers:subagent-driven-development`** (وكيل لكل مهمة + مراجعة مزدوجة)، والتزم بعد كل مهمة. مهام التحقّق والبنية التحتية نفّذها بنفسك (تحتاج Bash/Docker).

## قرارات مثبّتة (لا تُغيّرها دون إذن المالك)
- معمارية **FastAPI + React/Vite**؛ مستخدم واحد محلي على الشبكة؛ ETL ليلي → **PostgreSQL منفصلة** (تحليلية + تطبيقية)؛ قاعدة `AlBaytAlSaeid` **قراءة فقط**.
- التصنيف = **`OperationsType` + نوع الحساب المقابل** (يلتقط الصيرفة Type 7). **لا تستخدم** `analysis/sql/02_monthly_cashflow.sql` (يُسقط الصيرفة).
- **الصيرفة = الخيار 1**: تبقى بنداً مستقلاً؛ التوزيع التنبؤي على **موردي الدينار فقط** (الدولاريون يُموَّلون عبر الصيرفة، بلا ازدواج).
- الرصيد مُثبَّت من `tAccounts` + مطابقة tie-out تدعم **تحقّق المالك اليدوي** (ليست بوابة مانعة).
- المنطقة الزمنية **Asia/Baghdad**؛ تحميل ETL **ذرّي** (staging→swap)؛ قفل تشغيل أحادي.

## ⚠️ دروس حرجة (أخطاء وقعتُ فيها — لا تكرّرها)
- **الأقساط (الأهم):** `PremiumPays` صف **لكل قسط**، و**`PremiumPays.Amount` = الرصيد المتبقّي للقسط، لا المدفوع**. مدفوع كاملاً→`Amount=0`؛ غير مدفوع→`=PremiumPayAmount`؛ جزئي→المتبقّي. مُسوّى=`PremiumState∈(3,4)` أو (`Amount=0` و `DatePay>'1900-01-02'`). النقد=`MAX(0, PremiumPayAmount−Amount−Discount)`. تاريخ الاستحقاق=`PremiumPays.Date`. **الأرقام الصحيحة:** قائم ≈**1.26B**، مُحصّل ≈**5.65B**، خصم 0.15B (اسمي 7.12B). **لا تستخدم منطق `build_excel.py:get_installments_summary` (مقلوب).** اعتمد `MssqlDriver`.
- **العملة:** `Amount1` بالدينار دائماً — **لا تضربه بـ `Rate1`**. دائماً فلتر `Deleted=0` و `ISNULL(IsEdit,0)=0` واستبعد السندات المستقبلية.

## البيئة
- Docker: الحاوية `mssql-server` (اسم الخدمة `mssql`، منفذ 1433). كلمة مرور SA في `/Users/ak/Documents/sqlserver-docker/docker-compose.yml` — **انقلها إلى `.env` وأنشئ مستخدم قراءة-فقط** أول الأمر.
- compose الموجود: `/Users/ak/Documents/sqlserver-docker/docker-compose.yml`؛ شبكة المشروع `sqlserver-docker_default` (الخدمات الجديدة تنضم إليها وتصل لـ MSSQL باسم `mssql`).

## ابدأ بـ
1. تأكيد أن Docker والحاوية `mssql-server` يعملان (`docker ps`).
2. تنفيذ **الخطة 0 — Chunk B ثم C** عبر subagent-driven-development، مع الالتزام بعد كل مهمة على فرع `cashflow-web`.
3. ثم الخطط 1 → 4.

عند أي حساب أقساط/دفعات: ارجع إلى `MssqlDriver` في DC-System و`cashflow-web/docs/discovery/01`.
