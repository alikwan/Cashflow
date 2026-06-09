// البيت السعيد — الإعدادات (Task E1)
//
// Ported from design-reference/project/src/Settings.jsx. The controlled-draft +
// dirty-tracking + fixed bottom save-bar UX and every pixel are preserved. The
// mechanical/data changes for the React port:
//   1. React UMD globals → ES imports; `Object.assign(window,{Settings})` →
//      `export function Settings`.
//   2. `window.DATA` reads (SUPPLIERS, fmt) → the D1 hooks (useSettings,
//      useMeta, useSuppliers) composed INTERNALLY so <Settings/> works both
//      standalone (the given E1 test) AND App-wired.
//   3. `window.showToast` → the React-context `useToast()`.
//   4. The save button now persists to the API: `PUT /api/settings` (nested
//      display + assumptions, reverse-mapped per docs 05/06 §9) PLUS one
//      `POST /api/suppliers/{id}/caps` per CHANGED cap. Accent is accepted by
//      the API (`display.accent`) so it is included in the PUT.
//   5. "آخر تحديث للبيانات" now sources from useMeta().lastEtl.finishedAt.
//
// Self-containment: Settings always loads its own data via the hooks and does
// the writes itself; the App passes an optional `onSaved` callback so it can
// refresh app-level settings after a successful save.
import React, { useState, useEffect, useMemo } from "react";
import {
  Icon,
  Card,
  SectionHeader,
  Badge,
  Button,
  Toggle,
  NumberField,
  Slider,
  SettingRow,
  useToast,
} from "../components/Primitives";
import { cssVar } from "../components/Charts";
import { PageHeader } from "../components/Shell";
import { PageState } from "./PageState";
import { useSettings, useMeta, useSuppliers } from "../api/hooks";
import { api } from "../api/client";

// The three accent options (Arabic id + hex). Matches the design reference.
export const ACCENT_OPTS = [
  { id: "أزرق", color: "#2563EB" },
  { id: "كحلي", color: "#4F46E5" },
  { id: "أخضر", color: "#0D9488" },
];

// §9 nullable-assumption fallbacks (data.js defaults).
const FALLBACK = { reserve: 15, usd: 1350, fyStart: 5, incomeGrowth: 0 };

// Arabic month names (gregorian index 1..12) for the fiscal-year-start select.
const AR_MONTHS = [
  "كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران",
  "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول",
];

// Build the effective (page-facing) settings object from the loaded hooks,
// applying the §9 fallbacks for nullable assumptions (against meta where it has
// a live value, else the static default) and seeding caps from the suppliers.
function buildEffective(settingsData, metaData, suppliersData) {
  const s = settingsData || {};
  const m = metaData || {};
  const caps = {};
  for (const sup of suppliersData?.suppliers ?? []) {
    caps[sup.id] = sup.cap ?? 0;
  }
  return {
    accent: s.accent ?? ACCENT_OPTS[0].id,
    showAlert: s.showAlert ?? true,
    negThreshold: s.negThreshold ?? 0,
    overCapWarn: s.overCapWarn ?? true,
    // assumptions: settings value → meta value → static default.
    exchangeRate: s.exchangeRate ?? m.USD_RATE ?? FALLBACK.usd,
    reserve: s.reserve ?? m.RESERVE_M ?? FALLBACK.reserve,
    fyStart: s.fyStart ?? m.fyStart ?? FALLBACK.fyStart,
    incomeGrowth: s.incomeGrowth ?? FALLBACK.incomeGrowth,
    caps,
  };
}

// Format an ISO timestamp readably ("YYYY-MM-DD · HH:MM"), or "—" when null.
function fmtEtl(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` · ${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// Today's date as "YYYY-MM-DD" (local — Asia/Baghdad on the host is fine for the
// cap `effective_from`).
function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function Settings({ onSaved }) {
  const { showToast } = useToast();

  // Compose the page's own data (so <Settings/> works standalone).
  const settings = useSettings();
  const meta = useMeta();
  const suppliers = useSuppliers();

  const loading = settings.loading || meta.loading || suppliers.loading;
  const error = settings.error || meta.error || suppliers.error;
  const ready =
    !loading && !error && settings.data && meta.data && suppliers.data;

  // The loaded effective settings (the "saved" baseline the draft diffs against).
  const effective = useMemo(
    () =>
      ready
        ? buildEffective(settings.data, meta.data, suppliers.data)
        : null,
    [ready, settings.data, meta.data, suppliers.data]
  );

  // Local draft — not applied until Save.
  const [draft, setDraft] = useState(effective);
  // When the loaded baseline arrives/changes, (re)seed the draft.
  useEffect(() => {
    if (effective) setDraft(effective);
  }, [effective]);

  const [saving, setSaving] = useState(false);

  if (!ready || !draft) {
    return (
      <div style={{ padding: "24px 28px 96px" }}>
        <PageState
          loading={loading}
          error={error}
          onRetry={() => {
            settings.refetch();
            meta.refetch();
            suppliers.refetch();
          }}
        />
      </div>
    );
  }

  const supplierList = suppliers.data.suppliers || [];
  const lastEtl = meta.data.lastEtl;

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setCap = (id, v) =>
    setDraft((d) => ({ ...d, caps: { ...d.caps, [id]: v } }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(effective);

  // Persist: PUT /api/settings (display + assumptions) + one cap POST per
  // changed supplier cap. Awaits all writes; toasts on success/failure.
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // Reverse-map the draft → API names (doc 05 §14, doc 06 §9).
      const body = {
        display: {
          accent: draft.accent,
          show_alert: draft.showAlert,
          neg_threshold_m: draft.negThreshold,
          over_cap_warn: draft.overCapWarn,
        },
        assumptions: {
          usd_rate: draft.exchangeRate,
          unexpected_reserve_m: draft.reserve,
          fiscal_year_start_month: draft.fyStart,
          income_growth_pct: draft.incomeGrowth,
        },
      };
      await api.put("/api/settings", body);

      // Only POST caps that actually changed.
      const changedCaps = Object.keys(draft.caps).filter(
        (id) => draft.caps[id] !== effective.caps[id]
      );
      const effectiveFrom = todayStr();
      await Promise.all(
        changedCaps.map((id) =>
          api.post(`/api/suppliers/${id}/caps`, {
            monthly_cap_m: draft.caps[id],
            effective_from: effectiveFrom,
          })
        )
      );

      // Advance the page's OWN baseline so `effective` (and thus `dirty`) reflects
      // the now-persisted values: refetch the composed hooks. The refetched GETs
      // return the saved settings/caps, so `effective` re-derives to match the
      // draft and `dirty` goes false (save bar → "كل التغييرات محفوظة", Save
      // disables). Without this, the page stays "dirty" after a successful save.
      settings.refetch();
      suppliers.refetch();
      meta.refetch();

      showToast("تم حفظ الإعدادات");
      if (onSaved) onSaved(draft);
    } catch (e) {
      showToast("تعذّر حفظ الإعدادات", "danger");
    } finally {
      setSaving(false);
    }
  };

  // Reset is local — restore the draft to the loaded baseline.
  const reset = () => {
    setDraft(effective);
    showToast("تمت إعادة التعيين إلى الافتراضي", "info");
  };

  return (
    <div style={{ padding: "24px 28px 96px", maxWidth: 920 }}>
      <PageHeader
        title="الإعدادات"
        subtitle="ضبط افتراضات النظام والتنبيهات وسقوف الموردين. تُطبَّق التغييرات على كل الشاشات بعد الحفظ."
      />

      {/* المظهر */}
      <Card style={{ marginBottom: 20 }}>
        <SectionHeader title="المظهر" subtitle="ألوان الواجهة وعناصر العرض" icon="palette" />
        <SettingRow label="لون التمييز" hint="يُطبَّق على الأزرار والروابط والرسوم الأساسية.">
          <div style={{ display: "flex", gap: 8 }}>
            {ACCENT_OPTS.map((a) => (
              <button
                key={a.id}
                onClick={() => set("accent", a.id)}
                title={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "7px 13px",
                  borderRadius: 9,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: 600,
                  border: `1.5px solid ${draft.accent === a.id ? a.color : "var(--slate-200)"}`,
                  background: draft.accent === a.id ? cssVar("--slate-50") : "#fff",
                  color: "var(--slate-700)",
                }}
              >
                <span
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: 5,
                    background: a.color,
                    boxShadow: draft.accent === a.id ? `0 0 0 3px ${a.color}33` : "none",
                  }}
                />
                {a.id}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow
          label="شريط الإنذار في اللوحة"
          hint="إظهار شريط تنبيه السيولة البارز أعلى اللوحة التنفيذية."
          last
        >
          <Toggle checked={draft.showAlert} onChange={(v) => set("showAlert", v)} />
        </SettingRow>
      </Card>

      {/* السنة المالية وسعر الصرف */}
      <Card style={{ marginBottom: 20 }}>
        <SectionHeader
          title="السنة المالية والعملة"
          subtitle="إعدادات الفترة وسعر صرف الدولار"
          icon="calendar"
        />
        <SettingRow
          label="بداية السنة المالية"
          hint="الشهر الذي تبدأ منه السنة المالية للمعرض."
        >
          <select
            value={draft.fyStart}
            onChange={(e) => set("fyStart", parseInt(e.target.value, 10))}
            style={{
              padding: "8px 12px",
              border: "1px solid var(--slate-300)",
              borderRadius: 8,
              fontFamily: "inherit",
              fontSize: 13.5,
              color: "var(--slate-800)",
              background: "#fff",
              cursor: "pointer",
              minWidth: 140,
            }}
          >
            {AR_MONTHS.map((m, i) => (
              <option key={i} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow
          label="سعر صرف الدولار"
          hint="يُستخدم لتحويل أرصدة الموردين الدولاريين وعرضها في الشريط العلوي."
          last
        >
          <NumberField
            value={draft.exchangeRate}
            min={1000}
            max={2000}
            step={5}
            suffix="د.ع/$"
            width={120}
            onChange={(v) => set("exchangeRate", v)}
          />
        </SettingRow>
      </Card>

      {/* افتراضات التنبؤ */}
      <Card style={{ marginBottom: 20 }}>
        <SectionHeader
          title="افتراضات التنبؤ"
          subtitle="تتحكم في صفحتَي التنبؤ وتوزيع الموردين"
          icon="forecast"
        />
        <SettingRow
          label="احتياطي المفاجآت الشهري"
          hint="مبلغ يُحجز شهرياً قبل توزيع السيولة على الموردين، تحسّباً لمصاريف الشركاء غير المخططة."
        >
          <Slider
            value={draft.reserve}
            min={0}
            max={40}
            step={1}
            unit=" م"
            onChange={(v) => set("reserve", v)}
          />
        </SettingRow>
        <SettingRow
          label="نمو المقبوضات المتوقع"
          hint="تعديل عام على المقبوضات المتوقعة في كل السيناريوهات."
          last
        >
          <Slider
            value={draft.incomeGrowth}
            min={-15}
            max={15}
            step={1}
            unit="٪"
            onChange={(v) => set("incomeGrowth", v)}
          />
        </SettingRow>
      </Card>

      {/* التنبيهات */}
      <Card style={{ marginBottom: 20 }}>
        <SectionHeader
          title="عتبات التنبيه"
          subtitle="متى يُعتبر الشهر أو الدفعة بحاجة انتباه"
          icon="shield"
        />
        <SettingRow
          label="عتبة الصافي الشهري"
          hint="تُميَّز الأشهر التي ينخفض صافيها عن هذه القيمة بلون تحذيري في الجداول."
        >
          <NumberField
            value={draft.negThreshold}
            min={-50}
            max={50}
            step={1}
            suffix="مليون"
            width={110}
            onChange={(v) => set("negThreshold", v)}
          />
        </SettingRow>
        <SettingRow
          label="تنبيه تجاوز سقف الموردين"
          hint="إبراز الأشهر التي تتجاوز فيها دفعة المورد سقفه المرجعي."
          last
        >
          <Toggle checked={draft.overCapWarn} onChange={(v) => set("overCapWarn", v)} />
        </SettingRow>
      </Card>

      {/* سقوف الموردين */}
      <Card style={{ marginBottom: 20 }} padding={0}>
        <div style={{ padding: "20px 20px 4px" }}>
          <SectionHeader
            title="سقوف الموردين"
            subtitle="الحد الأعلى المرجعي للدفعة الشهرية لكل مورد (بالمليون · 0 = بلا سقف)"
            icon="truck"
          />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0 32px",
            padding: "0 20px 20px",
          }}
        >
          {supplierList.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "11px 0",
                borderBottom: "1px solid var(--slate-100)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  minWidth: 0,
                }}
              >
                <span
                  style={{ fontSize: 13.5, color: "var(--slate-800)", fontWeight: 600 }}
                >
                  {s.name}
                </span>
                {s.cur === "USD" && <Badge tone="amber">دولار</Badge>}
                {s.cur === "MIX" && <Badge tone="purple">مختلط</Badge>}
              </div>
              <NumberField
                value={draft.caps[s.id] ?? 0}
                min={0}
                max={100}
                step={1}
                suffix="م"
                width={84}
                onChange={(v) => setCap(s.id, v)}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* البيانات */}
      <Card style={{ marginBottom: 20 }}>
        <SectionHeader
          title="البيانات والتصدير"
          subtitle="مصدر البيانات وتصدير التقارير"
          icon="doc"
        />
        <SettingRow
          label="آخر تحديث للبيانات"
          hint="تُحدَّث الحركات تلقائياً من نظام المعرض."
        >
          <span
            className="num"
            style={{ fontSize: 13.5, color: "var(--slate-700)", fontWeight: 600 }}
          >
            {fmtEtl(lastEtl?.finishedAt)}
          </span>
        </SettingRow>
        <SettingRow
          label="تصدير كامل البيانات"
          hint="تنزيل كل الجداول والتدفقات بصيغة جدول بيانات."
          last
        >
          <Button
            variant="secondary"
            size="sm"
            icon="download"
            onClick={() => showToast("تم تجهيز ملف التصدير")}
          >
            تصدير الكل
          </Button>
        </SettingRow>
      </Card>

      {/* شريط الحفظ الثابت */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          insetInlineStart: 256,
          insetInlineEnd: 0,
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(6px)",
          borderTop: "1px solid var(--slate-200)",
          padding: "14px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 25,
        }}
      >
        <span
          style={{
            fontSize: 13,
            color: dirty ? "var(--warning-700)" : "var(--slate-500)",
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <Icon name={dirty ? "warn" : "check"} className="w-4 h-4" />
          {dirty ? "لديك تغييرات غير محفوظة" : "كل التغييرات محفوظة"}
        </span>
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="ghost" size="md" icon="reset" onClick={reset}>
            إعادة التعيين
          </Button>
          <Button
            variant="primary"
            size="md"
            icon="check"
            onClick={save}
            disabled={!dirty || saving}
          >
            حفظ الإعدادات
          </Button>
        </div>
      </div>
    </div>
  );
}

export default Settings;
