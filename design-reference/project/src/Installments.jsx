// البيت السعيد — الأقساط المفتوحة
/* global React, Icon, Card, SectionHeader, Badge, Button, PageHeader, MiniStat, Donut, cssVar */

function Installments() {
  const D = window.DATA, F = D.fmt;
  const total = D.INSTALLMENTS_TOTAL;
  const aging = D.AGING;
  const totalCount = aging.reduce((a, b) => a + b.count, 0);
  const notDue = aging.find(a => a.key === 'current').amount;
  const overdue = total - notDue;
  const seg = aging.map(a => ({ label: a.label, value: a.amount, color: a.color }));
  const maxAging = Math.max(...aging.map(a => a.amount));

  const money = (m) => F.fmtM(m);

  return (
    <div style={{ padding: '24px 28px 48px' }}>
      <PageHeader title="الأقساط المفتوحة" subtitle="الرصيد المتبقي على الزبائن — مصدر سيولة مستقبلي مهم. التوزيع حسب أعمار الديون (aging)."
        actions={<Button variant="secondary" size="sm" icon="download" onClick={() => window.showToast('تم تجهيز كشف الأقساط')}>تصدير</Button>} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px,1fr))', gap: 16, marginBottom: 22 }}>
        <MiniStat label="إجمالي الأقساط المستحقة" value={money(total)} unit={F.unitM(total)} tone="primary" icon="doc" note={`${F.fmtInt(totalCount)} قسط مفتوح`} />
        <MiniStat label="لم يستحق بعد (جاري)" value={money(notDue)} unit={F.unitM(notDue)} tone="success" icon="check" note={`${(notDue / total * 100).toFixed(0)}% من الإجمالي`} />
        <MiniStat label="مستحق ومتأخر" value={money(overdue)} unit={F.unitM(overdue)} tone="warning" icon="clock" note={`${(overdue / total * 100).toFixed(0)}% بحاجة متابعة`} />
        <MiniStat label="متعثّر (+120 يوم)" value={money(aging.find(a => a.key === 'b120').amount)} unit={F.unitM(total)} tone="danger" icon="warn" note="أعلى مخاطر تحصيل" />
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
            {aging.map((a, i) => (
              <div key={i}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--slate-700)', fontWeight: 600 }}>
                    <span style={{ width: 11, height: 11, borderRadius: 3, background: cssVar(a.color) }} />{a.label}
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--slate-400)' }}>
                    <span className="num" style={{ fontWeight: 700, color: 'var(--slate-900)', fontSize: 14 }}>{money(a.amount)}</span> مليون · <span className="num">{F.fmtInt(a.count)}</span> قسط
                  </span>
                </div>
                <div style={{ height: 9, background: 'var(--slate-100)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${a.amount / maxAging * 100}%`, height: '100%', background: cssVar(a.color), borderRadius: 999, transition: 'width 300ms' }} />
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
            <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 600 }}>رقم العقد</th>
            <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 600 }}>الشريحة</th>
            <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 600 }}>الحالة</th>
            <th style={{ textAlign: 'left', padding: '9px 20px', fontWeight: 600 }}>الرصيد المتبقي</th>
          </tr></thead>
          <tbody>
            {D.TOP_DEBTORS.map((d, i) => {
              const tone = d.due === 'متعثّر' ? 'red' : d.due === 'متأخر' ? 'amber' : d.due === 'متابعة' ? 'blue' : 'gray';
              return (
                <tr key={i} style={{ borderTop: '1px solid var(--slate-100)' }}>
                  <td style={{ padding: '11px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 32, height: 32, borderRadius: 10, background: '#0891B2', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Tajawal', fontWeight: 700, fontSize: 12, flex: 'none' }}>{d.name.split(' ').slice(0, 2).map(w => w[0]).join('')}</span>
                      <span style={{ fontWeight: 600, color: 'var(--slate-800)' }}>{d.name}</span>
                    </div>
                  </td>
                  <td className="num" style={{ padding: '11px 10px', color: 'var(--slate-500)' }}>{d.contract}</td>
                  <td style={{ padding: '11px 10px', color: 'var(--slate-600)' }}>{d.bucket}</td>
                  <td style={{ padding: '11px 10px' }}><Badge tone={tone}>{d.due}</Badge></td>
                  <td className="num" style={{ padding: '11px 20px', textAlign: 'left', fontWeight: 700, color: 'var(--slate-900)' }}>{d.balance.toFixed(1)} <span style={{ fontSize: 11, color: 'var(--slate-400)', fontWeight: 500 }}>مليون</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div style={{ marginTop: 16, padding: '14px 18px', background: 'var(--primary-50)', border: '1px solid var(--primary-200)', borderRadius: 14, fontSize: 13, color: 'var(--primary-700)', lineHeight: 1.6, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Icon name="info" className="w-5 h-5" style={{ flex: 'none', marginTop: 1 }} />
        <span>تمثّل الأقساط المفتوحة احتياطي سيولة مستقبلياً بقيمة <b className="num">4.67 مليار د.ع</b>. تسريع تحصيل الشرائح المتأخرة (61 يوماً فأكثر) قد يضخّ نحو <b className="num">{money(aging.filter(a => ['b61_90', 'b91_120', 'b120'].includes(a.key)).reduce((s, a) => s + a.amount, 0))}</b> مليون د.ع في الصناديق.</span>
      </div>
    </div>
  );
}

Object.assign(window, { Installments });
