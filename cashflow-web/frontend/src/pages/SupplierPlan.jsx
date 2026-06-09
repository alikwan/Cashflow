// البيت السعيد — توزيع موردين تنبؤي
//
// Port of design-reference/project/src/SupplierPlan.jsx, ADAPTED for the new
// SERVER-SIDE per-month allocation (06 §8 — the big semantic change). The layout
// (formula card, month selector, pool-breakdown panel, distribution table,
// 12-month stacked chart) is kept on-brand, but the data model changed:
//
//   • Allocation is now computed on the SERVER, per month. The page fetches all
//     12 forecast months in parallel via the NEW useSupplierPlanSeries hook
//     (one /api/supplier-plan call per month), instead of data.js's synchronous
//     allocate(). data.js's allocate()/SUP_SHARE are NOT ported — `give` comes
//     from the server's allocated_m verbatim.
//   • Dollar suppliers (الحافظ/المهندس/ميديا فوكس/الريان) have give === 0 and are
//     labelled "مموَّل عبر الصيرفة" (Option-1: funded via the siyrafa line, which
//     is already deducted from the pool). They are NOT given a pool share.
//   • `cap` is joined from useSuppliers() by supplier id (account_id); `capped`
//     is derived (cap>0 && give >= cap-ε). The "المطلوب" (want) column is DROPPED
//     (no API source — do not fabricate).
//   • The "حساب المجمّع" panel shows an HONEST reduced waterfall using only real
//     / derived numbers: المقبوضات المتوقعة (forecast base.in) → − الخصومات
//     التشغيلية والصيرفة (محسوبة على الخادم) (derived = in − reserve − pool) →
//     − احتياطي مفاجآت (reserve) → = المجمّع المتاح (pool). The detailed
//     per-category cats (partners/sayrafa/salaries/…) have NO API source and are
//     NOT fabricated.
//
// Other Task D3 transforms: React UMD → ES imports; window.showToast →
// useToast(); Object.assign(window,…) → export function; NEW loading/error.
import React, { useState, useMemo } from "react";
import { Card, SectionHeader, Badge, Button, useToast } from "../components/Primitives";
import { StackedBarChart } from "../components/Charts";
import { PageHeader } from "../components/Shell";
import { useForecast, useSupplierPlanSeries, useSuppliers, useMeta } from "../api/hooks";
import * as fmt from "../lib/format";
import { PageState } from "./PageState";

function Token({ children, tone }) {
  const c = tone === 'warning' ? ['var(--warning-50)', 'var(--warning-200)', 'var(--warning-800)'] : ['#fff', 'var(--slate-200)', 'var(--slate-700)'];
  return <span style={{ background: c[0], border: `1px solid ${c[1]}`, color: c[2], borderRadius: 8, padding: '4px 10px', fontSize: 12.5, fontWeight: 600 }}>{children}</span>;
}
function Op({ children }) { return <span style={{ color: 'var(--slate-400)', fontWeight: 700 }}>{children}</span>; }

const CAP_EPS = 0.001;

export function SupplierPlan({ reserve: reserveProp, scenarioId, caps = null }) {
  const { showToast } = useToast();
  const F = fmt;
  const [mi, setMi] = useState(0);

  // The forecast supplies the 12 month KEYS (yearMonth) + per-month base.in for
  // the pool-breakdown waterfall. The series hook fans those months out to the
  // per-month supplier-plan endpoint in parallel. Suppliers supplies the cap
  // join. Meta supplies the default reserve.
  const fcHook = useForecast(scenarioId);
  const months = useMemo(
    () => (fcHook.data?.forecast || []).map(m => m.yearMonth).filter(Boolean),
    [fcHook.data]
  );
  const series = useSupplierPlanSeries(months, scenarioId);
  const sup = useSuppliers();
  const meta = useMeta();

  // The series fan-out is driven by a useEffect, so there is one render after
  // the forecast resolves where months exist but the series effect hasn't yet
  // flipped its own `loading` to true (data still []). Treat that pending window
  // as loading too — but ONLY when there ARE months to fetch. When the forecast
  // is empty (months === []) the series is legitimately idle-empty (NOT loading),
  // so the page falls through to its graceful empty state instead of spinning.
  const seriesPending =
    months.length > 0 && !series.error && !series.loading && series.data.length === 0;
  const loading =
    fcHook.loading || series.loading || sup.loading || meta.loading || seriesPending;
  const error = fcHook.error || series.error || sup.error || meta.error;

  const RESERVE_M = meta.data?.RESERVE_M ?? 0;
  const reserve = reserveProp != null ? reserveProp : RESERVE_M;

  // Cap lookup by account_id (join from useSuppliers; caps prop overrides).
  const capById = useMemo(() => {
    const map = {};
    for (const s of (sup.data?.suppliers || [])) {
      map[s.id] = caps && caps[s.id] != null ? caps[s.id] : s.cap;
    }
    return map;
  }, [sup.data, caps]);

  // Loading / error are computed from the ACTUAL hook states only — never folded
  // with `!series.data.length`. An empty forecast (forecast: []) is a real,
  // fully-loaded early/empty-DB state: months becomes [], the series hook stays
  // idle (loading:false, data:[]), and the page must degrade gracefully (mirror
  // Forecast.jsx) instead of spinning forever.
  if (loading || error || !fcHook.data || !sup.data || !meta.data) {
    return (
      <div style={{ padding: '24px 28px 48px' }}>
        <PageState
          loading={loading}
          error={error}
          onRetry={() => { fcHook.refetch(); series.refetch(); sup.refetch(); meta.refetch(); }}
        />
      </div>
    );
  }

  // ---- Loaded view ----
  const fcRows = fcHook.data.forecast || [];
  // Per-month plan objects (mapped): {month, pool, leftover, alloc[]}.
  const plan = series.data;
  const hasData = plan.length > 0;
  // Clamp the selected-month index into range; guard the current-month access so
  // an empty plan yields a null `cur` (no out-of-range / crash).
  const safeMi = hasData ? Math.min(Math.max(mi, 0), plan.length - 1) : 0;
  const cur = plan[safeMi] || null;
  const fcRow = fcRows[safeMi] || {};
  const monthLabel = fcRow.label || cur?.month || '';
  const money = (x) => F.fmtM(x);

  // Decorate each alloc row with the joined cap + derived `capped` flag.
  const allocRows = (cur?.alloc || []).map(a => {
    const cap = capById[a.id] ?? 0;
    const capped = cap > 0 && a.give >= cap - CAP_EPS;
    return { ...a, cap, capped };
  });

  // HONEST reduced pool waterfall (only real / derived numbers — 06 §8).
  // المقبوضات المتوقعة (forecast base.in) − الخصومات التشغيلية والصيرفة (server,
  // derived = in − reserve − pool) − احتياطي مفاجآت (reserve) = المجمّع (pool).
  const inV = (fcRow.base?.in) || 0;
  const poolV = cur?.pool || 0;
  const serverDeductions = inV - reserve - poolV; // operating costs + siyrafa, computed server-side
  const waterfall = [
    { label: 'المقبوضات المتوقعة', value: inV, add: true },
    { label: 'الخصومات التشغيلية والصيرفة (محسوبة على الخادم)', value: -serverDeductions },
    { label: 'احتياطي مفاجآت', value: -reserve },
  ];

  // 12-month stacked chart: each supplier's `give` per month (server values).
  const stacked = plan.map((p, idx) => ({
    label: (fcRows[idx]?.short) || p.month,
    segments: (p.alloc || []).map((a, i) => ({ key: a.id, label: a.name, value: a.give, color: `--chart-${(i % 8) + 1}` })),
  }));

  // Empty forecast (forecast: [] → no months → no plan): degrade gracefully like
  // Forecast.jsx — keep the PageHeader, show an on-brand muted empty-state card
  // instead of the month selector + pool/table/chart panels (which need a `cur`).
  if (!hasData) {
    return (
      <div style={{ padding: '24px 28px 48px' }}>
        <PageHeader title="توزيع موردين تنبؤي" subtitle="كيف يُوزَّع المتاح من السيولة على موردي الدينار شهرياً — مع احترام السقوف. الموردون الدولاريون تُموَّل أرصدتهم بالصيرفة (لا يأخذون حصة من المجمّع)."
          actions={<Button variant="secondary" size="sm" icon="download" onClick={() => showToast('تم تجهيز خطة التوزيع')}>تصدير</Button>} />
        <Card style={{ marginTop: 22, textAlign: 'center', padding: '40px 24px' }}>
          <div style={{ fontSize: 13.5, color: 'var(--slate-500)', lineHeight: 1.7 }}>
            لا توجد بيانات تنبؤ متاحة بعد لعرض خطة التوزيع.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px 48px' }}>
      <PageHeader title="توزيع موردين تنبؤي" subtitle="كيف يُوزَّع المتاح من السيولة على موردي الدينار شهرياً — مع احترام السقوف. الموردون الدولاريون تُموَّل أرصدتهم بالصيرفة (لا يأخذون حصة من المجمّع)."
        actions={<Button variant="secondary" size="sm" icon="download" onClick={() => showToast('تم تجهيز خطة التوزيع')}>تصدير</Button>} />

      {/* صيغة المجمّع (تسميات فقط، بلا قيم) */}
      <Card style={{ marginBottom: 22, background: 'var(--slate-50)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--slate-600)' }}>
          <span style={{ fontWeight: 700, color: 'var(--slate-800)', fontFamily: 'Tajawal' }}>المجمّع المتاح للموردين</span>
          <span style={{ color: 'var(--slate-400)' }}>=</span>
          <Token>المقبوضات المتوقعة</Token><Op>−</Op>
          <Token>الخصومات التشغيلية والصيرفة</Token><Op>−</Op>
          <Token tone="warning">احتياطي {reserve}م</Token>
        </div>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--slate-500)' }}>الشهر:</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {plan.map((p, i) => (
              <button key={i} onClick={() => setMi(i)} style={{
                padding: '5px 10px', borderRadius: 8, border: '1px solid ' + (i === safeMi ? 'var(--primary-600)' : 'var(--slate-200)'),
                background: i === safeMi ? 'var(--primary-600)' : '#fff', color: i === safeMi ? '#fff' : 'var(--slate-600)',
                fontSize: 12, fontFamily: 'inherit', fontWeight: i === safeMi ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap',
              }} className="num">{(fcRows[i]?.short) || p.month}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 22, marginBottom: 22 }}>
        {/* حساب المجمّع — شلال مختصر صادق */}
        <Card>
          <SectionHeader title="حساب المجمّع" subtitle={monthLabel} icon="cash" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {waterfall.map((d, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: i ? '1px solid var(--slate-100)' : 'none', fontSize: 13 }}>
                <span style={{ color: 'var(--slate-600)', minWidth: 0 }}>{d.label}</span>
                <span className="num" style={{ fontWeight: 600, color: d.add ? 'var(--success-700)' : 'var(--slate-700)', flex: 'none' }}>{d.add ? '+' : ''}{money(d.value)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0 4px', borderTop: '2px solid var(--slate-200)', marginTop: 4 }}>
              <span style={{ fontWeight: 700, color: 'var(--slate-800)', fontFamily: 'Tajawal', fontSize: 14 }}>المجمّع المتاح</span>
              <span className="num" style={{ fontWeight: 700, color: 'var(--primary-700)', fontSize: 18 }}>{money(cur.pool)}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--slate-400)', textAlign: 'left', marginTop: 6, lineHeight: 1.5 }}>
              تُحسب الخصومات التفصيلية (سحوبات الشركاء · الصيرفة · الأجور · المشتريات · المرتجعات) على الخادم؛ يُعرض هنا أثرها المجمّع. يُوزَّع المجمّع على موردي الدينار وفق حصصهم التاريخية واحترام السقوف.
            </div>
          </div>
        </Card>

        {/* جدول التوزيع */}
        <Card padding={0}>
          <div style={{ padding: '18px 20px 8px' }}>
            <SectionHeader title="توزيع المجمّع على الموردين" subtitle={`${monthLabel} · المبالغ بالمليون دينار`} icon="truck"
              action={<Badge tone={cur.leftover > 0.5 ? 'green' : 'gray'}>فائض سيولة {money(cur.leftover)} م</Badge>} />
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--slate-50)', zIndex: 1 }}>
                <tr style={{ color: 'var(--slate-500)', fontSize: 11.5 }}>
                  <th style={{ textAlign: 'right', padding: '8px 20px', fontWeight: 600 }}>المورد</th>
                  <th style={{ textAlign: 'left', padding: '8px 8px', fontWeight: 600 }}>السقف</th>
                  <th style={{ textAlign: 'left', padding: '8px 20px', fontWeight: 600 }}>المخصَّص</th>
                </tr>
              </thead>
              <tbody>
                {allocRows.map((a, i) => {
                  const isUsd = a.cur === 'USD';
                  return (
                    <tr key={a.id} style={{ borderTop: '1px solid var(--slate-100)' }}>
                      <td style={{ padding: '9px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, color: 'var(--slate-800)' }}>{a.name}</span>
                          {isUsd && <Badge tone="amber">دولار</Badge>}
                        </div>
                      </td>
                      <td className="num" style={{ padding: '9px 8px', textAlign: 'left', color: a.cap ? 'var(--slate-500)' : 'var(--slate-300)' }}>{a.cap || '—'}</td>
                      <td style={{ padding: '9px 20px', textAlign: 'left' }}>
                        {isUsd ? (
                          <span style={{ fontSize: 12, color: 'var(--warning-700)', fontWeight: 600 }}>مموَّل عبر الصيرفة</span>
                        ) : (
                          <>
                            <span className="num" style={{ fontWeight: 700, color: a.capped ? 'var(--warning-700)' : 'var(--slate-900)' }}>{money(a.give)}</span>
                            {a.capped && <span style={{ fontSize: 10, color: 'var(--warning-600)', marginInlineStart: 6 }}>عند السقف</span>}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card>
        <SectionHeader title="التوزيع عبر 12 شهراً" subtitle="إجمالي المخصَّص لكل مورد شهرياً (موردو الدينار)" icon="scenarios" />
        <StackedBarChart height={280} data={stacked} formatY={F.fmtM} tickEvery={1} unit="مليون د.ع" />
        <div style={{ fontSize: 11.5, color: 'var(--slate-400)', marginTop: 8, textAlign: 'center' }}>كل لون = مورد · ارتفاع العمود = إجمالي المخصَّص لموردي الدينار ذلك الشهر · الموردون الدولاريون تُموَّل أرصدتهم بالصيرفة</div>
      </Card>
    </div>
  );
}

export default SupplierPlan;
