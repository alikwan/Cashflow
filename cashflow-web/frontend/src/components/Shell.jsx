// البيت السعيد — Shell (Sidebar + Header + PageHeader)
//
// Pixel-parity port of design-reference/project/src/Shell.jsx. The visuals (JSX,
// inline styles, dimensions, var(--…) colors, icon names, paddings, radii, font
// sizes) are copied verbatim. The ONLY changes from the source are mechanical:
//   1. React UMD globals → ES imports (aliased locals kept to minimise the diff).
//   2. Icon/Badge pulled from ./Primitives instead of UMD globals.
//   3. Object.assign(window, …) → named exports (plus extra exports for tests).
//   4. Data flows in via PROPS, not window.DATA: GlobalSearch takes a prebuilt
//      `searchIndex` array; NotificationsBell takes `alerts`. No window.* refs.
//   5. AppShell — the top-level sidebar+header+content layout the design ref did
//      not ship — is new here (the one piece of genuinely new layout code).
import React from "react";
import { Icon, Badge } from "./Primitives";
const { useState: useStateS, useRef: useRefS, useEffect: useEffectS } = React;

const NAV = [
  { label: 'عام', items: [
    { id: 'dashboard', icon: 'home', name: 'اللوحة التنفيذية' },
  ]},
  { label: 'التدفق النقدي', items: [
    { id: 'monthly',  icon: 'chart',  name: 'التدفق الشهري' },
    { id: 'breakdown', icon: 'cash',  name: 'المقبوضات والمصروفات' },
  ]},
  { label: 'الموردون والأقساط', items: [
    { id: 'suppliers',    icon: 'truck', name: 'الموردون الـ14' },
    { id: 'installments', icon: 'doc',   name: 'الأقساط المفتوحة' },
  ]},
  { label: 'التخطيط والتنبؤ', items: [
    { id: 'forecast',      icon: 'forecast',  name: 'التنبؤ والسيناريوهات' },
    { id: 'supplierplan',  icon: 'scenarios', name: 'توزيع موردين تنبؤي' },
  ]},
  { label: 'النظام', items: [
    { id: 'settings', icon: 'cog', name: 'الإعدادات' },
  ]},
];

const PAGE_META = {
  dashboard:    { crumb: 'اللوحة التنفيذية',      icon: 'home' },
  monthly:      { crumb: 'التدفق الشهري',          icon: 'chart' },
  breakdown:    { crumb: 'المقبوضات والمصروفات',   icon: 'cash' },
  suppliers:    { crumb: 'الموردون الـ14',         icon: 'truck' },
  installments: { crumb: 'الأقساط المفتوحة',       icon: 'doc' },
  forecast:     { crumb: 'التنبؤ والسيناريوهات',   icon: 'forecast' },
  supplierplan: { crumb: 'توزيع موردين تنبؤي',     icon: 'scenarios' },
  settings:     { crumb: 'الإعدادات',              icon: 'cog' },
};
const PAGE_LABEL = (id) => (PAGE_META[id] || {}).crumb || id;

function Sidebar({ active, onNavigate, onLogout }) {
  return (
    <aside style={{ width: 256, flex: 'none', background: '#fff', borderLeft: '1px solid var(--slate-200)',
      display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0, zIndex: 20 }}>
      <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 11, borderBottom: '1px solid var(--slate-100)' }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg,#2563EB,#7C3AED)',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(37,99,235,0.32)' }}>
          <Icon name="building" className="w-5 h-5" strokeWidth={1.75} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Tajawal', fontWeight: 700, fontSize: 15, color: 'var(--slate-900)', lineHeight: 1.1 }}>البيت السعيد</div>
          <div style={{ fontSize: 11, color: 'var(--slate-500)', marginTop: 3 }}>تحليل السيولة النقدية</div>
        </div>
      </div>
      <nav style={{ flex: 1, overflow: 'auto', padding: '10px 10px 16px' }}>
        {NAV.map((g, i) => (
          <div key={i} style={{ marginTop: i ? 16 : 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--slate-400)', letterSpacing: '0.08em', padding: '6px 10px' }}>{g.label}</div>
            {g.items.map(item => <NavButton key={item.id} item={item} active={active === item.id} onClick={() => onNavigate(item.id)} />)}
          </div>
        ))}
      </nav>
      <div style={{ padding: 10, borderTop: '1px solid var(--slate-100)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 11, background: '#0891B2', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Tajawal', fontWeight: 700, fontSize: 13, flex: 'none' }}>ع.س</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--slate-800)', lineHeight: 1.2 }}>علي السامرائي</div>
            <div style={{ fontSize: 11, color: 'var(--slate-500)', marginTop: 2 }}>صاحب المعرض</div>
          </div>
          {onLogout && (
            <button onClick={() => onLogout?.()} title="تسجيل الخروج" aria-label="تسجيل الخروج"
              style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer',
                color: 'var(--slate-500)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                flex: 'none', marginInlineStart: 'auto', transition: 'background 150ms, color 150ms' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--slate-100)'; e.currentTarget.style.color = 'var(--slate-700)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--slate-500)'; }}>
              <Icon name="logout" className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function NavButton({ item, active, onClick }) {
  const [hover, setHover] = useStateS(false);
  const bg = active ? 'var(--primary-50)' : hover ? 'var(--slate-50)' : 'transparent';
  const fg = active ? 'var(--primary-700)' : 'var(--slate-700)';
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '9px 10px', marginBottom: 1,
        borderRadius: 8, border: 'none', background: bg, color: fg, fontFamily: 'inherit', fontSize: 13.5,
        fontWeight: active ? 700 : 500, cursor: 'pointer', textAlign: 'right', position: 'relative',
        transition: 'background 150ms, color 150ms' }}>
      {active && <span style={{ position: 'absolute', insetInlineEnd: -10, top: 6, bottom: 6, width: 3, background: 'var(--primary-600)', borderRadius: '4px 0 0 4px' }} />}
      <Icon name={item.icon} className="w-5 h-5" strokeWidth={active ? 2 : 1.5} />
      <span style={{ flex: 1 }}>{item.name}</span>
    </button>
  );
}

// ---- بحث عام (يقفز للصفحات/الموردين/المدينين) ----
// PURE: takes the two data arrays (suppliers, top-debtors) — the source read
// these from window.DATA. The static PAGE_META pages are still added internally.
function buildSearchIndex(suppliers = [], topDebtors = []) {
  const items = [];
  Object.keys(PAGE_META).forEach(id => items.push({ kind: 'صفحة', label: PAGE_META[id].crumb, icon: PAGE_META[id].icon, page: id }));
  (suppliers || []).forEach(s => items.push({ kind: 'مورد', label: s.name, icon: 'truck', page: 'suppliers' }));
  // top_debtors is ACCOUNT-LEVEL (no contract number — mapInstallments drops it),
  // so reference the account id instead. If even that is absent, omit `meta`
  // entirely rather than render the literal "حساب undefined".
  (topDebtors || []).forEach(d => items.push({ kind: 'مدين', label: d.name, icon: 'users', page: 'installments', meta: d.accountId != null ? `حساب ${d.accountId}` : undefined }));
  return items;
}

function GlobalSearch({ onNavigate, searchIndex = [] }) {
  const [q, setQ] = useStateS('');
  const [open, setOpen] = useStateS(false);
  const [active, setActive] = useStateS(0);
  const inputRef = useRefS(null);
  const wrapRef = useRefS(null);

  const results = q.trim()
    ? searchIndex.filter(it => it.label.includes(q.trim())).slice(0, 7)
    : [];

  useEffectS(() => {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); inputRef.current?.focus(); }
      if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
    };
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick); };
  }, []);

  const pick = (it) => { if (!it) return; onNavigate(it.page); setQ(''); setOpen(false); inputRef.current?.blur(); };

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: 300 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--slate-50)', border: `1px solid ${open ? 'var(--primary-600)' : 'var(--slate-200)'}`,
        borderRadius: 10, padding: '7px 12px', transition: 'border-color 150ms', boxShadow: open ? '0 0 0 3px rgba(37,99,235,0.10)' : 'none' }}>
        <Icon name="search" className="w-4 h-4" style={{ color: 'var(--slate-400)' }} />
        <input ref={inputRef} value={q} placeholder="بحث في النظام…"
          onChange={e => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
            if (e.key === 'Enter') pick(results[active]);
          }}
          style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontFamily: 'inherit', fontSize: 13, color: 'var(--slate-800)' }} />
        {!q && <kbd style={{ fontSize: 11, color: 'var(--slate-400)', background: '#fff', border: '1px solid var(--slate-200)', borderRadius: 5, padding: '1px 6px', fontFamily: 'inherit' }}>/</kbd>}
      </div>
      {open && q.trim() && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', insetInlineStart: 0, width: '100%', background: '#fff',
          border: '1px solid var(--slate-200)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', zIndex: 60 }}>
          {results.length === 0 ? (
            <div style={{ padding: '16px', fontSize: 13, color: 'var(--slate-500)', textAlign: 'center' }}>لا توجد نتائج</div>
          ) : results.map((it, i) => (
            <button key={i} onMouseEnter={() => setActive(i)} onClick={() => pick(it)}
              style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '10px 14px', border: 'none',
                background: i === active ? 'var(--slate-50)' : '#fff', cursor: 'pointer', textAlign: 'right', fontFamily: 'inherit' }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--slate-100)', color: 'var(--slate-500)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name={it.icon} className="w-4 h-4" /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, color: 'var(--slate-800)', fontWeight: 600 }}>{it.label}</span>
                {it.meta && <span className="num" style={{ fontSize: 11.5, color: 'var(--slate-400)', marginInlineStart: 6 }}>{it.meta}</span>}
              </span>
              <Badge tone="gray">{it.kind}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationsBell({ onNavigate, alerts = [] }) {
  const [open, setOpen] = useStateS(false);
  const wrapRef = useRefS(null);
  useEffectS(() => {
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);
  const toneColor = (t) => ({ danger: 'var(--danger-600)', warning: 'var(--warning-600)', info: 'var(--primary-600)' }[t] || 'var(--slate-500)');
  const toneIcon = (t) => ({ danger: 'alert', warning: 'warn', info: 'info' }[t] || 'info');
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="التنبيهات" aria-label="التنبيهات"
        style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--slate-200)', background: open ? 'var(--slate-100)' : '#fff',
          cursor: 'pointer', color: 'var(--slate-600)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <Icon name="bell" className="w-5 h-5" />
        {alerts.length > 0 && <span className="num" style={{ position: 'absolute', top: -5, insetInlineEnd: -5, minWidth: 17, height: 17, padding: '0 4px',
          borderRadius: 999, background: 'var(--danger-600)', color: '#fff', fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>{alerts.length}</span>}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 10px)', insetInlineEnd: 0, width: 340, background: '#fff',
          border: '1px solid var(--slate-200)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', zIndex: 60 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--slate-100)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'Tajawal', fontWeight: 700, fontSize: 14, color: 'var(--slate-900)' }}>التنبيهات</span>
            <Badge tone="red">{alerts.length} نشطة</Badge>
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {alerts.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 11, padding: '12px 16px', borderBottom: i < alerts.length - 1 ? '1px solid var(--slate-100)' : 'none' }}>
                <span style={{ color: toneColor(a.tone), flex: 'none', marginTop: 1 }}><Icon name={toneIcon(a.tone)} className="w-5 h-5" /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--slate-800)', lineHeight: 1.4 }}>{a.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 2, lineHeight: 1.5 }}>{a.body}</div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => { setOpen(false); onNavigate('forecast'); }}
            style={{ width: '100%', padding: '11px', border: 'none', borderTop: '1px solid var(--slate-100)', background: '#fff',
              color: 'var(--primary-700)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            عرض السيناريوهات والتفاصيل
          </button>
        </div>
      )}
    </div>
  );
}

function Header({ page, onNavigate, exchangeRate = 0, alerts = [], searchIndex = [] }) {
  const meta = PAGE_META[page] || PAGE_META.dashboard;
  return (
    <header style={{ height: 60, background: '#fff', borderBottom: '1px solid var(--slate-200)',
      display: 'flex', alignItems: 'center', padding: '0 24px', gap: 14, position: 'sticky', top: 0, zIndex: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--slate-500)' }}>
        <span>البيت السعيد</span>
        <Icon name="chevleft" className="w-3 h-3" style={{ color: 'var(--slate-300)' }} />
        <span style={{ color: 'var(--slate-900)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name={meta.icon} className="w-4 h-4" style={{ color: 'var(--slate-500)' }} />
          {meta.crumb}
        </span>
      </div>
      <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        <GlobalSearch onNavigate={onNavigate} searchIndex={searchIndex} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--slate-500)', background: 'var(--slate-50)', border: '1px solid var(--slate-200)', borderRadius: 999, padding: '6px 12px' }}>
          <Icon name="dollar" className="w-4 h-4" style={{ color: 'var(--slate-400)' }} />
          <span className="num" style={{ fontWeight: 700, color: 'var(--slate-700)' }}>{exchangeRate.toLocaleString('en-US')}</span> د.ع/$
        </span>
        <NotificationsBell onNavigate={onNavigate} alerts={alerts} />
        <button onClick={() => onNavigate('settings')} title="الإعدادات" aria-label="الإعدادات"
          style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--slate-200)', background: page === 'settings' ? 'var(--slate-100)' : '#fff',
            cursor: 'pointer', color: page === 'settings' ? 'var(--primary-700)' : 'var(--slate-600)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cog" className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}

function PageHeader({ title, subtitle, actions }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontFamily: 'Tajawal', fontSize: 26, fontWeight: 700, color: 'var(--slate-900)', margin: 0, letterSpacing: '-0.01em', lineHeight: 1.2 }}>{title}</h1>
        {subtitle && <div style={{ fontSize: 13.5, color: 'var(--slate-500)', marginTop: 7, lineHeight: 1.6, maxWidth: 720 }}>{subtitle}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flex: 'none' }}>{actions}</div>}
    </div>
  );
}

// ---- AppShell — top-level RTL layout (NEW; not in the design reference) ----
// A full-viewport flex row. In the RTL document the FIRST DOM child renders
// rightmost, so the Sidebar (placed first) lands on the RIGHT — its borderLeft
// then borders the content column to its left, matching screenshots/dashboard.png.
// The main column holds the sticky Header on top and a scrollable, padded
// content area below that renders the active page (children).
function AppShell({ active, onNavigate, exchangeRate, alerts, searchIndex, onLogout, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', minHeight: '100vh', background: 'var(--slate-50)' }}>
      <Sidebar active={active} onNavigate={onNavigate} onLogout={onLogout} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Header page={active} onNavigate={onNavigate} exchangeRate={exchangeRate} alerts={alerts} searchIndex={searchIndex} />
        <div style={{ flex: 1, minWidth: 0, padding: 24 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export {
  NAV,
  PAGE_META,
  PAGE_LABEL,
  Sidebar,
  GlobalSearch,
  NotificationsBell,
  buildSearchIndex,
  Header,
  PageHeader,
  AppShell,
};
