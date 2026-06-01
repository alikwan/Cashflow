-- =============================================================
-- 04_open_installments.sql
-- الأقساط المفتوحة وأقساط الزبائن المستحقة لاحقاً
-- =============================================================

USE AlBaytAlSaeid;

-- إجمالي الأقساط المفتوحة (التزام مستقبلي للزبائن لصالحنا)
SELECT
    'Open_Installments_Summary' AS Section,
    COUNT(DISTINCT p.Id) AS PremiumCnt,
    SUM(p.TotalAmount) / 1000000.0 AS TotalCommitted_M,
    SUM(ISNULL(pp.PaidSum, 0)) / 1000000.0 AS Paid_M,
    (SUM(p.TotalAmount) - SUM(ISNULL(pp.PaidSum, 0))) / 1000000.0 AS Remaining_M
FROM Premiums p
OUTER APPLY (
    SELECT SUM(Amount) AS PaidSum
    FROM PremiumPays
    WHERE PremiumId = p.Id AND Deleted = 0
) pp
WHERE p.Deleted = 0 AND p.Date >= '2022-01-01';

-- الأقساط الشهرية الفعلية المُحصّلة (من PremiumPays) خلال الـ4 سنوات
SELECT
    FORMAT(pp.Date, 'yyyy-MM') AS YearMonth,
    COUNT(*) AS PayCount,
    SUM(pp.Amount) / 1000000.0 AS PaidAmount_M
FROM PremiumPays pp
WHERE pp.Deleted = 0
  AND pp.Date >= '2022-05-01' AND pp.Date < '2026-05-01'
GROUP BY FORMAT(pp.Date, 'yyyy-MM')
ORDER BY YearMonth;

-- خطط الأقساط المُنشأة شهرياً (التزامات جديدة)
SELECT
    FORMAT(p.Date, 'yyyy-MM') AS YearMonth,
    COUNT(*) AS NewPlans,
    SUM(p.TotalAmount) / 1000000.0 AS TotalCommitted_M,
    SUM(p.PremiumPayAmount) / 1000000.0 AS MonthlyInstallment_M
FROM Premiums p
WHERE p.Deleted = 0
  AND p.Date >= '2022-05-01' AND p.Date < '2026-05-01'
GROUP BY FORMAT(p.Date, 'yyyy-MM')
ORDER BY YearMonth;
