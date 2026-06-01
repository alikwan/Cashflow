# 01 — حقول استحقاق الأقساط (مهمة تحقّق إلزامية A2)

**التاريخ:** 2026-06-02

## النتيجة: ⚠️ لا توجد حقول "تاريخ استحقاق" لكل قسط

**أعمدة `Premiums`:** Id, AccountId, BillId, CurrencyId, Date, Deleted, FirstPay, **InitDate**, MachineDate, Note, **PremiumNo**, PremiumPayAmount, **PremiumType**, RowVersion, SponsorId, TotalAmount, UserId, QCard, DistributorId, Note2.

**أعمدة `PremiumPays`:** Id, AccountId, Amount, CurrencyId, Date, Deleted, PremiumId, PremiumState, RowVersion, UserId, index, QCardId, EnjazBillID, EnjazgroupID, Account2Id, Account2Name, **DatePay**, Discount.

- التواريخ المتاحة كلها **إنشاء/دفع** (`Date`, `InitDate`, `MachineDate`, `DatePay`) — **لا عمود due-date** لكل قسط.
- `PremiumType` توزيعه: النوع `1` = 19,715 (≈98.6%)، وأنواع 2–5 قليلة جداً. لا يوجد جدول جدولة استحقاقات مستقل.

## القرار (الخطة الاحتياطية المعتمدة)
**تُسقط شرائح الأعمار (aging buckets) من النسخة الأولى.** صفحة "الأقساط المفتوحة" تعرض: إجمالي الالتزامات + المُحصّل + **المتبقّي** (رقم واحد) + كبار المدينين — دون شرائح أعمار.

### الأثر على المواصفة/الخطط
- **يُسقط جدول `installments_aging`** من النسخة الأولى (المواصفة §3.1) — أو يُترك فارغاً.
- صفحة `Installments` (الخطة 3 / تصميم `data.js` `AGING`): تُخفى لوحة الأعمار، أو تُستبدل بملاحظة "غير متاحة (لا حقول استحقاق في المصدر)".
- **مستقبلاً:** يمكن اشتقاق استحقاقات تقريبية من `InitDate` + `PremiumNo` + دورية `PremiumType` (إن تأكّدت دلالتها) — خارج نطاق v1.
