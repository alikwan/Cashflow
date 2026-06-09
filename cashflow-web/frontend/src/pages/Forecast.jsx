// البيت السعيد — التنبؤ والسيناريوهات
//
// Pixel-parity port of design-reference/project/src/Forecast.jsx. The layout
// (scenario tabs, KPI strip, 3-scenario cash-path line chart, monthly-net bars,
// scenario reading cards + runway note) is preserved. Changes (Task D3):
//   1. React UMD globals → ES imports.
//   2. window.DATA → useForecast() (forecast[]/scenarios/mape/confidence) +
//      useMeta() (CURRENT_CASH origin, RESERVE_M default), per the 06 §7.
//   3. window.showToast(...) → const { showToast } = useToast().
//   4. Object.assign(window, …) → a named `export function Forecast`.
//   5. NEW loading + error states.
//   6. NEW: a MAPE / confidence accuracy badge (06 §7.5) — rendered ONLY when
//      the hook returns non-null `mape`/`confidence`, toned by confidence
//      (عالية→success, متوسطة→warning, منخفضة→danger).
//
// The page keeps its interactive `reserve` + `incomeGrowth` sliders and
// RECOMPUTES net/cashPaths/totals LOCALLY in a useMemo from the per-month
// base/opt/pess {in,out} (06 §7 "Fields the page derives itself") — so the
// hook's server-default cashPaths/fcTotals are intentionally NOT used here.
import React, { useState, useMemo } from "react";
import { Icon, Card, SectionHeader, Badge, Button, MiniStat, SegmentedTabs, useToast } from "../components/Primitives";
import { LineChart, BarChart, cssVar } from "../components/Charts";
import { PageHeader } from "../components/Shell";
import { useForecast, useMeta } from "../api/hooks";
import * as fmt from "../lib/format";
import { PageState } from "./PageState";

function ScnRow({ color, name, end, min, note, F, money }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '11px 13px', border: '1px solid var(--slate-100)', borderRadius: 12, background: 'var(--slate-50)' }}>
      <span style={{ width: 4, borderRadius: 999, background: cssVar(color), flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--slate-800)' }}>{name}</span>
          <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>نهاية الفترة <b className="num" style={{ color: 'var(--slate-900)' }}>{money(end)}</b> · أدنى <b className="num" style={{ color: 'var(--slate-900)' }}>{money(min)}</b></span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 3, lineHeight: 1.5 }}>{note}</div>
      </div>
    </div>
  );
}

// MAPE / confidence accuracy badge (06 §7.5). Confidence → tone:
//   عالية → success (green) · متوسطة → warning (amber) · منخفضة → danger (red).
function ConfidenceBadge({ mape, confidence }) {
  // Render ONLY when the hook supplied a non-null confidence/mape (it returns
  // null when no MAPE is available on the cash_in series).
  if (confidence == null && mape == null) return null;
  const tone = confidence === 'عالية' ? 'green'
    : confidence === 'متوسطة' ? 'amber'
    : confidence === 'منخفضة' ? 'red'
    : 'gray';
  return (
    <Badge tone={tone}>
      دقة التنبؤ: {confidence ?? '—'}
      {mape != null && <span className="num" style={{ marginInlineStart: 6, opacity: 0.85 }}>MAPE {Math.round(mape)}%</span>}
    </Badge>
  );
}

export function Forecast({ reserve: reserveProp, incomeGrowth = 0 }) {
  const { showToast } = useToast();
  const F = fmt;
  const [scn, setScn] = useState('base');

  const fcHook = useForecast();   // forecast[]/scenarios/mape/confidence
  const meta = useMeta();         // CURRENT_CASH (origin) + RESERVE_M (default)

  const loading = fcHook.loading || meta.loading;
  const error = fcHook.error || meta.error;

  // The reserve prop (from Settings) overrides; otherwise default to the meta
  // RESERVE_M. Resolved here so the hooks above always run unconditionally.
  const RESERVE_M = meta.data?.RESERVE_M ?? 0;
  const CURRENT_CASH = meta.data?.CURRENT_CASH ?? 0;
  const reserve = reserveProp != null ? reserveProp : RESERVE_M;
  const g = 1 + incomeGrowth / 100;
  const forecastRows = fcHook.data?.forecast || [];

  // Recompute net / cash paths / totals locally (interactive sliders). Hooks
  // before any early return — useMemo always runs.
  const calc = useMemo(() => {
    const keys = ['base', 'opt', 'pess'];
    const months = forecastRows.map(m => {
      const o = { label: m.label, short: m.short };
      keys.forEach(k => {
        const blk = m[k] || {};
        const inV = (blk.in || 0) * g, outV = blk.out || 0;
        o[k] = { in: inV, out: outV, net: inV - outV };
      });
      return o;
    });
    const paths = {}; const totals = {};
    keys.forEach(k => {
      let c = CURRENT_CASH; const p = [];
      months.forEach(m => { c += m[k].net - reserve; p.push(c); });
      paths[k] = p;
      totals[k] = {
        in: months.reduce((a, m) => a + m[k].in, 0),
        out: months.reduce((a, m) => a + m[k].out, 0),
        net: months.reduce((a, m) => a + m[k].net, 0),
        end: p.length ? p[p.length - 1] : CURRENT_CASH,
        min: p.length ? Math.min(...p) : CURRENT_CASH,
      };
    });
    return { months, paths, totals };
  }, [forecastRows, reserve, g, CURRENT_CASH]);

  if (loading || error || !fcHook.data || !meta.data) {
    return (
      <div style={{ padding: '24px 28px 48px' }}>
        <PageState
          loading={loading}
          error={error}
          onRetry={() => { fcHook.refetch(); meta.refetch(); }}
        />
      </div>
    );
  }

  // ---- Loaded view (pixel-parity) ----
  const D = fcHook.data;
  const labels = ['الآن', ...calc.months.map(m => m.short)];
  const cashSeries = (k) => [CURRENT_CASH, ...calc.paths[k]];
  const t = calc.totals[scn];
  const money = (m) => F.fmtM(m);
  const scnLabel = (D.scenarios?.[scn]?.label) || '';
  // Forecast date range, derived from the live data (not hardcoded) so it always
  // matches the projected months — e.g. "حزيران 2026 → أيار 2027".
  const fcMonths = D.forecast || [];
  const fcRange = fcMonths.length
    ? `${fcMonths[0].label} → ${fcMonths[fcMonths.length - 1].label}`
    : '';
  const runwayMonths = (() => {
    const avgOut = (calc.totals.pess.out / 12) || 1;
    return (calc.totals.pess.min / avgOut);
  })();

  return (
    <div style={{ padding: '24px 28px 48px' }}>
      <PageHeader title="التنبؤ والسيناريوهات" subtitle={`إسقاط ${fcMonths.length || 12} شهراً قادماً${fcRange ? ` (${fcRange})` : ''} وفق نمط موسمي، مع خصم احتياطي مصاريف الشركاء. ثلاثة سيناريوهات للسيولة.`}
        actions={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ConfidenceBadge mape={D.mape} confidence={D.confidence} />
          <Button variant="secondary" size="sm" icon="download" onClick={() => showToast('تم تجهيز ملف التنبؤ')}>تصدير</Button>
        </div>} />

      {/* تنويه التعديلات الحيّة */}
      {(reserve !== RESERVE_M || incomeGrowth !== 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 12.5, color: 'var(--primary-700)', background: 'var(--primary-50)', border: '1px solid var(--primary-200)', borderRadius: 10, padding: '8px 14px', width: 'fit-content' }}>
          <Icon name="cog" className="w-4 h-4" />
          إسقاط معدّل: احتياطي <b className="num">{reserve}</b> مليون/شهر · نمو المقبوضات <b className="num">{incomeGrowth >= 0 ? '+' : ''}{incomeGrowth}%</b>
        </div>
      )}

      {/* مؤشرات السيناريو المختار */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <SegmentedTabs size="sm" value={scn} onChange={setScn} items={[
          { id: 'opt', label: 'متفائل' }, { id: 'base', label: 'متحفّظ' }, { id: 'pess', label: 'متشائم' },
        ]} />
        <span style={{ fontSize: 12.5, color: 'var(--slate-500)' }}>الرصيد الحالي <b className="num" style={{ color: 'var(--slate-800)' }}>{money(CURRENT_CASH)}</b> مليون د.ع</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 16, marginBottom: 22 }}>
        <MiniStat label="مقبوضات متوقعة · 12 شهر" value={money(t.in)} unit={F.unitM(t.in)} tone="success" icon="arrowdown" />
        <MiniStat label="مصروفات متوقعة · 12 شهر" value={money(t.out)} unit={F.unitM(t.out)} tone="danger" icon="arrowup" />
        <MiniStat label="صافي متوقع" value={`${t.net >= 0 ? '+' : ''}${money(t.net)}`} unit={F.unitM(t.net)} tone={t.net >= 0 ? 'success' : 'danger'} icon="scale" />
        <MiniStat label="رصيد متوقع نهاية الفترة" value={money(t.end)} unit={F.unitM(t.end)} tone={t.end >= CURRENT_CASH ? 'success' : 'warning'} icon="wallet" note={`أدنى رصيد ${money(t.min)} مليون`} />
      </div>

      {/* مسار رصيد الصناديق — 3 سيناريوهات */}
      <Card style={{ marginBottom: 22 }}>
        <SectionHeader title="مسار رصيد الصناديق المتوقع" subtitle="بعد خصم الاحتياطي الشهري — مقارنة السيناريوهات الثلاثة" icon="forecast"
          action={<div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {[['opt', 'متفائل', '--chart-2'], ['base', 'متحفّظ', '--chart-1'], ['pess', 'متشائم', '--chart-5']].map(([k, l, c]) => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--slate-600)' }}>
                <span style={{ width: 14, height: 3, borderRadius: 2, background: cssVar(c) }} />{l}
              </span>
            ))}
          </div>} />
        <LineChart height={320} labels={labels} formatY={F.fmtM} tickEvery={1} yZero={false}
          series={[
            { key: 'opt',  label: 'متفائل', color: '--chart-2', values: cashSeries('opt'),  width: 2.25, dashed: false },
            { key: 'base', label: 'متحفّظ', color: '--chart-1', values: cashSeries('base'), width: 2.75, dashed: false },
            { key: 'pess', label: 'متشائم', color: '--chart-5', values: cashSeries('pess'), width: 2.25, dashed: false },
          ]} />
        <div style={{ fontSize: 11.5, color: 'var(--slate-400)', marginTop: 8, textAlign: 'center' }}>القيم بالمليون دينار · يبدأ المسار من الرصيد الحالي للصناديق</div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 22 }}>
        <Card>
          <SectionHeader title={`الصافي الشهري المتوقع — ${scnLabel}`} subtitle="قبل خصم الاحتياطي" icon="scale" />
          <BarChart height={280} data={calc.months.map(m => ({ label: m.short, value: m[scn].net }))} formatY={F.fmtM} unit="مليون د.ع"
            colorFor={(v) => v >= 0 ? '--chart-2' : '--chart-5'} />
        </Card>

        <Card>
          <SectionHeader title="قراءة السيناريوهات" subtitle="ماذا تعني للمعرض" icon="scenarios" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ScnRow color="--chart-2" name="متفائل" end={calc.totals.opt.end} min={calc.totals.opt.min} F={F} money={money}
              note="نمو المقبوضات 8% وضبط المصروفات 2% — الرصيد ينمو بثبات." />
            <ScnRow color="--chart-1" name="متحفّظ" end={calc.totals.base.end} min={calc.totals.base.min} F={F} money={money}
              note="استمرار النمط الحالي — رصيد شبه مستقر مع ضغط متصاعد." />
            <ScnRow color="--chart-5" name="متشائم" end={calc.totals.pess.end} min={calc.totals.pess.min} F={F} money={money}
              note="تراجع المقبوضات 8% وارتفاع المصروفات 6% — تآكل واضح في الرصيد." />
          </div>
          <div style={{ marginTop: 14, padding: '12px 14px', background: runwayMonths < 4 ? 'var(--danger-50)' : 'var(--warning-50)', border: `1px solid ${runwayMonths < 4 ? 'var(--danger-200)' : 'var(--warning-200)'}`, borderRadius: 12, fontSize: 12.5, color: runwayMonths < 4 ? 'var(--danger-700)' : 'var(--warning-800)', lineHeight: 1.6, display: 'flex', gap: 10 }}>
            <Icon name="warn" className="w-5 h-5" style={{ flex: 'none' }} />
            <span>في السيناريو المتشائم، يكفي أدنى رصيد متوقع لتغطية نحو <b className="num">{runwayMonths.toFixed(1)}</b> أشهر من المصروفات — يُنصح بضبط سحوبات الشركاء وتسريع تحصيل الأقساط المتأخرة.</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default Forecast;
