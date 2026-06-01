# 04 — مستخدم SQL Server للقراءة فقط (مهمة بنية تحتية B3)

**التاريخ:** 2026-06-02 | **القاعدة:** `AlBaytAlSaeid` (حاوية `mssql-server`)

## النتيجة: ✅ مستخدم `cashflow_ro` يقرأ ولا يكتب

أنشئ تسجيل دخول SQL مستقل بصلاحية قراءة فقط بدل حساب `sa` (المشترك مع البرنامج
المحاسبي). كلمة المرور الحقيقية في `cashflow-web/.env` المحلي (غير المتعقَّب) تحت
`MSSQL_READONLY_PASSWORD` — **لا تُكتب هنا**.

## الإنشاء (يُعاد تشغيله بأمان — idempotent)

يُنفَّذ بحساب `sa` مرّة واحدة (كلمة مرور SA من `docker-compose.yml`، لم تُدوَّر — §8 المواصفة):

```sql
USE AlBaytAlSaeid;
IF DATABASE_PRINCIPAL_ID('cashflow_ro') IS NOT NULL DROP USER [cashflow_ro];
IF SUSER_ID('cashflow_ro') IS NOT NULL DROP LOGIN [cashflow_ro];
CREATE LOGIN [cashflow_ro] WITH PASSWORD='<from .env>', CHECK_POLICY=ON;
CREATE USER  [cashflow_ro] FOR LOGIN [cashflow_ro];
ALTER ROLE   db_datareader ADD MEMBER [cashflow_ro];
```

> كلمة المرور تُحقّق سياسة تعقيد SQL Server (`CHECK_POLICY=ON`): حرف كبير + صغير + رقم + رمز.
> تُمرَّر عبر متغيّر sqlcmd `-v RO_PW=...` مع heredoc مقتبس (يتفادى توسيع الصدفة للمحارف الخاصة مثل `!`).

## التحقّق (نُفِّذ فعلاً)

| الاختبار | الأمر | النتيجة |
|---------|-------|---------|
| القراءة تنجح | `SELECT COUNT(*) FROM Bonds` كـ `cashflow_ro` | **208,339** ✓ |
| الكتابة تُرفض | `UPDATE Bonds ... WHERE 1=0` كـ `cashflow_ro` | **Msg 229: UPDATE permission denied** ✓ |
| الأدوار | `IS_ROLEMEMBER(...)` | reader=1 · writer=0 · sysadmin=0 ✓ |
| اتصال الدرايفر | `pymssql` من المضيف عبر `localhost:1433` | Bonds=208,339 ✓ (مسار ETL مُتحقَّق) |

## الاتصال من التطبيق

- **داخل Docker** (الـ backend في الخطة 4): `MSSQL_HOST=mssql` المنفذ 1433 (شبكة `sqlserver-docker_default`).
- **على المضيف** (ETL/اختبارات الخطة 0–1): `MSSQL_HOST=localhost` (أو 127.0.0.1) المنفذ 1433 (منشور).
- الدرايفر: `pymssql` (مثبَّت في venv). كل الاستعلامات `SELECT` فقط — الكتابة محظورة على مستوى المحرّك.

## ملاحظة أمنية
- لم تُدوَّر كلمة مرور `sa` (مشتركة مع البرنامج المحاسبي — §8). أُنشئ حساب مستقل بدلاً منها.
- لاحقاً يمكن تضييق الصلاحية أكثر (GRANT SELECT على جداول بعينها بدل `db_datareader` للقاعدة كاملة) إن لزم، لكن `db_datareader` كافٍ ويمنع كل كتابة.
