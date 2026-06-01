// البيت السعيد — Charts (lightweight interactive SVG). Plain React via Babel.
/* global React, Icon */
const { useState: useStateC, useRef: useRefC, useEffect: useEffectC, useMemo: useMemoC } = React;

function cssVar(v) { return v && v.startsWith('--') ? `var(${v})` : v; }

// قياس عرض الحاوية
function useWidth() {
  const ref = useRefC(null);
  const [w, setW] = useStateC(720);
  useEffectC(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(es => { for (const e of es) setW(e.contentRect.width); });
    ro.observe(ref.current);
    setW(ref.current.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// نقطة tooltip عائمة داخل الرسم
function ChartTip({ x, y, children, width }) {
  const flip = x > width - 150;
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `translate(${flip ? '-100%' : '0'}, -50%)`,
      marginInlineStart: flip ? -12 : 12, background: 'var(--slate-900)', color: '#fff',
      padding: '9px 12px', borderRadius: 10, fontSize: 12, pointerEvents: 'none', zIndex: 50,
      boxShadow: '0 10px 28px rgba(15,23,42,0.30)', lineHeight: 1.6, whiteSpace: 'nowrap' }}>
      {children}
    </div>
  );
}

// ============ Line / Area chart ============
// series: [{ key, label, color, values:[], area?:bool, dashed?:bool, width? }]
// forecastFrom: index من حيثُ يبدأ التنبؤ (خط منقّط + تظليل)
function LineChart({ series, labels, height = 280, formatY, forecastFrom = null, yZero = true, renderTip, tickEvery = 1 }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useStateC(null);
  const padT = 16, padB = 30, padR = 12, padL = 52;
  const n = labels.length;
  const innerW = Math.max(10, W - padL - padR);
  const innerH = height - padT - padB;

  const all = series.flatMap(s => s.values).filter(v => v != null);
  let max = Math.max(...all, 0), min = Math.min(...all, 0);
  if (!yZero) min = Math.min(...all);
  const pad = (max - min) * 0.08 || 1;
  max += pad; if (min < 0) min -= pad; else if (yZero) min = 0;
  const X = i => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const Y = v => padT + innerH - ((v - min) / (max - min || 1)) * innerH;

  const ticks = useMemoC(() => {
    const t = []; const steps = 4;
    for (let k = 0; k <= steps; k++) t.push(min + (max - min) * k / steps);
    return t;
  }, [min, max]);

  const linePath = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'} ${X(i)} ${Y(v)}`).join(' ');
  const areaPath = (vals) => `${linePath(vals)} L ${X(n - 1)} ${Y(min < 0 ? 0 : min)} L ${X(0)} ${Y(min < 0 ? 0 : min)} Z`;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', userSelect: 'none' }}
      onMouseLeave={() => setHi(null)}
      onMouseMove={e => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left;
        let idx = Math.round(((px - padL) / innerW) * (n - 1));
        idx = Math.max(0, Math.min(n - 1, idx));
        setHi(idx);
      }}>
      <svg width={W} height={height} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          {series.filter(s => s.area).map(s => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cssVar(s.color)} stopOpacity="0.18" />
              <stop offset="100%" stopColor={cssVar(s.color)} stopOpacity="0.01" />
            </linearGradient>
          ))}
        </defs>
        {/* gridlines + y labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={Y(t)} y2={Y(t)} stroke="var(--slate-100)" strokeWidth="1" />
            <text x={padL - 8} y={Y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--slate-400)" className="num">{formatY ? formatY(t) : Math.round(t)}</text>
          </g>
        ))}
        {/* zero line */}
        {min < 0 && <line x1={padL} x2={W - padR} y1={Y(0)} y2={Y(0)} stroke="var(--slate-300)" strokeWidth="1.25" />}
        {/* forecast shaded region */}
        {forecastFrom != null && forecastFrom < n && (
          <rect x={X(forecastFrom) - innerW / (n - 1) / 2} y={padT} width={W - padR - (X(forecastFrom) - innerW / (n - 1) / 2)} height={innerH}
            fill="var(--slate-100)" opacity="0.5" />
        )}
        {/* x labels */}
        {labels.map((lb, i) => (i % tickEvery === 0 || i === n - 1) && (
          <text key={i} x={X(i)} y={height - 10} textAnchor="middle" fontSize="10" fill="var(--slate-400)" className="num">{lb}</text>
        ))}
        {/* areas */}
        {series.filter(s => s.area).map(s => (
          <path key={s.key} d={areaPath(s.values)} fill={`url(#g-${s.key})`} />
        ))}
        {/* lines (split solid/dashed at forecastFrom) */}
        {series.map(s => {
          if (forecastFrom == null || s.dashed === false) {
            return <path key={s.key} d={linePath(s.values)} fill="none" stroke={cssVar(s.color)} strokeWidth={s.width || 2.25} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />;
          }
          const solid = s.values.slice(0, forecastFrom + 1);
          const dash = s.values.slice(forecastFrom);
          return (
            <g key={s.key}>
              <path d={linePath(solid)} fill="none" stroke={cssVar(s.color)} strokeWidth={s.width || 2.25} strokeLinejoin="round" strokeLinecap="round" />
              <path d={dash.map((v, i) => `${i ? 'L' : 'M'} ${X(forecastFrom + i)} ${Y(v)}`).join(' ')} fill="none" stroke={cssVar(s.color)} strokeWidth={s.width || 2.25} strokeDasharray="5 4" strokeLinecap="round" opacity="0.85" />
            </g>
          );
        })}
        {/* hover guide + dots */}
        {hi != null && (
          <g>
            <line x1={X(hi)} x2={X(hi)} y1={padT} y2={padT + innerH} stroke="var(--slate-300)" strokeWidth="1" strokeDasharray="3 3" />
            {series.map(s => s.values[hi] != null && (
              <circle key={s.key} cx={X(hi)} cy={Y(s.values[hi])} r="4" fill="#fff" stroke={cssVar(s.color)} strokeWidth="2.5" />
            ))}
          </g>
        )}
      </svg>
      {hi != null && (
        <ChartTip x={X(hi)} y={padT + 16} width={W}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: '#fff' }}>{labels[hi]}{renderTip?.meta?.(hi)}</div>
          {series.map(s => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: cssVar(s.color), display: 'inline-block' }} />
              <span style={{ color: 'var(--slate-300)' }}>{s.label}</span>
              <span className="num" style={{ marginInlineStart: 'auto', fontWeight: 700 }}>{(formatY ? formatY(s.values[hi]) : Math.round(s.values[hi]))}</span>
            </div>
          ))}
        </ChartTip>
      )}
    </div>
  );
}

// ============ Bar chart (signed) ============
// data: [{ label, value }] ; colorFor(value, i) -> color
function BarChart({ data, height = 220, formatY, colorFor, tickEvery = 1, unit = '' }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useStateC(null);
  const padT = 12, padB = 28, padR = 8, padL = 50;
  const n = data.length;
  const innerW = Math.max(10, W - padL - padR);
  const innerH = height - padT - padB;
  const vals = data.map(d => d.value);
  let max = Math.max(...vals, 0), min = Math.min(...vals, 0);
  const pad = (max - min) * 0.1 || 1; max += pad; if (min < 0) min -= pad;
  const Y = v => padT + innerH - ((v - min) / (max - min || 1)) * innerH;
  const bw = innerW / n;
  const barW = Math.min(26, bw * 0.62);
  const X = i => padL + bw * i + bw / 2;
  const ticks = []; for (let k = 0; k <= 4; k++) ticks.push(min + (max - min) * k / 4);

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }} onMouseLeave={() => setHi(null)}>
      <svg width={W} height={height} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={Y(t)} y2={Y(t)} stroke="var(--slate-100)" />
            <text x={padL - 8} y={Y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--slate-400)" className="num">{formatY ? formatY(t) : Math.round(t)}</text>
          </g>
        ))}
        {min < 0 && <line x1={padL} x2={W - padR} y1={Y(0)} y2={Y(0)} stroke="var(--slate-300)" strokeWidth="1.25" />}
        {data.map((d, i) => {
          const y0 = Y(Math.max(0, d.value)), y1 = Y(Math.min(0, d.value));
          const col = colorFor ? colorFor(d.value, i) : 'var(--primary-500)';
          return (
            <g key={i} onMouseEnter={() => setHi(i)}>
              <rect x={X(i) - bw / 2} y={padT} width={bw} height={innerH} fill={hi === i ? 'var(--slate-100)' : 'transparent'} opacity="0.6" />
              <rect x={X(i) - barW / 2} y={y0} width={barW} height={Math.max(1, y1 - y0)} rx="3" fill={cssVar(col)} opacity={hi == null || hi === i ? 1 : 0.55} style={{ transition: 'opacity 150ms' }} />
            </g>
          );
        })}
        {data.map((d, i) => (i % tickEvery === 0 || i === n - 1) && (
          <text key={i} x={X(i)} y={height - 9} textAnchor="middle" fontSize="9.5" fill="var(--slate-400)" className="num">{d.label}</text>
        ))}
      </svg>
      {hi != null && (
        <ChartTip x={X(hi)} y={Y(Math.max(0, data[hi].value)) - 4} width={W}>
          <div style={{ fontWeight: 700, color: '#fff' }}>{data[hi].label}</div>
          <div className="num" style={{ color: 'var(--slate-200)' }}>{formatY ? formatY(data[hi].value) : Math.round(data[hi].value)} {unit}</div>
        </ChartTip>
      )}
    </div>
  );
}

// ============ Stacked bar chart ============
// data: [{ label, segments:[{key,label,value,color}] }]
function StackedBarChart({ data, height = 260, formatY, tickEvery = 1, unit = '' }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useStateC(null);
  const padT = 12, padB = 28, padR = 8, padL = 50;
  const n = data.length;
  const innerW = Math.max(10, W - padL - padR);
  const innerH = height - padT - padB;
  const totals = data.map(d => d.segments.reduce((a, s) => a + s.value, 0));
  let max = Math.max(...totals, 0); max *= 1.08;
  const Y = v => padT + innerH - (v / (max || 1)) * innerH;
  const bw = innerW / n;
  const barW = Math.min(30, bw * 0.66);
  const X = i => padL + bw * i + bw / 2;
  const ticks = []; for (let k = 0; k <= 4; k++) ticks.push(max * k / 4);

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }} onMouseLeave={() => setHi(null)}>
      <svg width={W} height={height} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={Y(t)} y2={Y(t)} stroke="var(--slate-100)" />
            <text x={padL - 8} y={Y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--slate-400)" className="num">{formatY ? formatY(t) : Math.round(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          let acc = 0;
          return (
            <g key={i} onMouseEnter={() => setHi(i)}>
              <rect x={X(i) - bw / 2} y={padT} width={bw} height={innerH} fill={hi === i ? 'var(--slate-100)' : 'transparent'} opacity="0.6" />
              {d.segments.map((s, k) => {
                const y0 = Y(acc + s.value), h = Y(acc) - Y(acc + s.value); acc += s.value;
                return <rect key={k} x={X(i) - barW / 2} y={y0} width={barW} height={Math.max(0, h)} fill={cssVar(s.color)} opacity={hi == null || hi === i ? 1 : 0.5} style={{ transition: 'opacity 150ms' }} />;
              })}
            </g>
          );
        })}
        {data.map((d, i) => (i % tickEvery === 0 || i === n - 1) && (
          <text key={i} x={X(i)} y={height - 9} textAnchor="middle" fontSize="9.5" fill="var(--slate-400)" className="num">{d.label}</text>
        ))}
      </svg>
      {hi != null && (
        <ChartTip x={X(hi)} y={padT + 14} width={W}>
          <div style={{ fontWeight: 700, color: '#fff', marginBottom: 4 }}>{data[hi].label}</div>
          {[...data[hi].segments].reverse().map((s, k) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: cssVar(s.color), display: 'inline-block' }} />
              <span style={{ color: 'var(--slate-300)' }}>{s.label}</span>
              <span className="num" style={{ marginInlineStart: 'auto', fontWeight: 700 }}>{formatY ? formatY(s.value) : Math.round(s.value)}</span>
            </div>
          ))}
        </ChartTip>
      )}
    </div>
  );
}

// ============ Donut ============
// segments: [{label,value,color}]
function Donut({ segments, size = 180, thickness = 26, centerLabel, centerSub, onHover }) {
  const [hi, setHi] = useStateC(null);
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = size / 2 - thickness / 2;
  const cx = size / 2, cy = size / 2;
  let acc = 0;
  const arcs = segments.map((s, i) => {
    const a0 = acc / total * Math.PI * 2; acc += s.value;
    const a1 = acc / total * Math.PI * 2;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.sin(a0), y0 = cy - r * Math.cos(a0);
    const x1 = cx + r * Math.sin(a1), y1 = cy - r * Math.cos(a1);
    return { d: `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`, color: s.color, i, s };
  });
  return (
    <div style={{ position: 'relative', width: size, height: size }} onMouseLeave={() => { setHi(null); onHover?.(null); }}>
      <svg width={size} height={size}>
        {arcs.map(a => (
          <path key={a.i} d={a.d} fill="none" stroke={cssVar(a.color)} strokeWidth={hi === a.i ? thickness + 5 : thickness}
            strokeLinecap="butt" opacity={hi == null || hi === a.i ? 1 : 0.45}
            style={{ transition: 'all 150ms', cursor: 'pointer' }}
            onMouseEnter={() => { setHi(a.i); onHover?.(a.i); }} />
        ))}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div className="num" style={{ fontFamily: 'Tajawal', fontWeight: 700, fontSize: size * 0.16, color: 'var(--slate-900)', lineHeight: 1 }}>
          {hi != null ? (segments[hi].value / total * 100).toFixed(0) + '%' : centerLabel}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--slate-500)', marginTop: 4, textAlign: 'center', maxWidth: size - thickness * 2 }}>
          {hi != null ? segments[hi].label : centerSub}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LineChart, BarChart, StackedBarChart, Donut, cssVar });
