# 00 — فحص مخطّط القاعدة الحيّة (مهمة تحقّق إلزامية A1)

**التاريخ:** 2026-06-02 | **القاعدة:** `AlBaytAlSaeid` (SQL Server، حاوية `mssql-server`)

## النتيجة: ✅ المخطّط يطابق `CLAUDE.md`

- **عدد سندات `Bonds`** = **208,339** (مطابق للموثّق).
- **أعمدة `Bonds` الأساسية مؤكّدة الوجود والأنواع:**

| العمود | النوع |
|--------|-------|
| Id | int |
| Date | datetime2 |
| Amount1 | decimal |
| Currency1Id | int |
| Rate1 | decimal |
| AccountFromId | int |
| AccountToId | int |
| Deleted | bit |
| IsEdit | bit |
| OperationsType | int |
| Reason | nvarchar |

- جداول `accounts`, `tAccounts`, `Premiums`, `PremiumPays` موجودة (انظر 01 لأعمدة الأقساط).

## الأثر على التنفيذ
لا تغييرات على منطق التصنيف (§4.1) — `OperationsType` + `Amount1` (بالدينار) + الفلاتر (`Deleted=0`, `ISNULL(IsEdit,0)=0`) كلها صالحة كما في المواصفة.
