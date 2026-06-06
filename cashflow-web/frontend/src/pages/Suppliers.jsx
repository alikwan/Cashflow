// البيت السعيد — الموردون الـ14
//
// Pixel-parity port of design-reference/project/src/Suppliers.jsx. The visual
// layout (KPI strip, monthly heat-grid table, USD-balance figures, hover tip)
// is preserved. The ONLY changes are the Task D3 data-source transforms:
//   1. React UMD globals → ES imports.
//   2. window.DATA → useSuppliers() + useCashflow() (last-12 month labels) +
//      useMeta() (USD rate), per cashflow-web/docs/discovery/06 §5.
//   3. window.showToast(...) → const { showToast } = useToast().
//   4. Object.assign(window, …) → a named `export function Suppliers`.
//   5. NEW loading + error states.
//
// `D.last12` (the heat-grid month labels) has no dedicated supplier endpoint —
// it comes from the cashflow months tail (06 §5 gotcha). The grid is aligned to
// Math.min(monthly.length, last12.length) so a supplier with <12 months never
// reads past the label list.
import React, { useState } from "react";
import { Icon, Card, SectionHeader, Badge, Button, MiniStat, useToast } from "../components/Primitives";
import { cssVar } from "../components/Charts";
import { PageHeader } from "../components/Shell";
import { useSuppliers, useCashflow, useMeta } from "../api/hooks";
import * as fmt from "../lib/format";
import { PageState } from "./PageState";

function CurBadge({ cur }) {
  if (cur === 'USD') return <Badge tone="amber">دولار</Badge>;
  if (cur === 'MIX') return <Badge tone="purple">مختلط</Badge>;
  return <Badge tone="gray">دينار</Badge>;
}

export function Suppliers({ caps = null, overCapWarn = true, exchangeRate }) {
  const { showToast } = useToast();
  const F = fmt;
  const [hover, setHover] = useState(null); // {si, mi, val, cap, name, month}

  // Compose the hooks this page needs (per the 06 contract §5).
  const sup = useSuppliers();   // SUPPLIERS[] (id/name/cur/cap/monthly/overCap/balance/total12)
  const cf = useCashflow();     // months[] → last-12 month labels (greg/label)
  const meta = useMeta();       // USD_RATE fallback for the exchange rate

  const loading = sup.loading || cf.loading || meta.loading;
  const error = sup.error || cf.error || meta.error;

  if (loading || error || !sup.data || !cf.data || !meta.data) {
    return (
      <div style={{ padding: '24px 28px 48px' }}>
        <PageState
          loading={loading}
          error={error}
          onRetry={() => { sup.refetch(); cf.refetch(); meta.refetch(); }}
        />
      </div>
    );
  }

  // ---- Loaded view (pixel-parity) ----
  const rate = exchangeRate || meta.data.USD_RATE;
  const capOf = (s) => caps && caps[s.id] != null ? caps[s.id] : s.cap;
  const sups = sup.data.suppliers || [];
  // Month labels for the heat-grid columns = the last 12 cashflow months.
  const last12 = (cf.data.months || []).slice(-12);
  const monthsLbl = last12.map(m => String(m.greg).padStart(2, '0'));
  const maxCell = Math.max(0, ...sups.flatMap(s => s.monthly));
  const totalAll = sups.reduce((a, s) => a + s.total12, 0);
  const totalOver = overCapWarn
    ? sups.reduce((a, s) => a + s.monthly.filter(v => capOf(s) > 0 && v > capOf(s)).length, 0)
    : 0;
  const usdSups = sups.filter(s => s.cur === 'USD');
  const usdBalance = usdSups.reduce((a, s) => a + s.balance, 0);

  const money = (m) => F.fmtM(m);

  return (
    <div style={{ padding: '24px 28px 48px' }}>
      <PageHeader title="الموردون الـ14" subtitle="مدفوعات آخر 12 شهراً لكل موزّع رئيسي، مع تظليل الأشهر التي تجاوزت السقف المرجعي. الموردون الدولاريون تُموَّل أرصدتهم عبر الصيرفة."
        actions={<Button variant="secondary" size="sm" icon="download" onClick={() => showToast('تم تجهيز ملف الموردين')}>تصدير</Button>} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 16, marginBottom: 22 }}>
        <MiniStat label="إجمالي مدفوعات الـ14 · 12 شهر" value={money(totalAll)} unit={F.unitM(totalAll)} tone="primary" icon="truck" note="الموزّعون الرئيسيون" />
        <MiniStat label="حالات تجاوز السقف" value={String(totalOver)} unit="حالة شهرية" tone="warning" icon="warn" note="عبر كل الموردين" />
        <MiniStat label="موردون بالدولار" value={String(usdSups.length)} unit="موردين" tone="slate" icon="dollar" note="الحافظ · المهندس · ميديا فوكس · الريان" />
        <MiniStat label="أرصدة مستحقة (دولاري)" value={F.fmtUSD(usdBalance, rate)} unit="≈ بالدولار" tone="warning" icon="scale" note="تُموَّل بالصيرفة" />
      </div>

      <Card padding={0} style={{ position: 'relative' }}>
        <div style={{ padding: '18px 20px 10px' }}>
          <SectionHeader title="مدفوعات الموردين الشهرية" subtitle="كل خلية شهر · الإطار الأحمر = تجاوز السقف · شدّة اللون = حجم الدفعة" icon="truck" />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 920 }}>
            <thead>
              <tr style={{ color: 'var(--slate-500)', fontSize: 11 }}>
                <th style={{ textAlign: 'right', padding: '6px 20px', fontWeight: 600, position: 'sticky', insetInlineStart: 0, background: '#fff' }}>المورد</th>
                <th style={{ textAlign: 'center', padding: '6px 6px', fontWeight: 600 }}>السقف</th>
                {monthsLbl.map((m, i) => <th key={i} className="num" style={{ textAlign: 'center', padding: '6px 2px', fontWeight: 600, width: 30 }}>{m}</th>)}
                <th style={{ textAlign: 'left', padding: '6px 14px', fontWeight: 600 }}>الإجمالي</th>
                <th style={{ textAlign: 'left', padding: '6px 20px', fontWeight: 600 }}>الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {sups.map((s, si) => {
                // Align the grid to the shorter of monthly / month-labels so a
                // supplier with <12 months never reads past the label list.
                const cells = s.monthly.slice(0, Math.min(s.monthly.length, last12.length));
                return (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--slate-100)' }}>
                    <td style={{ padding: '8px 20px', position: 'sticky', insetInlineStart: 0, background: '#fff' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 600, color: 'var(--slate-800)' }}>{s.name}</span>
                        <CurBadge cur={s.cur} />
                      </div>
                    </td>
                    <td className="num" style={{ textAlign: 'center', padding: '8px 6px', color: capOf(s) ? 'var(--slate-600)' : 'var(--slate-300)' }}>{capOf(s) || '—'}</td>
                    {cells.map((v, mi) => {
                      const cap = capOf(s);
                      const over = overCapWarn && cap > 0 && v > cap;
                      const intensity = maxCell ? Math.min(1, v / maxCell) : 0;
                      const monthLabel = last12[mi] ? last12[mi].label : '';
                      return (
                        <td key={mi} style={{ padding: '3px 2px', textAlign: 'center' }}
                          onMouseEnter={() => setHover({ si, mi, val: v, cap: capOf(s), name: s.name, month: monthLabel, over, cur: s.cur })}
                          onMouseLeave={() => setHover(null)}>
                          <div style={{
                            width: 26, height: 26, margin: '0 auto', borderRadius: 6,
                            background: `color-mix(in oklab, ${over ? 'var(--danger-500)' : 'var(--primary-500)'} ${15 + intensity * 70}%, white)`,
                            border: over ? '2px solid var(--danger-600)' : '1px solid var(--slate-100)',
                            cursor: 'default', transition: 'transform 120ms',
                            transform: hover && hover.si === si && hover.mi === mi ? 'scale(1.18)' : 'none',
                          }} />
                        </td>
                      );
                    })}
                    <td className="num" style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--slate-900)' }}>{money(s.total12)}</td>
                    <td className="num" style={{ padding: '8px 20px', textAlign: 'left', color: 'var(--slate-500)' }}>
                      {s.cur === 'USD' ? F.fmtUSD(s.balance, rate) : money(s.balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hover && (
          <div style={{ position: 'absolute', bottom: 14, insetInlineStart: 20, background: 'var(--slate-900)', color: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 12, boxShadow: 'var(--shadow-lg)', lineHeight: 1.5, pointerEvents: 'none' }}>
            <b>{hover.name}</b> · {hover.month}<br />
            دفعة <span className="num" style={{ fontWeight: 700 }}>{F.fmtM(hover.val)}</span> مليون
            {hover.cap > 0 && <span style={{ color: hover.over ? 'var(--danger-300)' : 'var(--slate-400)' }}> · السقف {hover.cap}{hover.over ? ' (تجاوز)' : ''}</span>}
          </div>
        )}
      </Card>

      <div style={{ fontSize: 12, color: 'var(--slate-400)', marginTop: 12, textAlign: 'center' }}>
        القيم بالمليون دينار · أرصدة الموردين الدولاريين معروضة بالدولار بسعر صرف {rate.toLocaleString('en-US')} د.ع
      </div>
    </div>
  );
}

export default Suppliers;
