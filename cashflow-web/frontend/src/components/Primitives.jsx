// البيت السعيد — Primitives (Icons + reusable UI).
//
// Ported verbatim from design-reference/project/src/Primitives.jsx. The visuals
// (dimensions, colors, icon SVG paths, paddings, radii, animations) are a
// BINDING contract and are preserved byte-for-byte. The ONLY changes are
// mechanical module/global transforms:
//   1. React UMD globals → ES import (below).
//   2. `Object.assign(window, {...})` → named `export` on each component.
//   3. The toast system's module-level `window.showToast` global → a React
//      context (ToastProvider / useToast / ToastHost). See the toast section.
import React, { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } from "react";

// ---------- Icons (Heroicons outline, 1.5 stroke) -----------------------
const ICON_PATHS = {
  home:    <path d="M2.25 12 12 3l9.75 9M4.5 10.5V21h5.25v-6h4.5v6H19.5V10.5" />,
  chart:   <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />,
  cash:    <path d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V12Zm-12 0h.008v.008H6V12Z" />,
  wallet:  <path d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />,
  building:<path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />,
  users:   <path d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />,
  truck:   <path d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />,
  scenarios:<path d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />,
  forecast:<path d="m2.25 18 3.75-3.75 3 3L15 9.75l3 3M21 6.75 18 9.75l-3-3" />,
  scale:   <path d="M12 3v17.25M5.25 4.97c-.99.143-2.01.317-3 .52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.97ZM18.75 4.97c.99.143 2.01.317 3 .52l-2.62 10.726c-.122.499.106 1.028.589 1.202a5.988 5.988 0 0 0 2.031.352 5.988 5.988 0 0 0 2.031-.352c.483-.174.711-.703.59-1.202L18.75 4.97Z" />,
  bell:    <path d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />,
  search:  <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />,
  chevdown:<path d="m19.5 8.25-7.5 7.5-7.5-7.5" />,
  chevleft:<path d="M15.75 19.5 8.25 12l7.5-7.5" />,
  chevright:<path d="m8.25 4.5 7.5 7.5-7.5 7.5" />,
  download:<path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />,
  calendar:<path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75M3 10.5h18" />,
  up:      <path d="M2.25 18 9 11.25l4.306 4.307a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />,
  down:    <path d="M2.25 6 9 12.75l4.286-4.286a11.948 11.948 0 0 1 4.306 5.227l3.158-3.159M21.75 18.75 21 13.5m.75 5.25-5.25-.75" />,
  arrowup: <path d="M12 19.5v-15m0 0-6.75 6.75M12 4.5l6.75 6.75" />,
  arrowdown:<path d="M12 4.5v15m0 0 6.75-6.75M12 19.5l-6.75-6.75" />,
  alert:   <path d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />,
  warn:    <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />,
  info:    <path d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />,
  check:   <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  clock:   <path d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  cog:     <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.241.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.991l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />,
  filter:  <path d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />,
  dollar:  <path d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  doc:     <path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />,
  close:   <path d="M6 18 18 6M6 6l12 12" />,
  reset:   <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />,
  sliders: <path d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />,
  palette: <path d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z" />,
  shield:  <path d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />,
};
const TW_PX = { '3': 12, '3.5': 14, '4': 16, '5': 20, '6': 24, '7': 28, '8': 32 };
export function Icon({ name, className = "w-5 h-5", strokeWidth = 1.5, style }) {
  // لا يوجد Tailwind في هذا المشروع — نشتق الأبعاد بالبكسل من أصناف w-/h-
  let w = 20, h = 20;
  const reW = /w-([\d.]+)/; const mw = reW.exec(className); if (mw && TW_PX[mw[1]]) w = TW_PX[mw[1]];
  const reH = /h-([\d.]+)/; const mh = reH.exec(className); if (mh && TW_PX[mh[1]]) h = TW_PX[mh[1]];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', ...style }}>
      {ICON_PATHS[name] || null}
    </svg>
  );
}

// ---------- Badge --------------------------------------------------------
export function Badge({ tone = "gray", children, dot = false, className = '', style }) {
  return (
    <span className={`badge badge-${tone} ${className}`} style={style}>
      {dot && <span className="dot" style={{ width: 7, height: 7, background: 'currentColor' }} />}
      {children}
    </span>
  );
}

// ---------- Button -------------------------------------------------------
export function Button({ variant = 'primary', size = 'md', icon, iconEnd, children, onClick, disabled, className = '', style, title }) {
  const sz = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`btn btn-${variant} ${sz} ${className}`} style={style}>
      {icon && <Icon name={icon} className="w-4 h-4" />}
      {children}
      {iconEnd && <Icon name={iconEnd} className="w-4 h-4" />}
    </button>
  );
}
export function IconButton({ name, onClick, title, size = 32, active = false, style }) {
  const base = active ? 'var(--slate-100)' : 'transparent';
  return (
    <button onClick={onClick} title={title} aria-label={title}
      style={{ width: size, height: size, borderRadius: 8, background: base, border: 'none', cursor: 'pointer',
        color: active ? 'var(--primary-700)' : 'var(--slate-600)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 150ms', ...style }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--slate-100)'}
      onMouseLeave={e => e.currentTarget.style.background = base}>
      <Icon name={name} className="w-4 h-4" />
    </button>
  );
}

// ---------- Segmented tabs ----------------------------------------------
export function SegmentedTabs({ items, value, onChange, size = 'md' }) {
  const pad = size === 'sm' ? '6px 12px' : '8px 16px';
  const fs = size === 'sm' ? 12.5 : 13.5;
  return (
    <div style={{ display: 'inline-flex', background: 'var(--slate-100)', borderRadius: 10, padding: 3, gap: 2 }}>
      {items.map(it => {
        const active = it.id === value;
        return (
          <button key={it.id} onClick={() => onChange?.(it.id)}
            style={{ padding: pad, fontSize: fs, fontFamily: 'inherit', fontWeight: active ? 700 : 500,
              borderRadius: 8, border: 'none', cursor: 'pointer',
              background: active ? '#fff' : 'transparent', color: active ? 'var(--slate-900)' : 'var(--slate-600)',
              boxShadow: active ? '0 1px 2px rgba(15,23,42,0.10)' : 'none',
              display: 'inline-flex', alignItems: 'center', gap: 7, transition: 'all 150ms', whiteSpace: 'nowrap' }}>
            {it.icon && <Icon name={it.icon} className="w-4 h-4" />}
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Card + section ----------------------------------------------
export function Card({ children, padding = 20, className = '', style, onClick }) {
  return <div className={`card ${className}`} style={{ padding, ...(onClick ? { cursor: 'pointer' } : {}), ...style }} onClick={onClick}>{children}</div>;
}
export function SectionHeader({ title, subtitle, icon, action }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {icon && <span style={{ color: 'var(--slate-400)' }}><Icon name={icon} className="w-5 h-5" /></span>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'Tajawal', fontWeight: 700, fontSize: 17, color: 'var(--slate-900)', lineHeight: 1.3 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12.5, color: 'var(--slate-500)', marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

// ---------- KPI / Stat card ---------------------------------------------
// value: نص جاهز · unit · trend: {dir:'up'|'down', value, good:bool} · tone for accent
export function StatCard({ label, value, unit, sub, icon, tone = 'primary', trend, onClick, footer }) {
  const tints = {
    primary: ['var(--primary-50)', 'var(--primary-600)'],
    success: ['var(--success-50)', 'var(--success-600)'],
    danger:  ['var(--danger-50)',  'var(--danger-600)'],
    warning: ['var(--warning-50)', 'var(--warning-700)'],
    slate:   ['var(--slate-100)',  'var(--slate-600)'],
  }[tone] || ['var(--primary-50)', 'var(--primary-600)'];
  return (
    <Card padding={18} onClick={onClick} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 13, color: 'var(--slate-500)', fontWeight: 500 }}>{label}</div>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: tints[0], color: tints[1], display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <Icon name={icon} className="w-5 h-5" strokeWidth={1.75} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span className="num" style={{ fontFamily: 'Tajawal', fontWeight: 700, fontSize: 26, color: 'var(--slate-900)', lineHeight: 1, letterSpacing: '-0.01em' }}>{value}</span>
        {unit && <span style={{ fontSize: 12.5, color: 'var(--slate-500)', fontWeight: 600 }}>{unit}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {sub && <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>{sub}</span>}
        {trend && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 700,
            color: trend.good ? 'var(--success-700)' : 'var(--danger-600)', marginInlineStart: 'auto' }}>
            <Icon name={trend.dir === 'up' ? 'arrowup' : 'arrowdown'} className="w-3 h-3" strokeWidth={2.5} />
            {trend.value}
          </span>
        )}
      </div>
      {footer}
    </Card>
  );
}

// ---------- Tooltip host (shared floating) ------------------------------
export function useFloatTip() {
  const [tip, setTip] = useState(null); // {x,y,content}
  const node = tip ? (
    <div style={{ position: 'fixed', left: tip.x, top: tip.y, transform: 'translate(-50%, calc(-100% - 10px))',
      background: 'var(--slate-900)', color: '#fff', padding: '8px 11px', borderRadius: 10, fontSize: 12,
      pointerEvents: 'none', zIndex: 9000, boxShadow: '0 8px 24px rgba(15,23,42,0.28)', whiteSpace: 'nowrap',
      lineHeight: 1.5, maxWidth: 280 }}>
      {tip.content}
    </div>
  ) : null;
  return { tip, setTip, node };
}

// ---------- MiniStat (compact KPI) --------------------------------------
export function MiniStat({ label, value, unit, tone = 'primary', icon, note }) {
  const tints = {
    primary: ['var(--primary-50)', 'var(--primary-600)'], success: ['var(--success-50)', 'var(--success-600)'],
    danger: ['var(--danger-50)', 'var(--danger-600)'], warning: ['var(--warning-50)', 'var(--warning-700)'],
    slate: ['var(--slate-100)', 'var(--slate-600)'],
  }[tone] || ['var(--primary-50)', 'var(--primary-600)'];
  return (
    <Card padding={16} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12.5, color: 'var(--slate-500)', fontWeight: 500 }}>{label}</span>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: tints[0], color: tints[1], display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name={icon} className="w-4 h-4" /></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span className="num" style={{ fontFamily: 'Tajawal', fontWeight: 700, fontSize: 23, color: 'var(--slate-900)', lineHeight: 1 }}>{value}</span>
        {unit && <span style={{ fontSize: 12, color: 'var(--slate-500)', fontWeight: 600 }}>{unit}</span>}
      </div>
      {note && <span style={{ fontSize: 11.5, color: 'var(--slate-400)' }}>{note}</span>}
    </Card>
  );
}

// ---------- Toast system (React context) --------------------------------
// PORT NOTE: the design-reference used a module-level `toastBus` + a global
// `window.showToast` + a self-subscribing <ToastHost/>. That global is replaced
// here by a proper React context (transform #4), with the SAME visuals.
//
// Consumer shape:
//   1. Wrap the app in <ToastProvider> (it renders <ToastHost/> itself, so you
//      do not need to mount the host separately — it lives at the end of the
//      provider's tree).
//   2. Call `const { showToast } = useToast()` and `showToast(message, tone)`.
//
// `ToastHost` is ALSO exported standalone for callers who want to place the
// visual layer explicitly; it reads the toast list from context. The
// auto-dismiss after 2800ms is preserved.
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  // Track pending auto-dismiss timers so we can clear them on unmount (avoids a
  // "state update on an unmounted component" warning + a leaked timer when the
  // provider unmounts within the 2800ms window — common in mount→unmount tests).
  const timersRef = useRef(new Set());
  const showToast = useCallback((message, tone = 'success') => {
    const t = { id: Date.now() + Math.random(), message, tone };
    setItems(s => [...s, t]);
    const timerId = setTimeout(() => {
      timersRef.current.delete(timerId);
      setItems(s => s.filter(x => x.id !== t.id));
    }, 2800);
    timersRef.current.add(timerId);
  }, []);
  // Clear ALL pending auto-dismiss timers on provider unmount.
  useEffect(() => () => {
    for (const id of timersRef.current) clearTimeout(id);
    timersRef.current.clear();
  }, []);
  const value = useMemo(() => ({ showToast, toasts: items }), [showToast, items]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error("useToast must be used inside a <ToastProvider>");
  }
  return ctx;
}

export function ToastHost() {
  const { toasts: items } = useToast();
  const cfg = {
    success: ['var(--success-600)', 'check'], info: ['var(--primary-600)', 'info'],
    warning: ['var(--warning-600)', 'warn'], danger: ['var(--danger-600)', 'alert'],
  };
  return (
    <div style={{ position: 'fixed', bottom: 22, insetInlineStart: 22, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none' }}>
      {items.map(t => {
        const [c, ic] = cfg[t.tone] || cfg.success;
        return (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'var(--slate-900)', color: '#fff',
            padding: '12px 16px', borderRadius: 12, boxShadow: '0 12px 32px rgba(15,23,42,0.30)', fontSize: 13.5, fontWeight: 500,
            minWidth: 240, animation: 'toastIn 240ms cubic-bezier(0.4,0,0.2,1)' }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: c, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
              <Icon name={ic} className="w-4 h-4" strokeWidth={2} />
            </span>
            <span>{t.message}</span>
          </div>
        );
      })}
      <style>{`@keyframes toastIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}

// ---------- Form controls (settings) ------------------------------------
export function Toggle({ checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      style={{ width: 44, height: 25, borderRadius: 999, border: 'none', cursor: 'pointer', padding: 3, flex: 'none',
        background: checked ? 'var(--primary-600)' : 'var(--slate-300)', transition: 'background 200ms', position: 'relative' }}>
      <span style={{ display: 'block', width: 19, height: 19, borderRadius: 999, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        transform: checked ? 'translateX(-19px)' : 'translateX(0)', transition: 'transform 200ms cubic-bezier(0.4,0,0.2,1)' }} />
    </button>
  );
}
export function NumberField({ value, onChange, min, max, step = 1, suffix, width = 110 }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={e => { let v = parseFloat(e.target.value); if (isNaN(v)) v = min ?? 0; if (min != null) v = Math.max(min, v); if (max != null) v = Math.min(max, v); onChange(v); }}
        className="num" style={{ width, padding: '8px 11px', border: '1px solid var(--slate-300)', borderRadius: 8, fontFamily: 'inherit',
          fontSize: 13.5, color: 'var(--slate-900)', outline: 'none', textAlign: 'left' }}
        onFocus={e => { e.target.style.borderColor = 'var(--primary-600)'; e.target.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.12)'; }}
        onBlur={e => { e.target.style.borderColor = 'var(--slate-300)'; e.target.style.boxShadow = 'none'; }} />
      {suffix && <span style={{ fontSize: 12.5, color: 'var(--slate-500)', fontWeight: 600 }}>{suffix}</span>}
    </div>
  );
}
export function Slider({ value, min, max, step = 1, onChange, unit }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 220 }}>
      <input type="range" value={value} min={min} max={max} step={step} onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--primary-600)', height: 4 }} />
      <span className="num" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--slate-900)', minWidth: 48, textAlign: 'left' }}>{value}{unit || ''}</span>
    </div>
  );
}
// صف إعداد: عنوان + وصف على اليمين، تحكّم على اليسار
export function SettingRow({ label, hint, children, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, padding: '14px 0',
      borderBottom: last ? 'none' : '1px solid var(--slate-100)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--slate-800)' }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 3, lineHeight: 1.5, maxWidth: 460 }}>{hint}</div>}
      </div>
      <div style={{ flex: 'none' }}>{children}</div>
    </div>
  );
}
