# RUNBOOK — تشغيل وصيانة نظام السيولة النقدية (معرض البيت السعيد)

> دليل تشغيلي عملي للمالك/المشغّل. يُوسَّع في المهمة E1.
> آخر تحديث: 2026-06-09.

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
