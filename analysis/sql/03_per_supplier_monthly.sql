-- =============================================================
-- 03_per_supplier_monthly.sql
-- المدفوعات والمقبوضات الشهرية لكل واحد من الـ14 موزّع رئيسي
-- =============================================================

USE AlBaytAlSaeid;

WITH Cash AS (
    SELECT AccountId FROM accounts WHERE AccountTypeId IN (1811, 1812) AND Deleted = 0
),
Suppliers(AccountId, Name, MonthlyCapRef) AS (
    SELECT v1, v2, v3 FROM (VALUES
        (1001, N'01-معرض البركة',                 5000000),
        (2079, N'02-هيثم',                          3000000),
        (2093, N'03-وميض',                                0),
        (2432, N'04-حميد الشطباوي',                15000000),
        (2440, N'05-معرض الهادي',                  3000000),
        (2700, N'06-معرض اولاد شفيق',              3000000),
        (3123, N'07-العطاوي للمفروشات',            2000000),
        (3916, N'08-شركة اصل القمة',               3000000),
        (5721, N'09-قاسم بايسكلات',                4000000),
        (2439, N'10-معرض الواحة سامراء',                  0),
        (4937, N'11-شركة الحافظ',                 40000000),
        (6444, N'12-كهربائيات المهندس',           15000000),
        (6552, N'13-دكتور يوسف ميديا فوكس',        5000000),
        (6918, N'14-شركة الريان بغداد',            7000000)
    ) v(v1, v2, v3)
)
SELECT
    s.Name AS Supplier,
    FORMAT(b.Date, 'yyyy-MM') AS YearMonth,
    SUM(CASE WHEN b.AccountToId = s.AccountId
              AND b.AccountFromId IN (SELECT AccountId FROM Cash)
             THEN b.Amount1 ELSE 0 END) / 1000000.0 AS Paid_To_Supplier_M,
    SUM(CASE WHEN b.AccountFromId = s.AccountId
              AND b.AccountToId IN (SELECT AccountId FROM Cash)
             THEN b.Amount1 ELSE 0 END) / 1000000.0 AS Recv_From_Supplier_M,
    MAX(s.MonthlyCapRef) / 1000000.0 AS Monthly_Cap_Ref_M,
    COUNT(*) AS Bond_Count
FROM Suppliers s
JOIN Bonds b
    ON (b.AccountFromId = s.AccountId OR b.AccountToId = s.AccountId)
   AND b.Deleted = 0
   AND ISNULL(b.IsEdit, 0) = 0
   AND b.Date >= '2022-05-01' AND b.Date < '2026-05-01'
GROUP BY s.Name, FORMAT(b.Date, 'yyyy-MM')
ORDER BY s.Name, YearMonth;
