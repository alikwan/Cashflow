// البيت السعيد — توزيع موردين تنبؤي
/* global React, Icon, Card, SectionHeader, Badge, Button, PageHeader, MiniStat, SegmentedTabs, StackedBarChart, cssVar */
const { useState: useStateSp, useMemo: useMemoSp } = React;

function SupplierPlan({ reserve = window.DATA.RESERVE_M, incomeGrowth = 0, caps = null }) {
  const D = window.DATA, F = D.fmt;
  const g = 1 + incomeGrowth / 100;
  const [mi, setMi] = useStateSp(0);

  const plan = useMemoSp(() => D.forecast.map(m => ({ month: m, ...D.allocate(m, reserve, g, caps) })), [reserve, g, caps]);
  const cur = plan[mi];
  const m = cur.month;
  const money = (x) => F.fmtM(x);

  // مكوّنات حساب المجمّع للشهر المختار
  const inV = m.base.in * g;
  const deductions = [
    { label: 'مقبوضات متوقعة', value: inV, add: true },
    { label: 'سحوبات شركاء', value: -m.cats.partners },
    { label: 'صيرفة', value: -m.cats.sayrafa },
    { label: 'أجور', value: -m.cats.salaries },
    { label: 'مشتريات مباشرة', value: -m.cats.purchases },
    { label: 'مرتجعات وأخرى', value: -m.cats.refunds },
    { label: 'احتياطي مفاجآت', value: -reserve },
  ];

  // مكدّس عبر 12 شهر: إعطاء كل مورد
  const stacked = plan.map(p => ({
    label: p.month.short,
    segments: p.alloc.map((a, i) => ({ key: a.id, label: a.name, value: a.give, color: `--chart-${(i % 8) + 1}` })),
  }));

  return (
    <div style={{ padding: '24px 28px 48px' }}>
      <PageHeader title="توزيع موردين تنبؤي" subtitle="كيف يُوزَّع المتاح من السيولة على الموزّعين الـ14 شهرياً — وفق الحصة التاريخية مع احترام السقوف وإعادة توزيع الفائض."
        actions={<Button variant="secondary" size="sm" icon="download" onClick={() => window.showToast('تم تجهيز خطة التوزيع')}>تصدير</Button>} />

      {/* صيغة المجمّع */}
      <Card style={{ marginBottom: 22, background: 'var(--slate-50)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--slate-600)' }}>
          <span style={{ fontWeight: 700, color: 'var(--slate-800)', fontFamily: 'Tajawal' }}>المجمّع المتاح للموردين</span>
          <span style={{ color: 'var(--slate-400)' }}>=</span>
          <Token>المقبوضات المتوقعة</Token><Op>−</Op>
          <Token>سحوبات الشركاء</Token><Op>−</Op>
          <Token>الصيرفة</Token><Op>−</Op>
          <Token>الأجور</Token><Op>−</Op>
          <Token>المشتريات</Token><Op>−</Op>
          <Token>المرتجعات</Token><Op>−</Op>
          <Token tone="warning">احتياطي {reserve}م</Token>
        </div>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--slate-500)' }}>الشهر:</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {plan.map((p, i) => (
              <button key={i} onClick={() => setMi(i)} style={{
                padding: '5px 10px', borderRadius: 8, border: '1px solid ' + (i === mi ? 'var(--primary-600)' : 'var(--slate-200)'),
                background: i === mi ? 'var(--primary-600)' : '#fff', color: i === mi ? '#fff' : 'var(--slate-600)',
                fontSize: 12, fontFamily: 'inherit', fontWeight: i === mi ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap',
              }} className="num">{p.month.short}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 22, marginBottom: 22 }}>
        {/* حساب المجمّع */}
        <Card>
          <SectionHeader title="حساب المجمّع" subtitle={m.label} icon="cash" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {deductions.map((d, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: i ? '1px solid var(--slate-100)' : 'none', fontSize: 13 }}>
                <span style={{ color: 'var(--slate-600)' }}>{d.label}</span>
                <span className="num" style={{ fontWeight: 600, color: d.add ? 'var(--success-700)' : 'var(--slate-700)' }}>{d.add ? '+' : ''}{money(d.value)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0 4px', borderTop: '2px solid var(--slate-200)', marginTop: 4 }}>
              <span style={{ fontWeight: 700, color: 'var(--slate-800)', fontFamily: 'Tajawal', fontSize: 14 }}>المجمّع المتاح</span>
              <span className="num" style={{ fontWeight: 700, color: 'var(--primary-700)', fontSize: 18 }}>{money(cur.pool)}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--slate-400)', textAlign: 'left' }}>يُوزَّع بالكامل على الموزّعين الـ14 وفق حصصهم التاريخية</div>
          </div>
        </Card>

        {/* جدول التوزيع */}
        <Card padding={0}>
          <div style={{ padding: '18px 20px 8px' }}>
            <SectionHeader title="توزيع المجمّع على الموردين" subtitle={`${m.label} · المبالغ بالمليون دينار`} icon="truck"
              action={<Badge tone={cur.leftover > 0.5 ? 'green' : 'gray'}>فائض سيولة {money(cur.leftover)} م</Badge>} />
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--slate-50)', zIndex: 1 }}>
                <tr style={{ color: 'var(--slate-500)', fontSize: 11.5 }}>
                  <th style={{ textAlign: 'right', padding: '8px 20px', fontWeight: 600 }}>المورد</th>
                  <th style={{ textAlign: 'left', padding: '8px 8px', fontWeight: 600 }}>السقف</th>
                  <th style={{ textAlign: 'left', padding: '8px 8px', fontWeight: 600 }}>المطلوب</th>
                  <th style={{ textAlign: 'left', padding: '8px 20px', fontWeight: 600 }}>المخصَّص</th>
                </tr>
              </thead>
              <tbody>
                {cur.alloc.map((a, i) => (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--slate-100)' }}>
                    <td style={{ padding: '9px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, color: 'var(--slate-800)' }}>{a.name}</span>
                        {a.cur === 'USD' && <Badge tone="amber">دولار</Badge>}
                      </div>
                    </td>
                    <td className="num" style={{ padding: '9px 8px', textAlign: 'left', color: a.cap ? 'var(--slate-500)' : 'var(--slate-300)' }}>{a.cap || '—'}</td>
                    <td className="num" style={{ padding: '9px 8px', textAlign: 'left', color: 'var(--slate-500)' }}>{money(a.want)}</td>
                    <td style={{ padding: '9px 20px', textAlign: 'left' }}>
                      <span className="num" style={{ fontWeight: 700, color: a.capped ? 'var(--warning-700)' : 'var(--slate-900)' }}>{money(a.give)}</span>
                      {a.capped && <span style={{ fontSize: 10, color: 'var(--warning-600)', marginInlineStart: 6 }}>عند السقف</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card>
        <SectionHeader title="التوزيع عبر 12 شهراً" subtitle="إجمالي المخصَّص لكل مورد شهرياً" icon="scenarios" />
        <StackedBarChart height={280} data={stacked} formatY={F.fmtM} tickEvery={1} unit="مليون د.ع" />
        <div style={{ fontSize: 11.5, color: 'var(--slate-400)', marginTop: 8, textAlign: 'center' }}>كل لون = مورد · ارتفاع العمود = إجمالي المخصَّص للموردين الـ14 ذلك الشهر</div>
      </Card>
    </div>
  );
}

function Token({ children, tone }) {
  const c = tone === 'warning' ? ['var(--warning-50)', 'var(--warning-200)', 'var(--warning-800)'] : ['#fff', 'var(--slate-200)', 'var(--slate-700)'];
  return <span style={{ background: c[0], border: `1px solid ${c[1]}`, color: c[2], borderRadius: 8, padding: '4px 10px', fontSize: 12.5, fontWeight: 600 }}>{children}</span>;
}
function Op({ children }) { return <span style={{ color: 'var(--slate-400)', fontWeight: 700 }}>{children}</span>; }

Object.assign(window, { SupplierPlan });
