// البيت السعيد — الموردون الـ14
/* global React, Icon, Card, SectionHeader, Badge, Button, PageHeader, cssVar */
const { useState: useStateSup } = React;

function Suppliers({ caps = null, overCapWarn = true, exchangeRate }) {
  const D = window.DATA, F = D.fmt;
  const rate = exchangeRate || D.USD_RATE;
  const capOf = (s) => caps && caps[s.id] != null ? caps[s.id] : s.cap;
  const sups = D.SUPPLIERS;
  const monthsLbl = D.last12.map(m => String(m.greg).padStart(2, '0'));
  const maxCell = Math.max(...sups.flatMap(s => s.monthly));
  const totalAll = sups.reduce((a, s) => a + s.total12, 0);
  const totalOver = overCapWarn ? sups.reduce((a, s) => a + s.monthly.filter(v => capOf(s) > 0 && v > capOf(s)).length, 0) : 0;
  const usdSups = sups.filter(s => s.cur === 'USD');
  const usdBalance = usdSups.reduce((a, s) => a + s.balance, 0);

  const money = (m) => F.fmtM(m);
  const [hover, setHover] = useStateSup(null); // {si, mi, val, cap, name, month}

  return (
    <div style={{ padding: '24px 28px 48px' }}>
      <PageHeader title="الموردون الـ14" subtitle="مدفوعات آخر 12 شهراً لكل موزّع رئيسي، مع تظليل الأشهر التي تجاوزت السقف المرجعي. الموردون الدولاريون تُموَّل أرصدتهم عبر الصيرفة."
        actions={<Button variant="secondary" size="sm" icon="download" onClick={() => window.showToast('تم تجهيز ملف الموردين')}>تصدير</Button>} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 16, marginBottom: 22 }}>
        <MiniStat label="إجمالي مدفوعات الـ14 · 12 شهر" value={money(totalAll)} unit={F.unitM(totalAll)} tone="primary" icon="truck" note="الموزّعون الرئيسيون" />
        <MiniStat label="حالات تجاوز السقف" value={String(totalOver)} unit="حالة شهرية" tone="warning" icon="warn" note="عبر كل الموردين" />
        <MiniStat label="موردون بالدولار" value="4" unit="موردين" tone="slate" icon="dollar" note="الحافظ · المهندس · ميديا فوكس · الريان" />
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
              {sups.map((s, si) => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--slate-100)' }}>
                  <td style={{ padding: '8px 20px', position: 'sticky', insetInlineStart: 0, background: '#fff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 600, color: 'var(--slate-800)' }}>{s.name}</span>
                      <CurBadge cur={s.cur} />
                    </div>
                  </td>
                  <td className="num" style={{ textAlign: 'center', padding: '8px 6px', color: capOf(s) ? 'var(--slate-600)' : 'var(--slate-300)' }}>{capOf(s) || '—'}</td>
                  {s.monthly.map((v, mi) => {
                    const cap = capOf(s);
                    const over = overCapWarn && cap > 0 && v > cap;
                    const intensity = Math.min(1, v / maxCell);
                    return (
                      <td key={mi} style={{ padding: '3px 2px', textAlign: 'center' }}
                        onMouseEnter={() => setHover({ si, mi, val: v, cap: capOf(s), name: s.name, month: D.last12[mi].label, over, cur: s.cur })}
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
              ))}
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

function CurBadge({ cur }) {
  if (cur === 'USD') return <Badge tone="amber">دولار</Badge>;
  if (cur === 'MIX') return <Badge tone="purple">مختلط</Badge>;
  return <Badge tone="gray">دينار</Badge>;
}

Object.assign(window, { Suppliers });
