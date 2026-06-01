-- =============================================================
-- 05_balances_snapshot.sql
-- لقطة الأرصدة الحالية: الموردون الـ14 + أعلى الزبائن المدينين
-- =============================================================

USE AlBaytAlSaeid;

-- 1) أرصدة الـ14 موزّعاً (بكل عملة)
WITH Suppliers(AccountId, Name) AS (
    SELECT v1, v2 FROM (VALUES
        (1001, N'01-معرض البركة'),
        (2079, N'02-هيثم'),
        (2093, N'03-وميض'),
        (2432, N'04-حميد الشطباوي'),
        (2440, N'05-معرض الهادي'),
        (2700, N'06-معرض اولاد شفيق'),
        (3123, N'07-العطاوي للمفروشات'),
        (3916, N'08-شركة اصل القمة'),
        (5721, N'09-قاسم بايسكلات'),
        (2439, N'10-معرض الواحة سامراء'),
        (4937, N'11-شركة الحافظ'),
        (6444, N'12-كهربائيات المهندس'),
        (6552, N'13-دكتور يوسف ميديا فوكس'),
        (6918, N'14-شركة الريان بغداد')
    ) v(v1, v2)
)
SELECT
    s.Name AS Supplier,
    ta.CurrencyId,
    CASE ta.CurrencyId WHEN 1 THEN N'دينار' WHEN 2 THEN N'دولار' ELSE N'أخرى' END AS Currency,
    ta.Balance / 1000000.0 AS Balance_M,
    ta.LastActive
FROM Suppliers s
LEFT JOIN tAccounts ta ON ta.AccountId = s.AccountId
ORDER BY s.Name, ta.CurrencyId;

-- 2) متوسط سعر الصرف من السندات الـ12 شهر الأخيرة
SELECT
    'Avg_USD_Rate_Last_12M' AS Metric,
    AVG(Rate1) AS AvgRate,
    MIN(Rate1) AS MinRate,
    MAX(Rate1) AS MaxRate,
    COUNT(*) AS BondCount
FROM Bonds
WHERE Deleted = 0 AND Currency1Id = 2 AND Rate1 > 0
  AND Date >= DATEADD(MONTH, -12, '2026-05-13');

-- 3) إجمالي رصيد الصناديق الحالي
SELECT
    'Cash_Total_Balance' AS Section,
    a.AccountId,
    a.Name AS BoxName,
    ta.CurrencyId,
    ta.Balance / 1000000.0 AS Balance_M
FROM accounts a
LEFT JOIN tAccounts ta ON ta.AccountId = a.AccountId
WHERE a.AccountTypeId IN (1811, 1812) AND a.Deleted = 0
ORDER BY a.AccountId, ta.CurrencyId;

-- 4) أعلى 30 زبون عليهم ذمم (قطاع 1631)
SELECT TOP 30
    a.AccountId,
    a.Name,
    ta.CurrencyId,
    ta.Balance / 1000000.0 AS Balance_M
FROM accounts a
JOIN tAccounts ta ON ta.AccountId = a.AccountId
WHERE a.AccountTypeId = 1631 AND a.Deleted = 0
  AND ta.Balance > 0
ORDER BY ta.Balance DESC;
