// البيت السعيد — المقبوضات والمصروفات
//
// Pixel-parity port of design-reference/project/src/Breakdown.jsx. The layout
// (expense/receipts toggle, summary strips, stacked category bars, category
// table, partner-withdrawal bars, funds list, receipts bars) is preserved
// byte-for-byte. The ONLY changes are the Task D2 data-source transforms:
//   1. React UMD globals → ES imports.
//   2. window.DATA → useBreakdown() (expCats/partners/funds) + useCashflow()
//      (per-month receipts m.in) + useMeta() (CURRENT_CASH), per the 06 contract.
//   3. Object.assign(window, …) → a named `export function Breakdown`.
//   4. NEW loading + error states.
//
// The `sayrafa` category (API spelling `siyrafa`) is normalized to `sayrafa` by
// the useBreakdown mapper, so the page's `find(c => c.key === 'sayrafa')` works
// end-to-end — the siyrafa→sayrafa flow is what the D2 test pins.
import React, { useState } from "react";
import { Card, SectionHeader, MiniStat, Icon, SegmentedTabs } from "../components/Primitives";
import { StackedBarChart, BarChart, cssVar } from "../components/Charts";
import { PageHeader } from "../components/Shell";
import { useBreakdown, useCashflow, useMeta } from "../api/hooks";
import * as fmt from "../lib/format";
import { PageState } from "./PageState";

const F = fmt;

export function Breakdown() {
  const [view, setView] = useState('expenses');

  const bd = useBreakdown();   // expCats[].monthly, partners, funds
  const cf = useCashflow();    // months[].in (per-month receipts)
  const meta = useMeta();      // CURRENT_CASH (funds card header)

  const loading = bd.loading || cf.loading || meta.loading;
  const error = bd.error || cf.error || meta.error;

  if (loading || error || !bd.data || !cf.data || !meta.data) {
    return (
      <div style={{ padding: '24px 28px 48px' }}>
        <PageState
          loading={loading}
          error={error}
          onRetry={() => { bd.refetch(); cf.refetch(); meta.refetch(); }}
        />
      </div>
    );
  }

  // ---- Loaded view (pixel-parity) ----
  const expCats = bd.data.expCats || [];
  const CURRENT_CASH = meta.data.CURRENT_CASH ?? 0;

  // الأشهر الـ12 الأخيرة من سلسلة التدفق — محور المقبوضات والأعمدة المتراكمة.
  const last12 = (cf.data.months || []).slice(-12);

  // خريطة لكل فئة: year_month → القيمة (لبناء الأعمدة المتراكمة على نفس محور الأشهر).
  const catMonthMap = expCats.map(c => {
    const map = {};
    (c.monthly || []).forEach(mm => { map[mm.yearMonth] = mm.value; });
    return { key: c.key, name: c.name, chart: c.chart, type: c.type, map };
  });

  // stacked data — لكل شهر من last12، شريحة لكل فئة (القيمة من خريطة الفئة).
  const stacked = last12.map(m => ({
    label: m.short,
    segments: catMonthMap.map(c => ({ key: c.key, label: c.name, value: c.map[m.yearMonth] || 0, color: c.chart })),
  }));

  // category totals — يُحسب من total لكل فئة (مجموع آخر النافذة) من الـ API.
  const catTotals = expCats.map(c => ({
    key: c.key, name: c.name, chart: c.chart, type: c.type, total: c.total || 0,
  })).sort((a, b) => b.total - a.total);
  const expTotal = catTotals.reduce((a, c) => a + c.total, 0) || 1;
  const sayrafa = (catTotals.find(c => c.key === 'sayrafa') || { total: 0 }).total;
  const opExp = (expTotal - sayrafa) || 1;
  const partnersTotal = (catTotals.find(c => c.key === 'partners') || { total: 0 }).total;

  // receipts last 12
  const recv = last12.map(m => ({ label: m.short, value: m.in }));
  const recvTotal = last12.reduce((a, m) => a + m.in, 0);

  const partners = bd.data.partners || [];
  const funds = bd.data.funds || [];
  // share لكل صندوق: نسبة من إجمالي الأرصدة (API لا يُرجِع share مباشرةً).
  const fundsTotal = funds.reduce((a, f) => a + (f.balance || 0), 0) || 1;
  const partnersMax = (partners[0] && partners[0].total12) || 1;

  const money = (m) => `${F.fmtM(m)}`;

  return (
    <div style={{ padding: '24px 28px 48px' }}>
      <PageHeader title="المقبوضات والمصروفات" subtitle="تفصيل التدفقات حسب الفئة على مدى آخر 12 شهراً. تصنيف الحركات وفق نوع الحساب المقابل (counterparty)."
        actions={<SegmentedTabs items={[{ id: 'expenses', label: 'المصروفات', icon: 'arrowup' }, { id: 'receipts', label: 'المقبوضات', icon: 'arrowdown' }]} value={view} onChange={setView} size="sm" />} />

      {view === 'expenses' ? (
        <React.Fragment>
          {/* summary strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 16, marginBottom: 22 }}>
            <MiniStat label="إجمالي المصروفات · 12 شهر" value={money(expTotal)} unit={F.unitM(expTotal)} tone="danger" icon="arrowup" />
            <MiniStat label="مصروفات تشغيلية (بعد استبعاد الصيرفة)" value={money(opExp)} unit={F.unitM(opExp)} tone="warning" icon="cash" />
            <MiniStat label="سحوبات شركاء" value={money(partnersTotal)} unit={F.unitM(partnersTotal)} tone="danger" icon="users"
              note={`${(partnersTotal / opExp * 100).toFixed(0)}% من المصروفات التشغيلية`} />
            <MiniStat label="صيرفة (دينار→دولار)" value={money(sayrafa)} unit={F.unitM(sayrafa)} tone="warning" icon="dollar"
              note="تصفيات دورية" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 22, marginBottom: 22 }}>
            <Card>
              <SectionHeader title="المصروفات حسب الفئة" subtitle="آخر 12 شهراً — تكدّس الصيرفة ربعي" icon="cash" />
              <StackedBarChart height={300} data={stacked} formatY={F.fmtM} tickEvery={1} unit="مليون د.ع" />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 14 }}>
                {expCats.map(c => (
                  <span key={c.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--slate-600)' }}>
                    <span style={{ width: 11, height: 11, borderRadius: 3, background: cssVar(c.chart) }} />{c.name}
                  </span>
                ))}
              </div>
            </Card>

            <Card padding={0}>
              <div style={{ padding: '18px 20px 8px' }}><SectionHeader title="الفئات بالتفصيل" subtitle="مع رمز نوع الحساب" icon="filter" /></div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ color: 'var(--slate-500)', fontSize: 11.5 }}>
                  <th style={{ textAlign: 'right', padding: '8px 20px', fontWeight: 600 }}>الفئة</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>12 شهر</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>الحصة</th>
                  <th style={{ textAlign: 'left', padding: '8px 20px', fontWeight: 600 }}>متوسط/شهر</th>
                </tr></thead>
                <tbody>
                  {catTotals.map(c => (
                    <tr key={c.key} style={{ borderTop: '1px solid var(--slate-100)' }}>
                      <td style={{ padding: '11px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: cssVar(c.chart), flex: 'none' }} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: 'var(--slate-800)', fontWeight: 600 }}>{c.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--slate-400)' }}>نوع {c.type}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num" style={{ padding: '11px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--slate-900)' }}>{money(c.total)}</td>
                      <td className="num" style={{ padding: '11px 10px', textAlign: 'left', color: 'var(--slate-500)' }}>{(c.total / expTotal * 100).toFixed(0)}%</td>
                      <td className="num" style={{ padding: '11px 20px', textAlign: 'left', color: 'var(--slate-500)' }}>{money(c.total / 12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          {/* partners + funds */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
            <Card>
              <SectionHeader title="سحوبات الشركاء" subtitle="آخر 12 شهراً — ليست مصاريف تشغيلية" icon="users" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {partners.map((p, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontSize: 13.5, color: 'var(--slate-700)', fontWeight: 600 }}>{p.name}</span>
                      <span className="num" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--slate-900)' }}>{money(p.total12)} <span style={{ fontSize: 11, color: 'var(--slate-400)', fontWeight: 500 }}>مليون</span></span>
                    </div>
                    <div style={{ height: 8, background: 'var(--slate-100)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${p.total12 / partnersMax * 100}%`, height: '100%', background: 'var(--chart-5)', borderRadius: 999 }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--warning-50)', border: '1px solid var(--warning-200)', borderRadius: 12, fontSize: 12.5, color: 'var(--warning-800)', lineHeight: 1.6 }}>
                تمثّل سحوبات الشركاء <b className="num">{(partnersTotal / opExp * 100).toFixed(0)}%</b> من المصروفات التشغيلية — أكبر بند خروج نقدي وأهم رافعة لتحسين السيولة.
              </div>
            </Card>

            <Card>
              <SectionHeader title="أرصدة الصناديق" subtitle={`الرصيد الحالي ${money(CURRENT_CASH)} مليون · 7 صناديق`} icon="wallet" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {funds.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: i ? '1px solid var(--slate-100)' : 'none' }}>
                    <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--primary-50)', color: 'var(--primary-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                      <Icon name="wallet" className="w-4 h-4" />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--slate-700)' }}>{f.name}</span>
                    <span className="num" style={{ fontWeight: 700, color: 'var(--slate-900)', fontSize: 13.5 }}>{money(f.balance)}</span>
                    <span className="num" style={{ fontSize: 11.5, color: 'var(--slate-400)', width: 38, textAlign: 'left' }}>{(f.balance / fundsTotal * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </React.Fragment>
      ) : (
        <React.Fragment>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 16, marginBottom: 22 }}>
            <MiniStat label="إجمالي المقبوضات · 12 شهر" value={money(recvTotal)} unit={F.unitM(recvTotal)} tone="success" icon="arrowdown" />
            <MiniStat label="متوسط شهري" value={money(recvTotal / 12)} unit="مليون د.ع" tone="primary" icon="chart" />
            <MiniStat label="من الزبائن (أقساط وقطاع خاص)" value="98%" unit="من المقبوضات" tone="success" icon="users" note="فئات 1611 · 1631" />
          </div>
          <Card>
            <SectionHeader title="المقبوضات الشهرية" subtitle="آخر 12 شهراً — معظمها تسديد أقساط الزبائن" icon="arrowdown" />
            <BarChart height={320} data={recv} formatY={F.fmtM} unit="مليون د.ع" colorFor={() => '--chart-2'} />
            <div style={{ fontSize: 11.5, color: 'var(--slate-400)', marginTop: 6, textAlign: 'center' }}>القيم بالمليون دينار</div>
          </Card>
        </React.Fragment>
      )}
    </div>
  );
}

export default Breakdown;
