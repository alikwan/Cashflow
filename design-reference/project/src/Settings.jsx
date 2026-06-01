// البيت السعيد — الإعدادات
/* global React, Icon, Card, SectionHeader, Badge, Button, PageHeader, SettingRow, Toggle, NumberField, Slider, cssVar */
const { useState: useStateSet, useEffect: useEffectSet } = React;

const ACCENT_OPTS = [
  { id: 'أزرق', color: '#2563EB' },
  { id: 'كحلي', color: '#4F46E5' },
  { id: 'أخضر', color: '#0D9488' },
];

function Settings({ settings, onChange, onReset }) {
  const D = window.DATA, F = D.fmt;
  // مسوّدة محلية — لا تُطبَّق حتى الحفظ
  const [draft, setDraft] = useStateSet(settings);
  useEffectSet(() => { setDraft(settings); }, [settings]);
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const setCap = (id, v) => setDraft(d => ({ ...d, caps: { ...d.caps, [id]: v } }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const save = () => { onChange(draft); window.showToast('تم حفظ الإعدادات'); };
  const reset = () => { const def = onReset(); setDraft(def); window.showToast('تمت إعادة التعيين إلى الافتراضي', 'info'); };

  return (
    <div style={{ padding: '24px 28px 96px', maxWidth: 920 }}>
      <PageHeader title="الإعدادات" subtitle="ضبط افتراضات النظام والتنبيهات وسقوف الموردين. تُطبَّق التغييرات على كل الشاشات بعد الحفظ، وتُحفظ محلياً." />

      {/* المظهر */}
      <Card style={{ marginBottom: 20 }}>
        <SectionHeader title="المظهر" subtitle="ألوان الواجهة وعناصر العرض" icon="palette" />
        <SettingRow label="لون التمييز" hint="يُطبَّق على الأزرار والروابط والرسوم الأساسية.">
          <div style={{ display: 'flex', gap: 8 }}>
            {ACCENT_OPTS.map(a => (
              <button key={a.id} onClick={() => set('accent', a.id)} title={a.id}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                  border: `1.5px solid ${draft.accent === a.id ? a.color : 'var(--slate-200)'}`, background: draft.accent === a.id ? cssVar('--slate-50') : '#fff', color: 'var(--slate-700)' }}>
                <span style={{ width: 15, height: 15, borderRadius: 5, background: a.color, boxShadow: draft.accent === a.id ? `0 0 0 3px ${a.color}33` : 'none' }} />
                {a.id}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow label="شريط الإنذار في اللوحة" hint="إظهار شريط تنبيه السيولة البارز أعلى اللوحة التنفيذية." last>
          <Toggle checked={draft.showAlert} onChange={v => set('showAlert', v)} />
        </SettingRow>
      </Card>

      {/* السنة المالية وسعر الصرف */}
      <Card style={{ marginBottom: 20 }}>
        <SectionHeader title="السنة المالية والعملة" subtitle="إعدادات الفترة وسعر صرف الدولار" icon="calendar" />
        <SettingRow label="بداية السنة المالية" hint="الشهر الذي تبدأ منه السنة المالية للمعرض.">
          <select value={draft.fyStart} onChange={e => set('fyStart', parseInt(e.target.value))}
            style={{ padding: '8px 12px', border: '1px solid var(--slate-300)', borderRadius: 8, fontFamily: 'inherit', fontSize: 13.5, color: 'var(--slate-800)', background: '#fff', cursor: 'pointer', minWidth: 140 }}>
            {['كانون الثاني','شباط','آذار','نيسان','أيار','حزيران','تموز','آب','أيلول','تشرين الأول','تشرين الثاني','كانون الأول'].map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="سعر صرف الدولار" hint="يُستخدم لتحويل أرصدة الموردين الدولاريين وعرضها في الشريط العلوي." last>
          <NumberField value={draft.exchangeRate} min={1000} max={2000} step={5} suffix="د.ع/$" width={120} onChange={v => set('exchangeRate', v)} />
        </SettingRow>
      </Card>

      {/* افتراضات التنبؤ */}
      <Card style={{ marginBottom: 20 }}>
        <SectionHeader title="افتراضات التنبؤ" subtitle="تتحكم في صفحتَي التنبؤ وتوزيع الموردين" icon="forecast" />
        <SettingRow label="احتياطي المفاجآت الشهري" hint="مبلغ يُحجز شهرياً قبل توزيع السيولة على الموردين، تحسّباً لمصاريف الشركاء غير المخططة.">
          <Slider value={draft.reserve} min={0} max={40} step={1} unit=" م" onChange={v => set('reserve', v)} />
        </SettingRow>
        <SettingRow label="نمو المقبوضات المتوقع" hint="تعديل عام على المقبوضات المتوقعة في كل السيناريوهات." last>
          <Slider value={draft.incomeGrowth} min={-15} max={15} step={1} unit="٪" onChange={v => set('incomeGrowth', v)} />
        </SettingRow>
      </Card>

      {/* التنبيهات */}
      <Card style={{ marginBottom: 20 }}>
        <SectionHeader title="عتبات التنبيه" subtitle="متى يُعتبر الشهر أو الدفعة بحاجة انتباه" icon="shield" />
        <SettingRow label="عتبة الصافي الشهري" hint="تُميَّز الأشهر التي ينخفض صافيها عن هذه القيمة بلون تحذيري في الجداول.">
          <NumberField value={draft.negThreshold} min={-50} max={50} step={1} suffix="مليون" width={110} onChange={v => set('negThreshold', v)} />
        </SettingRow>
        <SettingRow label="تنبيه تجاوز سقف الموردين" hint="إبراز الأشهر التي تتجاوز فيها دفعة المورد سقفه المرجعي." last>
          <Toggle checked={draft.overCapWarn} onChange={v => set('overCapWarn', v)} />
        </SettingRow>
      </Card>

      {/* سقوف الموردين */}
      <Card style={{ marginBottom: 20 }} padding={0}>
        <div style={{ padding: '20px 20px 4px' }}>
          <SectionHeader title="سقوف الموردين الـ14" subtitle="الحد الأعلى المرجعي للدفعة الشهرية لكل مورد (بالمليون · 0 = بلا سقف)" icon="truck" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px', padding: '0 20px 20px' }}>
          {D.SUPPLIERS.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 0',
              borderBottom: '1px solid var(--slate-100)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, color: 'var(--slate-800)', fontWeight: 600 }}>{s.name}</span>
                {s.cur === 'USD' && <Badge tone="amber">دولار</Badge>}
                {s.cur === 'MIX' && <Badge tone="purple">مختلط</Badge>}
              </div>
              <NumberField value={draft.caps[s.id]} min={0} max={100} step={1} suffix="م" width={84} onChange={v => setCap(s.id, v)} />
            </div>
          ))}
        </div>
      </Card>

      {/* البيانات */}
      <Card style={{ marginBottom: 20 }}>
        <SectionHeader title="البيانات والتصدير" subtitle="مصدر البيانات وتصدير التقارير" icon="doc" />
        <SettingRow label="آخر تحديث للبيانات" hint="تُحدَّث الحركات تلقائياً من نظام المعرض.">
          <span className="num" style={{ fontSize: 13.5, color: 'var(--slate-700)', fontWeight: 600 }}>13 أيار 2026 · 09:40</span>
        </SettingRow>
        <SettingRow label="تصدير كامل البيانات" hint="تنزيل كل الجداول والتدفقات بصيغة جدول بيانات." last>
          <Button variant="secondary" size="sm" icon="download" onClick={() => window.showToast('تم تجهيز ملف التصدير')}>تصدير الكل</Button>
        </SettingRow>
      </Card>

      {/* شريط الحفظ الثابت */}
      <div style={{ position: 'fixed', bottom: 0, insetInlineStart: 256, insetInlineEnd: 0, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(6px)',
        borderTop: '1px solid var(--slate-200)', padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 25 }}>
        <span style={{ fontSize: 13, color: dirty ? 'var(--warning-700)' : 'var(--slate-500)', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <Icon name={dirty ? 'warn' : 'check'} className="w-4 h-4" />
          {dirty ? 'لديك تغييرات غير محفوظة' : 'كل التغييرات محفوظة'}
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="ghost" size="md" icon="reset" onClick={reset}>إعادة التعيين</Button>
          <Button variant="primary" size="md" icon="check" onClick={save} disabled={!dirty}>حفظ الإعدادات</Button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Settings });
