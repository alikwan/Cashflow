// البيت السعيد — الأقساط المفتوحة
//
// Pixel-parity port of design-reference/project/src/Installments.jsx. The
// layout (KPI strip, aging donut, aging detail bars, top-debtors table, info
// banner) is preserved. The changes are the Task D3 data-source transforms +
// two contract-mandated corrections (06 §6):
//   1. React UMD globals → ES imports.
//   2. window.DATA → useInstallments(), per the 06 contract §6.
//   3. window.showToast(...) → const { showToast } = useToast().
//   4. Object.assign(window, …) → a named `export function Installments`.
//   5. NEW loading + error states.
//   6. The outstanding total is summary.remaining_m (≈1260) — the hard-coded
//      "4.67 مليار" string is REMOVED; the banner renders the live `total`.
//   7. top_debtors has NO contract/bucket/due (data.js mock-only, account-level
//      API) — those three columns are dropped; the table renders only the
//      account name + outstanding balance, gracefully.
import React from "react";
import { Icon, Card, SectionHeader, Button, MiniStat, useToast } from "../components/Primitives";
import { Donut, cssVar } from "../components/Charts";
import { PageHeader } from "../components/Shell";
import { useInstallments } from "../api/hooks";
import * as fmt from "../lib/format";
import { PageState } from "./PageState";

export function Installments() {
  const { showToast } = useToast();
  const F = fmt;

  const inst = useInstallments();
  const loading = inst.loading;
  const error = inst.error;

  if (loading || error || !inst.data) {
    return (
      <div style={{ padding: '24px 28px 48px' }}>
        <PageState loading={loading} error={error} onRetry={inst.refetch} />
      </div>
    );
  }

  // ---- Loaded view (pixel-parity) ----
  const D = inst.data;
  const total = D.total;                       // ← summary.remaining_m (≈1260, NOT 4670)
  const aging = D.aging || [];
  const topDebtors = D.topDebtors || [];
  const totalCount = aging.reduce((a, b) => a + b.count, 0);
  // Guard the .find()s — the bucket may be absent on an early/empty DB.
  const current = aging.find(a => a.key === 'current');
  const b120 = aging.find(a => a.key === 'b120');
  const notDue = current ? current.amount : 0;
  const overdue = total - notDue;
  // Reconcile the dated buckets (Σ aging) to the plan-level total (D.total): the
  // difference is outstanding at the contract level with no single dated installment
  // (settled/adjusted rows). Show it as an explicit slice so the donut + percentages
  // add up to the headline total instead of falling ~4% short of it.
  const agingSum = aging.reduce((a, b) => a + b.amount, 0);
  const undated = total - agingSum;
  const agingDisplay = undated > 0.5
    ? [...aging, { key: 'undated', label: 'قائم بلا تاريخ استحقاق', amount: undated, color: '--slate-300', count: null }]
    : aging;
  const seg = agingDisplay.map(a => ({ label: a.label, value: a.amount, color: a.color }));
  const maxAging = Math.max(0, ...agingDisplay.map(a => a.amount));
  const pct = (v) => total ? (v / total * 100).toFixed(0) : '0';
  const overdueLate = aging
    .filter(a => ['b61_90', 'b91_120', 'b120'].includes(a.key))
    .reduce((s, a) => s + a.amount, 0);

  const money = (m) => F.fmtM(m);

  return (
    <div style={{ padding: '24px 28px 48px' }}>
      <PageHeader title="الأقساط المفتوحة" subtitle="الرصيد المتبقي على الزبائن — مصدر سيولة مستقبلي مهم. التوزيع حسب أعمار الديون (aging)."
        actions={<Button variant="secondary" size="sm" icon="download" onClick={() => showToast('تم تجهيز كشف الأقساط')}>تصدير</Button>} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px,1fr))', gap: 16, marginBottom: 22 }}>
        <MiniStat label="إجمالي الأقساط المستحقة" value={money(total)} unit={F.unitM(total)} tone="primary" icon="doc" note={`${F.fmtInt(totalCount)} قسط مفتوح`} />
        <MiniStat label="لم يستحق بعد (جاري)" value={money(notDue)} unit={F.unitM(notDue)} tone="success" icon="check" note={`${pct(notDue)}% من الإجمالي`} />
        <MiniStat label="مستحق ومتأخر" value={money(overdue)} unit={F.unitM(overdue)} tone="warning" icon="clock" note={`${pct(overdue)}% بحاجة متابعة`} />
        <MiniStat label="متعثّر (+120 يوم)" value={money(b120 ? b120.amount : 0)} unit={F.unitM(total)} tone="danger" icon="warn" note="أعلى مخاطر تحصيل" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 22, marginBottom: 22 }}>
        <Card>
          <SectionHeader title="توزيع أعمار الديون" subtitle="حسب تأخّر الاستحقاق" icon="scale" />
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <Donut segments={seg} size={196} thickness={30} centerLabel={money(total)} centerSub={F.unitM(total)} />
          </div>
        </Card>

        <Card>
          <SectionHeader title="تفصيل الأعمار" subtitle="المبلغ وعدد الأقساط لكل شريحة" icon="filter" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {agingDisplay.map((a, i) => (
              <div key={i}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--slate-700)', fontWeight: 600 }}>
                    <span style={{ width: 11, height: 11, borderRadius: 3, background: cssVar(a.color) }} />{a.label}
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--slate-400)' }}>
                    <span className="num" style={{ fontWeight: 700, color: 'var(--slate-900)', fontSize: 14 }}>{money(a.amount)}</span> مليون{a.count != null ? <> · <span className="num">{F.fmtInt(a.count)}</span> قسط</> : null}
                  </span>
                </div>
                <div style={{ height: 9, background: 'var(--slate-100)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${maxAging ? a.amount / maxAging * 100 : 0}%`, height: '100%', background: cssVar(a.color), borderRadius: 999, transition: 'width 300ms' }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card padding={0}>
        <div style={{ padding: '18px 20px 10px' }}>
          <SectionHeader title="أكبر المدينين" subtitle="الزبائن أصحاب أعلى أرصدة مفتوحة" icon="users" />
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead><tr style={{ color: 'var(--slate-500)', fontSize: 12 }}>
            <th style={{ textAlign: 'right', padding: '9px 20px', fontWeight: 600 }}>الزبون</th>
            <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 600 }}>رقم الحساب</th>
            <th style={{ textAlign: 'left', padding: '9px 20px', fontWeight: 600 }}>الرصيد المتبقي</th>
          </tr></thead>
          <tbody>
            {topDebtors.map((d, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--slate-100)' }}>
                <td style={{ padding: '11px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 32, height: 32, borderRadius: 10, background: '#0891B2', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Tajawal', fontWeight: 700, fontSize: 12, flex: 'none' }}>{d.name.split(' ').slice(0, 2).map(w => w[0]).join('')}</span>
                    <span style={{ fontWeight: 600, color: 'var(--slate-800)' }}>{d.name}</span>
                  </div>
                </td>
                <td className="num" style={{ padding: '11px 10px', color: 'var(--slate-500)' }}>{d.accountId ?? '—'}</td>
                <td className="num" style={{ padding: '11px 20px', textAlign: 'left', fontWeight: 700, color: 'var(--slate-900)' }}>{d.balance.toFixed(1)} <span style={{ fontSize: 11, color: 'var(--slate-400)', fontWeight: 500 }}>مليون</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div style={{ marginTop: 16, padding: '14px 18px', background: 'var(--primary-50)', border: '1px solid var(--primary-200)', borderRadius: 14, fontSize: 13, color: 'var(--primary-700)', lineHeight: 1.6, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Icon name="info" className="w-5 h-5" style={{ flex: 'none', marginTop: 1 }} />
        <span>تمثّل الأقساط المفتوحة احتياطي سيولة مستقبلياً بقيمة <b className="num">{money(total)}</b> <span className="num">{F.unitM(total)}</span>. تسريع تحصيل الشرائح المتأخرة (61 يوماً فأكثر) قد يضخّ نحو <b className="num">{money(overdueLate)}</b> مليون د.ع في الصناديق.</span>
      </div>
    </div>
  );
}

export default Installments;
