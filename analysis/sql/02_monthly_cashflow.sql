-- =============================================================
-- ⛔⛔ مُلغى / DEPRECATED — لا تستخدمه ⛔⛔
-- -------------------------------------------------------------
-- هذا الملف يصنّف الحركة بـ«عضوية الصندوق» (هل طرفا السند داخل/خارج
-- مجموعة حسابات النقد 1811/1812) لا بـ OperationsType. والنتيجة أنّه
-- **يُسقط الصيرفة (OperationsType=7)** لأنّ تحويل الدينار→دولار يبقى
-- ضمن حركة الحسابات ولا يُلتقَط هنا — فيُنقِص المصروفات بـ ~391M سنوياً.
--
-- ✅ التصنيف المعتمد الوحيد: cashflow-web/backend/app/domain/classify.py
--    (OperationsType + نوع الحساب المقابل to_type — يلتقط الصيرفة Type 7).
-- 🔎 إثبات أنّ الصيرفة غير مخفية في النظام: cashflow-web/docs/verification-checklist.md §2.8
-- 📘 السبب الكامل: CLAUDE.md §3.4 و§10 (الدرس 5).
--
-- يُحتفَظ بالملف للأرشيف/المرجع فقط — لا يُشغَّل ولا يُعتمَد لأي رقم.
-- =============================================================
-- 02_monthly_cashflow.sql
-- التدفق النقدي الشهري الإجمالي للسنوات الـ4 (مايو 2022 → أبريل 2026)
-- يُنتج 48 شهر × 8 أعمدة تصنيفية
-- =============================================================

USE AlBaytAlSaeid;

WITH Cash AS (
    SELECT AccountId FROM accounts WHERE AccountTypeId IN (1811, 1812) AND Deleted = 0
),
TaggedBonds AS (
    SELECT
        b.Date,
        b.Amount1,
        b.AccountFromId,
        b.AccountToId,
        af.AccountTypeId AS FromType,
        at.AccountTypeId AS ToType,
        CASE WHEN b.AccountToId   IN (SELECT AccountId FROM Cash)
              AND b.AccountFromId NOT IN (SELECT AccountId FROM Cash) THEN 1 ELSE 0 END AS IsIn,
        CASE WHEN b.AccountFromId IN (SELECT AccountId FROM Cash)
              AND b.AccountToId   NOT IN (SELECT AccountId FROM Cash) THEN 1 ELSE 0 END AS IsOut
    FROM Bonds b
    JOIN accounts af ON af.AccountId = b.AccountFromId
    JOIN accounts at ON at.AccountId = b.AccountToId
    WHERE b.Deleted = 0
      AND b.Date >= '2022-05-01' AND b.Date < '2026-05-01'
      AND ISNULL(b.IsEdit, 0) = 0
)
SELECT
    FORMAT(Date, 'yyyy-MM') AS YearMonth,
    -- المقبوضات
    SUM(CASE WHEN IsIn=1 THEN Amount1 ELSE 0 END) / 1000000.0 AS Cash_IN_M,

    -- المصروفات حسب الفئة
    SUM(CASE WHEN IsOut=1 AND ToType=2614 THEN Amount1 ELSE 0 END) / 1000000.0 AS OUT_Suppliers_M,
    SUM(CASE WHEN IsOut=1 AND ToType=2518 THEN Amount1 ELSE 0 END) / 1000000.0 AS OUT_Drawings_M,
    SUM(CASE WHEN IsOut=1 AND ToType=3110 THEN Amount1 ELSE 0 END) / 1000000.0 AS OUT_Purchases_M,
    SUM(CASE WHEN IsOut=1 AND ToType=3121 THEN Amount1 ELSE 0 END) / 1000000.0 AS OUT_Salaries_M,
    SUM(CASE WHEN IsOut=1 AND ToType=1631 THEN Amount1 ELSE 0 END) / 1000000.0 AS OUT_Refunds_M,
    SUM(CASE WHEN IsOut=1 AND ToType NOT IN (2614,2518,3110,3121,1631) THEN Amount1 ELSE 0 END) / 1000000.0 AS OUT_Other_M,

    -- إجمالي المصروفات
    SUM(CASE WHEN IsOut=1 THEN Amount1 ELSE 0 END) / 1000000.0 AS OUT_Total_M,

    -- صافي تشغيلي (بدون السحوبات والرأسمال)
    (SUM(CASE WHEN IsIn=1 THEN Amount1 ELSE 0 END)
     - SUM(CASE WHEN IsOut=1 AND ToType NOT IN (2518, 2110) THEN Amount1 ELSE 0 END)) / 1000000.0 AS Net_Operating_M,

    -- صافي شامل (كل شيء)
    (SUM(CASE WHEN IsIn=1 THEN Amount1 ELSE 0 END)
     - SUM(CASE WHEN IsOut=1 THEN Amount1 ELSE 0 END)) / 1000000.0 AS Net_Total_M,

    -- عدد السندات للمراجعة
    COUNT(CASE WHEN IsIn=1 OR IsOut=1 THEN 1 END) AS Bond_Count
FROM TaggedBonds
GROUP BY FORMAT(Date, 'yyyy-MM')
ORDER BY YearMonth;
