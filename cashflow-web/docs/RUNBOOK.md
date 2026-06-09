# RUNBOOK — تشغيل وصيانة نظام السيولة النقدية (معرض البيت السعيد)

> دليل تشغيلي عملي للمالك/المشغّل. مكتوب بلغة مبسّطة؛ الأوامر تُنسخ كما هي.
> آخر تحديث: 2026-06-09.

## المحتويات
1. [نظرة عامة على النظام](#1-نظرة-عامة-على-النظام)
2. [التشغيل (رفع/إيقاف/إعادة تشغيل)](#2-التشغيل)
3. [التحديث اليومي (ETL)](#3-التحديث-اليومي-etl)
4. [النسخ الاحتياطي والاستعادة](#النسخ-الاحتياطي-والاستعادة-backup--restore)
5. [استكشاف الأعطال](#4-استكشاف-الأعطال-troubleshooting)
6. [قائمة «التشغيل الشهري» للمالك](#5-قائمة-التشغيل-الشهري-للمالك)
7. [ملاحظات أمنية مؤجَّلة](#6-ملاحظات-أمنية-مؤجَّلة-للمالك)

---

## 1. نظرة عامة على النظام

**ما هو:** نظام ويب محلّي لإدارة السيولة النقدية — يعرض المقبوضات والمصروفات
والأقساط وأرصدة الموردين، ويتنبّأ بالتدفّق ويقترح خطة توزيع على الموردين، ويطلق
تنبيهات. يعمل على جهاز/خادم واحد في المعرض، ويصله المالك من المتصفّح.

**الحاويات الثلاث** (مشروع Docker compose اسمه `cashflow`):

| الحاوية | الدور | المنفذ |
|--------|-------|--------|
| `cashflow-postgres` | قاعدة التطبيق (جداول تحليلية يملؤها ETL + جداول تطبيق يكتبها المالك) | داخلي فقط (127.0.0.1:5433) |
| `cashflow-backend` | خلفية FastAPI + **مجدول ETL الليلي** — يقرأ المحاسبة `AlBaytAlSaeid` ويكتب Postgres | داخلي فقط (127.0.0.1:8002) |
| `cashflow-frontend` | nginx يقدّم واجهة React **ويوكّل `/api`→backend** | **8080** (مفتوح على الشبكة) |

**النموذج same-origin:** المتصفّح يكلّم `cashflow-frontend` فقط (المنفذ 8080).
ما يبدأ بـ `/api` يمرّره nginx داخلياً للخلفية على شبكة Docker. لذا **لا حاجة لـ
CORS**، وكوكي الجلسة يعمل تلقائياً. الخلفية وقاعدة البيانات **غير مكشوفتين** على
الشبكة (loopback فقط) — الواجهة وحدها هي المنفذ العام.

> الحاويات تنضمّ لشبكة Docker الموجودة `sqlserver-docker_default` كي تصل الخلفية
> إلى حاوية المحاسبة `mssql` وإلى `postgres` بأسمائهما الداخلية.

---

## 2. التشغيل

> **يفترض الأمر أنّك في مجلّد** `cashflow-web` وأنّ ملف الأسرار `.env` موجود فيه.

### رفع الحزمة (تشغيل النظام كاملاً)

```bash
cd "/Users/ak/Documents/sqlserver-docker/Monthly cash flow/cashflow-web"
docker compose --env-file .env -f docker/compose.cashflow.yml up -d
```

أوّل مرّة تبني الصور (قد تأخذ دقائق)؛ بعدها تُقلِع بثوانٍ. الخلفية تطبّق مخطّط
القاعدة تلقائياً (`alembic upgrade head`) ثم تشغّل المجدول.

### الوصول وتسجيل الدخول

- افتح المتصفّح على: **`http://<host>:8100`** (استبدل `<host>` بعنوان جهاز الخادم
  على شبكة المعرض، أو `localhost` إن كنت على نفس الجهاز).
- **اسم المستخدم:** `owner`
- **كلمة المرور:** القيمة المقابلة لـ `APP_OWNER_PASSWORD` في ملف
  `cashflow-web/.env` — افتح الملف وانسخها **لصقاً** (لا تكتبها يدوياً تفادياً
  للخطأ).

### التحقّق أنّ كلّ شيء يعمل

```bash
cd "/Users/ak/Documents/sqlserver-docker/Monthly cash flow/cashflow-web"
docker compose --env-file .env -f docker/compose.cashflow.yml ps
```

يجب أن تكون الخدمات الثلاث `running` و(للخلفية وقاعدة البيانات) `healthy`.

### الإيقاف وإعادة التشغيل

```bash
# إيقاف الحزمة كلّها (تبقى البيانات في القرص):
docker compose --env-file .env -f docker/compose.cashflow.yml down

# إعادة تشغيل خدمة واحدة (دون لمس الباقي):
docker compose --env-file .env -f docker/compose.cashflow.yml restart backend
```

> `down` لا يحذف البيانات (محفوظة في حجم `cashflow_pgdata`). لإعادة الرفع بعدها
> استخدم أمر `up -d` نفسه أعلاه.

---

## 3. التحديث اليومي (ETL)

«ETL» = العملية التي تقرأ المحاسبة الحيّة `AlBaytAlSaeid` وتعيد حساب كل الأرقام
التحليلية في النظام (تدفّق شهري، أقساط، أعمار، أرصدة، تنبؤ…).

### تلقائياً (لا تحتاج لفعل شيء)

يعمل **كل ليلة الساعة 02:00 بتوقيت بغداد** عبر المجدول داخل `cashflow-backend`.
فتجد أرقام الصباح محدّثة دائماً.

### يدوياً (عند الحاجة لتحديث فوري)

سجّل الدخول في الواجهة، ثم استدعِ (أو من الواجهة إن وُجد زرّ تحديث):

```bash
# تشغيل ETL الآن:
curl -X POST http://<host>:8100/api/etl/run

# قراءة حالة آخر تشغيل (نجاح/فشل/قيد التشغيل + الطابع الزمني):
curl http://<host>:8100/api/etl/status
```

> الطلبات تحتاج كوكي جلسة صالحة (بعد تسجيل الدخول). من المتصفّح يكفي أن تكون
> مسجّلاً للدخول.

### قراءة السجلّات (logs)

```bash
cd "/Users/ak/Documents/sqlserver-docker/Monthly cash flow/cashflow-web"
docker compose --env-file .env -f docker/compose.cashflow.yml logs backend --tail 50
```

> أحداث التطبيق (بدء/انتهاء ETL، الأخطاء) تظهر الآن في سجلّ `backend` بعد إصلاح
> إعداد التسجيل. للمتابعة الحيّة أضِف `-f` بدل `--tail 50`.

---

## النسخ الاحتياطي والاستعادة (Backup & Restore)

### ما الذي يُنسخ ولماذا

النظام يفصل بيانات القاعدة إلى نوعين:

| النوع | الجداول | تُنسخ احتياطياً؟ | السبب |
|------|---------|:----------------:|-------|
| **بيانات التطبيق** (يُدخلها المستخدم — لا يمكن إعادة بناؤها) | `users, suppliers, supplier_caps, scenarios, assumptions, scenario_adjustments, payment_plans, payment_plan_lines, notes, alerts, app_settings, audit_log` | ✅ **نعم** | لا مصدر آخر لها — السقوف، السيناريوهات، الخطط، الملاحظات، حالة التنبيهات، سجلّ التدقيق. |
| **بيانات تحليلية** (ETL يعيد بناءها ليلياً) | `monthly_cashflow, per_supplier_monthly, balances_snapshot, installments_summary, installments_aging, forecast_base, seasonal_index, etl_runs` | ❌ **لا** | تُعاد حسابتها من قاعدة `AlBaytAlSaeid` في أي وقت عبر ETL — نسخها مضيعة. |

> مخطّط القاعدة (الـ schema) يُدار بواسطة **Alembic** (`alembic upgrade head`)، والـ backend يطبّقه عند الإقلاع. لذا نسخة البيانات لا تحتاج لحفظ المخطّط مستقلاً.

السكربتات في: `cashflow-web/docker/backup/`
- `backup.sh` — يأخذ نسخة (`pg_dump -Fc`) لجداول التطبيق فقط.
- `restore.sh` — يستعيد جداول التطبيق من نسخة (مع تأكيد أمان).
- `dumps/` — مجلّد النسخ (مُستثنى من git عبر `.gitignore` — لا يُدفع لأنه بيانات حيّة).

### أخذ نسخة احتياطية

```bash
cd "/Users/ak/Documents/sqlserver-docker/Monthly cash flow/cashflow-web/docker/backup"
./backup.sh
```

ينتج ملفاً مؤرّخاً مثل:
`dumps/cashflow-apptables-cashflow-20260609-203208.dump`

لا حاجة لتثبيت عميل PostgreSQL على المضيف — السكربت يشغّل `pg_dump` **داخل** حاوية `cashflow-postgres`.

**متغيّرات اختيارية:**
```bash
BACKUP_DIR=/path/to/backups ./backup.sh   # وجهة مختلفة للنسخ
RETENTION_DAYS=30 ./backup.sh             # احتفظ بـ 30 يوماً (افتراضي 14)
DB_NAME=cashflow ./backup.sh              # قاعدة مختلفة (للاختبار)
```

الاحتفاظ: يحذف تلقائياً النسخ الأقدم من `RETENTION_DAYS` (افتراضي 14 يوماً).

### الجدولة (cron — نسخة يومية تلقائية)

أضِف سطراً إلى `crontab -e` لنسخة يومية الساعة 03:00 (بعد ETL الساعة 02:00):

```cron
0 3 * * * cd "/Users/ak/Documents/sqlserver-docker/Monthly cash flow/cashflow-web/docker/backup" && ./backup.sh >> backup.log 2>&1
```

> راجع `backup.log` دورياً، وانسخ مجلّد `dumps/` إلى وسيط خارجي (USB/سحابة) لحماية ضد فشل القرص.

### الاستعادة

⚠️ **تحذير:** الاستعادة **تستبدل** جداول التطبيق (تُسقطها ثم تعيد بناءها من اللقطة).
لا تمسّ الجداول التحليلية (يعيد بناءها ETL لاحقاً). تتطلّب تأكيداً صريحاً.

```bash
cd "/Users/ak/Documents/sqlserver-docker/Monthly cash flow/cashflow-web/docker/backup"
./restore.sh dumps/cashflow-apptables-cashflow-20260609-203208.dump
```

سيعرض السكربت ما سيُستبدل ويطلب كتابة `restore` للتأكيد. لتخطّي السؤال (سكربتات/أتمتة):

```bash
./restore.sh <ملف-النسخة> cashflow --yes
# أو
CONFIRM=yes ./restore.sh <ملف-النسخة>
```

بعد الاستعادة يطبع السكربت **فحص عدد الصفوف** لكل جدول للتحقّق السريع.

**الاستعادة إلى قاعدة هدف مختلفة** (مثلاً للاختبار دون لمس الإنتاج):
```bash
./restore.sh <ملف-النسخة> cashflow_bkptest --yes
```

### تدفّق التعافي من كارثة (Disaster Recovery)

إذا فُقدت قاعدة `cashflow` بالكامل (تلف قرص، حذف حاوية بحجمها...):

1. **أعِد الحاوية والقاعدة الفارغة:**
   ```bash
   cd "/Users/ak/Documents/sqlserver-docker/Monthly cash flow/cashflow-web/docker"
   docker compose -f compose.cashflow.yml up -d cashflow-postgres
   ```
2. **أنشئ المخطّط عبر Alembic** — يفعلها الـ backend تلقائياً عند الإقلاع (`alembic upgrade head`)، أو يدوياً داخل حاوية backend.
3. **استعد بيانات التطبيق** من آخر نسخة:
   ```bash
   ./backup/restore.sh backup/dumps/<أحدث-نسخة>.dump cashflow --yes
   ```
   (`restore.sh` يستخدم `--clean --if-exists`، فيعمل سواء كانت الجداول موجودة من Alembic أو لا.)
4. **أعِد بناء الجداول التحليلية** عبر تشغيل ETL (يدوياً أو انتظار التشغيل الليلي):
   ETL يقرأ `AlBaytAlSaeid` ويملأ `monthly_cashflow` وبقية الجداول التحليلية.

بهذا تعود البيانات التي لا تُعوَّض (نسخة) + البيانات المشتقّة (ETL) كاملةً.

### التحقّق من سلامة النسخ (roundtrip — مُختبَر)

تم التحقّق من دورة كاملة **إدراج → نسخ → حذف → استعادة → تأكيد** على قاعدة **مؤقّتة منفصلة** (`cashflow_bkptest`) — لا تُختبر أبداً على القاعدة الحيّة:

```bash
# نموذج (يُشغَّل على قاعدة رمي مؤقّتة فقط):
docker exec cashflow-postgres createdb -U cashflow cashflow_bkptest
# ... seed + insert test row + backup + delete + restore ...
DB_NAME=cashflow_bkptest ./backup.sh
./restore.sh <dump> cashflow_bkptest --yes
docker exec cashflow-postgres dropdb -U cashflow cashflow_bkptest
```

النتيجة المؤكَّدة: صفّ الاختبار يعود بعد الاستعادة (count = 1)، والقاعدة الحيّة لم تُمسّ.

> **جدولة النسخ (موصى به):** أضِف سطر cron يومياً — انظر «الجدولة (cron)» أعلاه.
> النسخة الواحدة صغيرة (جداول التطبيق فقط)، فجدولتها رخيصة وتحميك من فقد السقوف
> والسيناريوهات والخطط والملاحظات.

---

## 4. استكشاف الأعطال (Troubleshooting)

> أمر القراءة العام للسجلّ (بدّل `backend` بـ `frontend`/`postgres` حسب الخدمة):
> ```bash
> cd "/Users/ak/Documents/sqlserver-docker/Monthly cash flow/cashflow-web"
> docker compose --env-file .env -f docker/compose.cashflow.yml logs <service> --tail 80
> ```

| العَرَض | السبب المحتمل | الحلّ |
|--------|---------------|------|
| **ETL يفشل دائماً / الأرقام لا تتحدّث** | حاوية المحاسبة `mssql-server` متوقّفة | `docker ps \| grep mssql-server` — إن لم تظهر، شغّل compose الخاصّ بـ SQL Server. الخلفية تصل لـ `mssql` على الشبكة المشتركة. |
| **فشل ETL لمرّة** | خطأ مؤقّت (اتصال/قفل) | اقرأ سجلّ `backend` (`logs backend`) لرسالة الخطأ؛ راجع `/api/etl/status`؛ أعِد التشغيل يدوياً `POST /api/etl/run`. |
| **رقم يبدو خاطئاً / فرق مطابقة كبير** | انحراف بيانات أو منطق | راجع `cashflow-web/docs/verification-checklist.md` (أعِد اشتقاق الرقم من المصدر الخام وقارنه). تذكّر أنّ الأعمار ونافذة آخر 12 شهر **تتغيّر مع الزمن** — هذا سليم. |
| **حاوية «unhealthy» أو لا تردّ** | عطل في الخدمة | أعِد تشغيلها: `docker compose --env-file .env -f docker/compose.cashflow.yml restart <service>`. إن تكرّر، اقرأ سجلّها. |
| **المنفذ 8080 مشغول** عند الرفع | خدمة أخرى تستخدمه | أوقِف ما يشغله، أو غيّر تخطيط المنفذ في `docker/compose.cashflow.yml` (خدمة `frontend`: `"8080:80"` → منفذ آخر) ثم أعِد `up -d`. |
| **لا أستطيع الدخول** | كلمة مرور خاطئة | انسخ `APP_OWNER_PASSWORD` من `.env` لصقاً (اسم المستخدم `owner`). |
| **الواجهة تفتح لكن `/api` يفشل** | الخلفية متوقّفة/غير سليمة | تحقّق `... ps` أنّ `cashflow-backend` يعمل و`healthy`؛ أعِد تشغيله. |

---

## 5. قائمة «التشغيل الشهري» للمالك

روتين شهري قصير يبقي قراراتك مبنيّة على أرقام حديثة وموثوقة:

1. **راجع التنبيهات** (صفحة التنبيهات): أي نقص سيولة متوقّع أو مورّد قارب سقفه؟
2. **راجع خطة توزيع الموردين** (الصفحة التنبؤية): هل التوزيع المقترح معقول؟
   عدّله إن لزم.
3. **صدّر التقارير** (Excel/PDF) للأرشفة الشهرية أو لمشاركتها.
4. **تحقّق دوري من الأرقام:** قارِن **رصيد الصناديق** و**الأقساط القائمة** المعروضين
   بإحساسك الفعلي. عند أي شكّ، اتّبع `cashflow-web/docs/verification-checklist.md`
   (يشرح كيف يُعاد اشتقاق أي رقم من المصدر الخام).
5. **تأكّد أنّ النسخ الاحتياطي يعمل:** راجع `backup.log` ووجود نسخ حديثة في
   `docker/backup/dumps/`، وانسخها لوسيط خارجي.

---

## 6. ملاحظات أمنية مؤجَّلة (للمالك)

هذه ليست عاجلة لكن يُنصَح بمعالجتها متى أمكن:

1. **غيّر كلمة مرور `owner`** إلى كلمة تختارها أنت (بدّل `APP_OWNER_PASSWORD` في
   `.env` ثم أعِد رفع الخلفية). لا تتركها على القيمة الأولى.
2. **كلمة مرور SA لقاعدة المحاسبة مكشوفة** في الكود/تاريخ Git (`docker-compose.yml`
   للـ SQL Server). يُفضَّل: **تدويرها** (تغييرها) ثم تنظيف التاريخ
   (`git filter-repo`) كي لا تبقى في السجلّ. النظام نفسه يستخدم مستخدم **قراءة-فقط**
   منفصل (`MSSQL_READONLY_USER`)، لكن بقاء SA مكشوفاً خطر مستقلّ.
3. **قيّد الوصول على مستوى الشبكة:** المنفذ 8080 مفتوح على شبكة المعرض كاملةً
   (محميّ بكلمة مرور فقط). يُفضَّل تقييده عبر جدار الحماية على الأجهزة/النطاق الذي
   تثق به فقط.
