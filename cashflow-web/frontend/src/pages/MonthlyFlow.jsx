// البيت السعيد — التدفق الشهري
//
// Pixel-parity port of design-reference/project/src/MonthlyFlow.jsx. The layout
// (60-month line chart, FY tabs, aggregate strip, net bars, months table) is
// preserved byte-for-byte. The ONLY changes are the Task D2 data-source
// transforms:
//   1. React UMD globals → ES imports.
//   2. window.DATA → useCashflow() (months[] + forecast[]), per the 06 contract.
//   3. window.showToast(...) → const { showToast } = useToast().
//   4. Object.assign(window, …) → a named `export function MonthlyFlow`.
//   5. NEW loading + error states.
import React, { useState } from "react";
import { Card, SectionHeader, Button, SegmentedTabs, useToast } from "../components/Primitives";
import { LineChart, BarChart } from "../components/Charts";
import { PageHeader } from "../components/Shell";
import { useCashflow } from "../api/hooks";
import * as fmt from "../lib/format";
import { PageState } from "./PageState";

const F = fmt;

export function MonthlyFlow({ negThreshold = 0 }) {
  const { showToast } = useToast();
  const [fy, setFy] = useState('FY25');

  const cf = useCashflow();
  const loading = cf.loading;
  const error = cf.error;

  // أشهر الجدول حسب التبويب (ثابتة — مُستخدمة في كل الحالات).
  const tabs = [
    { id: 'FY25', label: '2025/2026' },
    { id: 'FY24', label: '2024/2025' },
    { id: 'FY23', label: '2023/2024' },
    { id: 'FY22', label: '2022/2023' },
    { id: 'FC',   label: 'التنبؤ' },
  ];

  if (loading || error || !cf.data) {
    return (
      <div style={{ padding: '24px 28px 48px' }}>
        <PageState loading={loading} error={error} onRetry={cf.refetch} />
      </div>
    );
  }

  // ---- Loaded view (pixel-parity) ----
  const hist = cf.data.months || [], fc = cf.data.forecast || [];
  const labels = [...hist.map(m => m.short), ...fc.map(m => m.short)];
  const inS  = [...hist.map(m => m.in),  ...fc.map(m => m.base.in)];
  const outS = [...hist.map(m => m.out), ...fc.map(m => m.base.out)];
  const netS = [...hist.map(m => m.net), ...fc.map(m => m.base.net)];

  const rows = fy === 'FC'
    ? fc.map(m => ({ label: m.label, short: m.short, in: m.base.in, out: m.base.out, net: m.base.net, forecast: true }))
    : hist.filter(m => m.fy === fy).map(m => ({ label: m.label, short: m.short, in: m.in, out: m.out, net: m.net, cash: m.cash }));

  // تراكمي ضمن السنة
  let cum = 0; rows.forEach(r => { cum += r.net; r.cum = cum; });

  const agg = rows.reduce((a, r) => ({ in: a.in + r.in, out: a.out + r.out, net: a.net + r.net }), { in: 0, out: 0, net: 0 });

  const money = (m) => `${F.fmtM(m)}`;
  const activeTabLabel = (tabs.find(t => t.id === fy) || {}).label || '';

  return (
    <div style={{ padding: '24px 28px 48px' }}>
      <PageHeader title="التدفق الشهري" subtitle="حركة الداخل والخارج والصافي على مدى 60 شهراً (48 فعلي + 12 متوقع). القيم بالمليون دينار."
        actions={<Button variant="secondary" size="sm" icon="download" onClick={() => showToast('تم تجهيز ملف التدفق الشهري')}>تصدير</Button>} />

      {/* Full line chart */}
      <Card style={{ marginBottom: 22 }}>
        <SectionHeader title="المقبوضات · المصروفات · الصافي" subtitle="الخط المنقّط = فترة التنبؤ المتحفّظ" icon="chart" />
        <LineChart height={330} labels={labels} forecastFrom={hist.length - 1} formatY={F.fmtM} tickEvery={6}
          series={[
            { key: 'in',  label: 'المقبوضات', color: '--chart-2', values: inS, area: true, width: 2.25 },
            { key: 'out', label: 'المصروفات', color: '--chart-3', values: outS, width: 2 },
            { key: 'net', label: 'الصافي',    color: '--chart-1', values: netS, width: 2.75 },
          ]} />
      </Card>

      {/* Tabs + net bars + table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <SegmentedTabs items={tabs} value={fy} onChange={setFy} size="sm" />
        <div style={{ display: 'flex', gap: 22, fontSize: 13 }}>
          <span style={{ color: 'var(--slate-500)' }}>مقبوضات <b className="num" style={{ color: 'var(--success-700)', marginInlineStart: 4 }}>{money(agg.in)}</b></span>
          <span style={{ color: 'var(--slate-500)' }}>مصروفات <b className="num" style={{ color: 'var(--chart-3)', marginInlineStart: 4 }}>{money(agg.out)}</b></span>
          <span style={{ color: 'var(--slate-500)' }}>الصافي <b className="num" style={{ color: agg.net >= 0 ? 'var(--success-700)' : 'var(--danger-600)', marginInlineStart: 4 }}>{agg.net >= 0 ? '+' : ''}{money(agg.net)}</b></span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 22 }}>
        <Card>
          <SectionHeader title="الصافي الشهري" subtitle={activeTabLabel} icon="scale" />
          <BarChart height={300} data={rows.map(r => ({ label: r.short, value: r.net }))} formatY={F.fmtM} unit="مليون د.ع"
            colorFor={(v) => v >= 0 ? '--chart-2' : '--chart-5'} />
          <div style={{ fontSize: 11.5, color: 'var(--slate-400)', marginTop: 6, textAlign: 'center' }}>الأخضر = صافي موجب · الأحمر = صافي سالب</div>
        </Card>

        <Card padding={0}>
          <div style={{ padding: '18px 20px 12px' }}>
            <SectionHeader title="تفصيل الأشهر" subtitle={`${rows.length} شهر`} icon="calendar" />
          </div>
          <div style={{ maxHeight: 340, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--slate-50)', zIndex: 1 }}>
                <tr style={{ color: 'var(--slate-500)', fontSize: 12 }}>
                  <th style={{ textAlign: 'right', padding: '9px 16px', fontWeight: 600, width: '24%' }}>الشهر</th>
                  <th style={{ textAlign: 'left', padding: '9px 8px', fontWeight: 600 }}>مقبوضات</th>
                  <th style={{ textAlign: 'left', padding: '9px 8px', fontWeight: 600 }}>مصروفات</th>
                  <th style={{ textAlign: 'left', padding: '9px 8px', fontWeight: 600 }}>الصافي</th>
                  <th style={{ textAlign: 'left', padding: '9px 12px', fontWeight: 600 }}>{fy === 'FC' ? 'تراكمي' : 'الرصيد'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--slate-100)', background: r.net < negThreshold ? 'var(--danger-50)' : 'transparent' }}>
                    <td style={{ padding: '9px 16px', color: 'var(--slate-700)', whiteSpace: 'nowrap' }}>{r.label}{r.forecast && <span style={{ fontSize: 10, color: 'var(--slate-400)', marginInlineStart: 5 }}>متوقع</span>}</td>
                    <td className="num" style={{ padding: '9px 8px', textAlign: 'left', color: 'var(--slate-700)' }}>{money(r.in)}</td>
                    <td className="num" style={{ padding: '9px 8px', textAlign: 'left', color: 'var(--slate-700)' }}>{money(r.out)}</td>
                    <td className="num" style={{ padding: '9px 8px', textAlign: 'left', fontWeight: 700, color: r.net >= 0 ? 'var(--success-700)' : 'var(--danger-600)' }}>{r.net >= 0 ? '+' : ''}{money(r.net)}</td>
                    <td className="num" style={{ padding: '9px 12px', textAlign: 'left', color: 'var(--slate-500)' }}>{money(fy === 'FC' ? r.cum : r.cash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default MonthlyFlow;
