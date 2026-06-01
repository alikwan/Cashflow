-- =============================================================
-- 06_audit_checks.sql
-- طبقات التحقق المحاسبي والشذوذ
-- =============================================================

USE AlBaytAlSaeid;

-- 1) عدد السندات شهرياً (تطابق التغطية)
SELECT
    'Bond_Counts_By_Month' AS Section,
    FORMAT(Date, 'yyyy-MM') AS YearMonth,
    COUNT(*) AS BondCount,
    SUM(CASE WHEN Currency1Id=1 THEN 1 ELSE 0 END) AS Dinar_Bonds,
    SUM(CASE WHEN Currency1Id=2 THEN 1 ELSE 0 END) AS Dollar_Bonds,
    SUM(CASE WHEN Currency1Id NOT IN (1,2) THEN 1 ELSE 0 END) AS Other_Cur_Bonds,
    SUM(CASE WHEN OperationsType=0 THEN 1 ELSE 0 END) AS OpType_0,
    SUM(CASE WHEN OperationsType<>0 THEN 1 ELSE 0 END) AS OpType_Other
FROM Bonds
WHERE Deleted = 0
  AND Date >= '2022-05-01' AND Date < '2026-05-01'
  AND ISNULL(IsEdit, 0) = 0
GROUP BY FORMAT(Date, 'yyyy-MM')
ORDER BY YearMonth;

-- 2) سندات مستقبلية (مؤجلة)
SELECT
    'Future_Bonds' AS Section,
    COUNT(*) AS FutureBondCount,
    MIN(Date) AS Min_Future_Date,
    MAX(Date) AS Max_Future_Date,
    SUM(Amount1) / 1000000.0 AS Total_Future_Amount_M
FROM Bonds
WHERE Deleted = 0 AND Date > '2026-05-13';

-- 3) أكبر 20 سند (للمراجعة - شذوذ محتمل)
SELECT TOP 20
    'Top_20_Bonds' AS Section,
    b.Id,
    b.Date,
    b.Amount1 / 1000000.0 AS Amount_M,
    CASE b.Currency1Id WHEN 1 THEN N'دينار' WHEN 2 THEN N'دولار' END AS Currency,
    af.Name AS FromAccount,
    at.Name AS ToAccount,
    af.AccountTypeId AS FromType,
    at.AccountTypeId AS ToType,
    LEFT(b.Reason, 60) AS Reason
FROM Bonds b
LEFT JOIN accounts af ON af.AccountId = b.AccountFromId
LEFT JOIN accounts at ON at.AccountId = b.AccountToId
WHERE b.Deleted = 0
  AND b.Date >= '2022-05-01' AND b.Date < '2026-05-01'
ORDER BY b.Amount1 DESC;

-- 4) السندات المعدّلة (للأمان)
SELECT
    'Edited_Bonds_Counts' AS Section,
    COUNT(*) AS Cnt
FROM Bonds
WHERE Deleted = 0 AND IsEdit = 1
  AND Date >= '2022-05-01' AND Date < '2026-05-01';

-- 5) تحقق المعقولية: أيام النشاط
SELECT
    'Active_Days_Per_Year' AS Section,
    YEAR(Date) AS Yr,
    COUNT(DISTINCT CAST(Date AS DATE)) AS ActiveDays,
    COUNT(*) AS Bonds,
    SUM(Amount1) / 1000000.0 AS Total_M
FROM Bonds
WHERE Deleted = 0
  AND Date >= '2022-05-01' AND Date < '2026-05-01'
GROUP BY YEAR(Date)
ORDER BY Yr;
