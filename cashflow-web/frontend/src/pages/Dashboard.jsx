// البيت السعيد — اللوحة التنفيذية
//
// Pixel-parity port of design-reference/project/src/Dashboard.jsx. The visual
// layout (KPI grid, alert banner, 60-month chart, expense donut + legend, the
// "رؤى ومنبّهات" card) is preserved byte-for-byte. The ONLY changes are the
// mechanical data-source transforms (Task D2):
//   1. React UMD globals → ES imports.
//   2. window.DATA reads → composed D1 hooks (useDashboard + useCashflow +
//      useBreakdown + useMeta), per cashflow-web/docs/discovery/06-hook-output-contract.md.
//   3. window.showToast(...) → const { showToast } = useToast().
//   4. Object.assign(window, …) → a named `export function Dashboard`.
//   5. NEW loading + error states (the mock had none — data now arrives async).
//   6. The hard-coded danger banner is now driven by the live primary danger
//      alert (heading still starts with "تنبيه سيولة").
import React from "react";
import { Icon, Card, StatCard, SectionHeader, Button, useToast } from "../components/Primitives";
import { LineChart, Donut, cssVar } from "../components/Charts";
import { PageHeader } from "../components/Shell";
import {
  useDashboard,
  useCashflow,
  useBreakdown,
  useMeta,
} from "../api/hooks";
import * as fmt from "../lib/format";
import { PageState } from "./PageState";

const F = fmt;

function Legend({ items }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
      {items.map((it, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--slate-600)' }}>
          <span style={{ width: 14, height: it.line ? 3 : 11, borderRadius: it.line ? 2 : 3, background: cssVar(it.color),
            ...(it.dashed ? { backgroundImage: `repeating-linear-gradient(90deg, ${cssVar(it.color)} 0 5px, transparent 5px 9px)`, background: 'none' } : {}) }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function alertStyle(tone) {
  return ({
    danger:  { bg: 'var(--danger-50)',  bd: 'var(--danger-200)',  fg: 'var(--danger-600)',  tx: 'var(--danger-700)' },
    warning: { bg: 'var(--warning-50)', bd: 'var(--warning-200)', fg: 'var(--warning-700)', tx: 'var(--warning-800)' },
    info:    { bg: 'var(--primary-50)', bd: 'var(--primary-200)', fg: 'var(--primary-600)', tx: 'var(--primary-700)' },
  })[tone] || { bg: 'var(--slate-50)', bd: 'var(--slate-200)', fg: 'var(--slate-500)', tx: 'var(--slate-700)' };
}

export function Dashboard({ onNavigate, showAlert = true }) {
  const { showToast } = useToast();

  // Compose the hooks this page needs (per the 06 contract).
  const dash = useDashboard();          // agg, netDecline, alerts, installments
  const cf = useCashflow();             // months[] + forecast[] (60-month chart)
  const bd = useBreakdown();            // expCats[].monthly (FY25 expense donut)
  const meta = useMeta();               // CURRENT_CASH

  const loading = dash.loading || cf.loading || bd.loading || meta.loading;
  const error = dash.error || cf.error || bd.error || meta.error;

  // While data is missing or in an error/loading state, keep the page padding
  // wrapper so the layout doesn't jump.
  if (loading || error || !dash.data || !cf.data || !bd.data || !meta.data) {
    return (
      <div style={{ padding: '24px 28px 48px' }}>
        <PageState
          loading={loading}
          error={error}
          onRetry={() => { dash.refetch(); cf.refetch(); bd.refetch(); meta.refetch(); }}
        />
      </div>
    );
  }

  // ---- Loaded view (pixel-parity with the design reference) ----
  const D = dash.data;
  const agg = D.agg || {};
  const FY25 = agg.FY25 || { in: 0, out: 0, net: 0 };
  const FY24 = agg.FY24 || { in: 0, out: 0, net: 0 };
  const CURRENT_CASH = meta.data.CURRENT_CASH ?? 0;
  const INSTALLMENTS_TOTAL = D.installments ? D.installments.remainingM : 0;
  const ALERTS = D.alerts || [];

  // سلسلة 60 شهر: تاريخي + تنبؤ متحفّظ
  const hist = cf.data.months || [];
  const fc = cf.data.forecast || [];
  const labels = [...hist.map(m => m.short), ...fc.map(m => m.short)];
  const inS  = [...hist.map(m => m.in),  ...fc.map(m => m.base.in)];
  const outS = [...hist.map(m => m.out), ...fc.map(m => m.base.out)];
  const netS = [...hist.map(m => m.net), ...fc.map(m => m.base.net)];
  const forecastFrom = hist.length - 1;

  // تركيب المصروفات (آخر سنة مالية كاملة) — مجموع آخر 12 شهراً لكل فئة من useBreakdown.
  // DELIBERATE: the donut sums the last-12-months window (slice(-12)), NOT the
  // API's full-window `c.total`. Title is "آخر سنة مالية كاملة" so the two can
  // differ when the history window exceeds 12 months — do not "simplify" to c.total.
  const expSeg = (bd.data.expCats || []).map(c => {
    const last12 = (c.monthly || []).slice(-12);
    return {
      label: c.name,
      color: c.chart,
      value: last12.reduce((a, mm) => a + (mm.value || 0), 0),
    };
  }).sort((a, b) => b.value - a.value);
  const expTotal = expSeg.reduce((a, s) => a + s.value, 0) || 1;

  // التنبيه الأبرز: أول تنبيه خطير (danger) من القائمة الحيّة.
  const primaryDanger = ALERTS.find(a => a.tone === 'danger') || null;
  const bannerVisible = showAlert && Boolean(primaryDanger);

  return (
    <div style={{ padding: '24px 28px 48px' }}>
      <PageHeader
        title="اللوحة التنفيذية"
        subtitle="نظرة شاملة على سيولة المعرض — السنة المالية 2025/2026 (أيار→نيسان)، مع تنبؤ 12 شهراً قادماً. المبالغ بالدينار العراقي."
        actions={<Button variant="secondary" size="sm" icon="download" onClick={() => showToast('تم تجهيز التقرير التنفيذي')}>تصدير التقرير</Button>}
      />

      {/* شريط الإنذار الأبرز — مُساق من أول تنبيه خطير حيّ */}
      {bannerVisible && (
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', background: 'var(--danger-50)', border: '1px solid var(--danger-200)',
        borderRadius: 16, padding: '16px 20px', marginBottom: 22 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: '#fff', color: 'var(--danger-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', boxShadow: 'var(--shadow-sm)' }}>
          <Icon name="alert" className="w-6 h-6" strokeWidth={1.75} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Tajawal', fontWeight: 700, fontSize: 16, color: 'var(--danger-700)' }}>تنبيه سيولة — {primaryDanger.title}</div>
          {primaryDanger.body && (
            <div style={{ fontSize: 13, color: 'var(--danger-700)', marginTop: 3, opacity: 0.92 }}>
              {primaryDanger.body}
            </div>
          )}
        </div>
        <Button variant="danger" size="sm" onClick={() => onNavigate('forecast')} iconEnd="chevleft">عرض السيناريوهات</Button>
      </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16, marginBottom: 22 }}>
        <StatCard label="مقبوضات السنة" value={F.fmtM(FY25.in)} unit={F.unitM(FY25.in)} icon="arrowdown" tone="success"
          trend={FY24.in ? { dir: 'down', value: F.fmtPct(Math.abs((FY25.in - FY24.in) / FY24.in), 1), good: false } : undefined} sub="مقابل 2024/2025" />
        <StatCard label="مصروفات السنة" value={F.fmtM(FY25.out)} unit={F.unitM(FY25.out)} icon="arrowup" tone="danger"
          trend={FY24.out ? { dir: 'up', value: F.fmtPct((FY25.out - FY24.out) / FY24.out, 1), good: false } : undefined} sub="مقابل 2024/2025" />
        <StatCard label="صافي السيولة" value={`+${F.fmtM(FY25.net)}`} unit={F.unitM(FY25.net)} icon="scale" tone="warning"
          trend={D.netDecline != null ? { dir: 'down', value: F.fmtPct(D.netDecline, 0), good: false } : undefined} sub="تراجع حادّ عن 2024" />
        <StatCard label="رصيد الصناديق الحالي" value={F.fmtM(CURRENT_CASH)} unit={F.unitM(CURRENT_CASH)} icon="wallet" tone="primary"
          sub="7 صناديق نقدية" onClick={() => onNavigate('breakdown')} />
        <StatCard label="أقساط مستحقة" value={F.fmtM(INSTALLMENTS_TOTAL)} unit={F.unitM(INSTALLMENTS_TOTAL)} icon="doc" tone="slate"
          sub="مصدر سيولة مستقبلي" onClick={() => onNavigate('installments')} />
      </div>

      {/* Main chart */}
      <Card style={{ marginBottom: 22 }}>
        <SectionHeader title="التدفق النقدي الشهري" subtitle="48 شهراً فعلياً + 12 شهراً متوقعاً (متحفّظ)" icon="chart"
          action={<Legend items={[
            { label: 'المقبوضات', color: '--chart-2', area: true },
            { label: 'المصروفات', color: '--chart-3', line: true },
            { label: 'الصافي', color: '--chart-1', line: true },
            { label: 'تنبؤ', color: '--slate-400', dashed: true, line: true },
          ]} />} />
        <LineChart height={320} labels={labels} forecastFrom={forecastFrom}
          formatY={(v) => F.fmtM(v)} tickEvery={6}
          series={[
            { key: 'in',  label: 'المقبوضات', color: '--chart-2', values: inS,  area: true, width: 2.25 },
            { key: 'out', label: 'المصروفات', color: '--chart-3', values: outS, width: 2 },
            { key: 'net', label: 'الصافي',    color: '--chart-1', values: netS, width: 2.75 },
          ]} />
        <div style={{ fontSize: 11.5, color: 'var(--slate-400)', marginTop: 8, textAlign: 'center' }}>القيم بالمليون دينار · المنطقة المظللة = فترة التنبؤ</div>
      </Card>

      {/* Two columns: expense composition + insights */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
        <Card>
          <SectionHeader title="تركيب المصروفات" subtitle="آخر سنة مالية كاملة" icon="cash"
            action={<Button variant="ghost" size="sm" iconEnd="chevleft" onClick={() => onNavigate('breakdown')}>التفاصيل</Button>} />
          <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            <Donut segments={expSeg} size={172} thickness={28} centerLabel={F.fmtM(expTotal)} centerSub={F.unitM(expTotal)} />
            <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {expSeg.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: cssVar(s.color), flex: 'none' }} />
                  <span style={{ color: 'var(--slate-700)', flex: 1, minWidth: 0 }}>{s.label}</span>
                  <span className="num" style={{ fontWeight: 700, color: 'var(--slate-900)' }}>{F.fmtM(s.value)}</span>
                  <span className="num" style={{ fontSize: 11.5, color: 'var(--slate-400)', width: 38, textAlign: 'left' }}>{(s.value / expTotal * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <SectionHeader title="رؤى ومنبّهات" subtitle="أهم ما يستدعي الانتباه" icon="bell" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {ALERTS.map((a, i) => {
              const st = alertStyle(a.tone);
              return (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 14px', background: st.bg, border: `1px solid ${st.bd}`, borderRadius: 12 }}>
                  <span style={{ color: st.fg, flex: 'none', marginTop: 1 }}><Icon name={a.tone === 'info' ? 'info' : a.tone === 'danger' ? 'alert' : 'warn'} className="w-5 h-5" strokeWidth={1.75} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: st.tx }}>{a.title}</div>
                    <div style={{ fontSize: 12.5, color: st.tx, opacity: 0.9, marginTop: 2, lineHeight: 1.55 }}>{a.body}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default Dashboard;
