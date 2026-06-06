// البيت السعيد — لوحة التعديل السريع (TweaksPanel · Task E1)
//
// An always-available, in-app floating panel for LIVE quick tweaks. This is a
// from-scratch rebuild — NOT a port of design-reference/project/src/tweaks-panel.jsx
// (that file is the Claude Design postMessage scaffold tool, irrelevant here).
//
// Behavior: a fixed FAB (bottom-start corner, "sliders" icon) toggles a small
// on-brand card. The card edits LIVE app state via `onChange(patch)` — applied
// immediately, NO persistence (the Settings page is the persistent editor; a
// note in the panel says so). Four tweaks mirror the design intent:
//   - accent color (the 3 ACCENT_OPTS)
//   - show alert (Toggle)
//   - reserve (Slider 0..40)
//   - income growth (Slider -15..15)
//
// Mounted once at the App root (inside the ToastProvider/AppShell area) so it is
// reachable on every page.
import React, { useState } from "react";
import { Icon, Toggle, Slider } from "./Primitives";
import { ACCENT_OPTS } from "../pages/Settings";

export function TweaksPanel({ settings, onChange }) {
  const [open, setOpen] = useState(false);

  // Until the App has composed its settings, render only the FAB (no panel
  // contents to edit). The button stays available so the affordance is stable.
  const s = settings || {};
  const patch = (p) => onChange && onChange(p);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 22,
        insetInlineEnd: 22,
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 12,
      }}
    >
      {open && settings && (
        <div
          role="dialog"
          aria-label="تعديل سريع"
          style={{
            width: 300,
            background: "#fff",
            border: "1px solid var(--slate-200)",
            borderRadius: 16,
            boxShadow: "0 16px 40px rgba(15,23,42,0.18)",
            padding: 18,
            animation: "tweaksIn 200ms cubic-bezier(0.4,0,0.2,1)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "Tajawal",
                fontWeight: 700,
                fontSize: 15,
                color: "var(--slate-900)",
              }}
            >
              <Icon name="sliders" className="w-4 h-4" />
              تعديل سريع
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="إغلاق"
              aria-label="إغلاق"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: "var(--slate-500)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>

          {/* accent color */}
          <div style={{ padding: "12px 0 4px", borderBottom: "1px solid var(--slate-100)" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--slate-700)", marginBottom: 8 }}>
              لون التمييز
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {ACCENT_OPTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => patch({ accent: a.id })}
                  title={a.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 600,
                    border: `1.5px solid ${s.accent === a.id ? a.color : "var(--slate-200)"}`,
                    background: s.accent === a.id ? "var(--slate-50)" : "#fff",
                    color: "var(--slate-700)",
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 4,
                      background: a.color,
                    }}
                  />
                  {a.id}
                </button>
              ))}
            </div>
          </div>

          {/* show alert */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px 0",
              borderBottom: "1px solid var(--slate-100)",
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--slate-700)" }}>
              شريط الإنذار
            </span>
            <Toggle checked={!!s.showAlert} onChange={(v) => patch({ showAlert: v })} />
          </div>

          {/* reserve */}
          <div style={{ padding: "12px 0", borderBottom: "1px solid var(--slate-100)" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--slate-700)", marginBottom: 8 }}>
              احتياطي المفاجآت
            </div>
            <Slider
              value={s.reserve ?? 0}
              min={0}
              max={40}
              step={1}
              unit=" م"
              onChange={(v) => patch({ reserve: v })}
            />
          </div>

          {/* income growth */}
          <div style={{ padding: "12px 0 4px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--slate-700)", marginBottom: 8 }}>
              نمو المقبوضات
            </div>
            <Slider
              value={s.incomeGrowth ?? 0}
              min={-15}
              max={15}
              step={1}
              unit="٪"
              onChange={(v) => patch({ incomeGrowth: v })}
            />
          </div>

          <div
            style={{
              fontSize: 11,
              color: "var(--slate-400)",
              lineHeight: 1.5,
              marginTop: 8,
            }}
          >
            تعديلات سريعة مؤقتة تُطبَّق فوراً. للحفظ الدائم استخدم صفحة الإعدادات.
          </div>
          <style>{`@keyframes tweaksIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }`}</style>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="تعديل سريع"
        aria-label="تعديل سريع"
        aria-expanded={open}
        style={{
          width: 48,
          height: 48,
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
          background: "var(--primary-600)",
          color: "#fff",
          boxShadow: "0 10px 28px rgba(37,99,235,0.35)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <Icon name={open ? "close" : "sliders"} className="w-5 h-5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

export default TweaksPanel;
