// البيت السعيد — المقبوضات والمصروفات
/* global React, Icon, Card, SectionHeader, Badge, Button, PageHeader, SegmentedTabs, StackedBarChart, BarChart, Donut, cssVar */
const { useState: useStateBd } = React;

function Breakdown() {
  const D = window.DATA, F = D.fmt;
  const [view, setView] = useStateBd('expenses');

  const last12 = D.months.slice(-12);
  // stacked data
  const stacked = last12.map(m => ({
    label: m.short,
    segments: D.EXP_CATS.map(c => ({ key: c.key, label: c.name, value: m.cats[c.key], color: c.chart })),
  }));
  // category totals
  const catTotals = D.EXP_CATS.map(c => ({
    ...c, total: last12.reduce((a, m) => a + m.cats[c.key], 0),
  })).sort((a, b) => b.total - a.total);
  const expTotal = catTotals.reduce((a, c) => a + c.total, 0);
  const sayrafa = catTotals.find(c => c.key === 'sayrafa').total;
  const opExp = expTotal - sayrafa;
  const partnersTotal = catTotals.find(c => c.key === 'partners').total;

  // receipts last 12
  const recv = last12.map(m => ({ label: m.short, value: m.in }));
  const recvTotal = last12.reduce((a, m) => a + m.in, 0);

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
                {D.EXP_CATS.map(c => (
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
                {D.PARTNERS.map((p, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontSize: 13.5, color: 'var(--slate-700)', fontWeight: 600 }}>{p.name}</span>
                      <span className="num" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--slate-900)' }}>{money(p.total12)} <span style={{ fontSize: 11, color: 'var(--slate-400)', fontWeight: 500 }}>مليون</span></span>
                    </div>
                    <div style={{ height: 8, background: 'var(--slate-100)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${p.total12 / D.PARTNERS[0].total12 * 100}%`, height: '100%', background: 'var(--chart-5)', borderRadius: 999 }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--warning-50)', border: '1px solid var(--warning-200)', borderRadius: 12, fontSize: 12.5, color: 'var(--warning-800)', lineHeight: 1.6 }}>
                تمثّل سحوبات الشركاء <b className="num">{(partnersTotal / opExp * 100).toFixed(0)}%</b> من المصروفات التشغيلية — أكبر بند خروج نقدي وأهم رافعة لتحسين السيولة.
              </div>
            </Card>

            <Card>
              <SectionHeader title="أرصدة الصناديق" subtitle={`الرصيد الحالي ${money(D.CURRENT_CASH)} مليون · 7 صناديق`} icon="wallet" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {D.FUNDS.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: i ? '1px solid var(--slate-100)' : 'none' }}>
                    <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--primary-50)', color: 'var(--primary-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                      <Icon name="wallet" className="w-4 h-4" />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--slate-700)' }}>{f.name}</span>
                    <span className="num" style={{ fontWeight: 700, color: 'var(--slate-900)', fontSize: 13.5 }}>{money(f.balance)}</span>
                    <span className="num" style={{ fontSize: 11.5, color: 'var(--slate-400)', width: 38, textAlign: 'left' }}>{(f.share * 100).toFixed(0)}%</span>
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

Object.assign(window, { Breakdown });
