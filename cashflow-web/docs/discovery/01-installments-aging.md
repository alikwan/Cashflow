# 01 — حقول استحقاق الأقساط (مهمة تحقّق إلزامية A2)

**التاريخ:** 2026-06-02

## النتيجة: ⚠️ لا توجد حقول "تاريخ استحقاق" لكل قسط

**أعمدة `Premiums`:** Id, AccountId, BillId, CurrencyId, Date, Deleted, FirstPay, **InitDate**, MachineDate, Note, **PremiumNo**, PremiumPayAmount, **PremiumType**, RowVersion, SponsorId, TotalAmount, UserId, QCard, DistributorId, Note2.

**أعمدة `PremiumPays`:** Id, AccountId, Amount, CurrencyId, Date, Deleted, PremiumId, PremiumState, RowVersion, UserId, index, QCardId, EnjazBillID, EnjazgroupID, Account2Id, Account2Name, **DatePay**, Discount.

- التواريخ المتاحة كلها **إنشاء/دفع** (`Date`, `InitDate`, `MachineDate`, `DatePay`) — **لا عمود due-date** لكل قسط.
- `PremiumType` توزيعه: النوع `1` = 19,715 (≈98.6%)، وأنواع 2–5 قليلة جداً. لا يوجد جدول جدولة استحقاقات مستقل.

## ⏳ الحالة: قيد فحص أعمق (لا قرار نهائي)

> **تحديث 2026-06-02 (ملاحظة المالك):** أكّد المالك أن الأقساط **مُدارة جيداً في القاعدة الأصلية** — أي أن بيانات الجدولة/الاستحقاق **موجودة على الأرجح** في مكان لم يشمله الفحص الأولي (الذي اقتصر على أعمدة `Premiums`/`PremiumPays` فقط). **الفحص كان قاصراً.**

**الإجراء المطلوب قبل أي قرار بشأن الأعمار** (مسح شامل):
1. `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES` — تعداد كل الجداول، والبحث عن أسماء مثل `*Installment*` / `*Schedule*` / `*Due*` / `*Bill*` / تفاصيل الأقساط.
2. تتبّع `Premiums.BillId` → جدول الفواتير، و`Premiums.PremiumNo`/`PremiumType` → احتمال جدول سطور/جدولة.
3. فحص العلاقات (FKs) من `Premiums`/`PremiumPays` لاكتشاف جدول الاستحقاقات.

**لا يُعتمد إسقاط الأعمار حتى يكتمل هذا الفحص.** إن تبيّن فعلاً عدم وجود استحقاقات، نعود للخطة الاحتياطية (إجمالي/متبقٍ + كبار المدينين)؛ وإلا نبني شرائح الأعمار من المصدر الصحيح.

### الأثر على المواصفة/الخطط
- **يُسقط جدول `installments_aging`** من النسخة الأولى (المواصفة §3.1) — أو يُترك فارغاً.
- صفحة `Installments` (الخطة 3 / تصميم `data.js` `AGING`): تُخفى لوحة الأعمار، أو تُستبدل بملاحظة "غير متاحة (لا حقول استحقاق في المصدر)".
- **مستقبلاً:** يمكن اشتقاق استحقاقات تقريبية من `InitDate` + `PremiumNo` + دورية `PremiumType` (إن تأكّدت دلالتها) — خارج نطاق v1.
