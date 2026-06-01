/* =========================================================================
   البيت السعيد — نموذج بيانات تحليل السيولة النقدية
   كل المبالغ داخلياً بوحدة "مليون دينار" (M). الأرقام مبنية على الفرضيات
   والإجماليات الواردة في CLAUDE.md (نافذة 2022-05 → 2026-04 + تنبؤ 12 شهر).
   ========================================================================= */
(function () {
  'use strict';

  const USD_RATE = 1350;          // متوسط سعر الصرف (د.ع/$) آخر 12 شهر
  const START_CASH = 60;          // رصيد الصناديق الافتتاحي (مايو 2022) بالمليون
  const RESERVE_M = 15;           // احتياطي مصاريف الشركاء غير المخططة / شهر

  // ----- السنوات المالية (تبدأ مايو) -----------------------------------
  // IN / net مُصمّمة لتعكس: تراجع الصافي 51% بين 2024 و2026،
  // ونمو المصروفات بنحو 2.4× وتيرة المقبوضات.
  const FY = [
    { key: 'FY22', label: '2022 / 2023', IN: 1150, net: 165 },
    { key: 'FY23', label: '2023 / 2024', IN: 1215, net: 120 },
    { key: 'FY24', label: '2024 / 2025', IN: 1330, net: 63  },
    { key: 'FY25', label: '2025 / 2026', IN: 1278, net: 31  },
  ];
  FY.forEach(f => { f.OUT = f.IN - f.net; });

  // ----- فئات المصروفات الست -------------------------------------------
  const EXP_CATS = [
    { key: 'partners',  name: 'سحوبات شركاء',     type: '2518', chart: '--chart-5', note: 'أحمد كوان · فؤاد كريم · علي كوان' },
    { key: 'sayrafa',   name: 'صيرفة (دينار→دولار)', type: '7',    chart: '--chart-3', note: 'تصفيات دورية لتمويل الموردين الدولاريين' },
    { key: 'suppliers', name: 'مدفوعات الموردين',  type: '2614', chart: '--chart-1', note: 'المجهزون — الـ14 موزّع وغيرهم' },
    { key: 'purchases', name: 'مشتريات مباشرة',    type: '3110', chart: '--chart-6', note: 'شراء بضاعة نقداً' },
    { key: 'salaries',  name: 'أجور العاملين',     type: '3121', chart: '--chart-4', note: 'رواتب وأجور الفريق' },
    { key: 'refunds',   name: 'مرتجعات وأخرى',     type: '1631', chart: '--chart-7', note: 'مرتجعات للزبائن ومصاريف متفرقة' },
  ];

  // نِسَب الفئات من إجمالي المصروفات لكل سنة (حصة الشركاء ترتفع تدريجياً)
  const CAT_RATIOS = {
    FY22: { partners: 0.240, sayrafa: 0.300, suppliers: 0.315, purchases: 0.065, salaries: 0.050, refunds: 0.030 },
    FY23: { partners: 0.260, sayrafa: 0.305, suppliers: 0.300, purchases: 0.060, salaries: 0.045, refunds: 0.030 },
    FY24: { partners: 0.285, sayrafa: 0.310, suppliers: 0.275, purchases: 0.057, salaries: 0.043, refunds: 0.030 },
    FY25: { partners: 0.300, sayrafa: 0.310, suppliers: 0.260, purchases: 0.055, salaries: 0.045, refunds: 0.030 },
  };

  // ----- توابع موسمية (موضع الشهر المالي: مايو=0 ... أبريل=11) ----------
  const FM_NAMES = ['أيار','حزيران','تموز','آب','أيلول','تشرين الأول','تشرين الثاني','كانون الأول','كانون الثاني','شباط','آذار','نيسان'];
  const GREG_OF_FM = [5,6,7,8,9,10,11,12,1,2,3,4]; // الشهر الميلادي لكل موضع
  const inSeason   = [1.05,1.00,0.95,1.18,1.22,1.05,1.00,1.12,0.96,0.82,0.85,0.90];
  const buySeason  = [1.10,1.20,1.22,1.10,0.95,0.92,0.95,1.05,1.00,0.92,0.85,0.74]; // موردون/مشتريات
  const smoothSeas = [1.00,1.03,1.02,0.98,0.97,1.00,1.05,1.06,1.02,1.04,0.95,0.88]; // شركاء/مرتجعات
  const sayrafaWt  = [0.10,0.10,1.55,0.12,0.12,1.50,0.10,0.10,1.55,0.10,0.10,1.56]; // صيرفة ربعية متكتلة
  const flatWt     = Array(12).fill(1);

  function norm(arr) { const s = arr.reduce((a,b)=>a+b,0); return arr.map(x => x*12/s); }

  const W = {
    in:        norm(inSeason),
    partners:  norm(smoothSeas),
    sayrafa:   norm(sayrafaWt),
    suppliers: norm(buySeason),
    purchases: norm(buySeason),
    salaries:  norm(flatWt),
    refunds:   norm(smoothSeas),
  };

  // مولّد ضجيج محدّد (deterministic) لإكساب الأشهر تفاوتاً واقعياً
  function jitter(i, amp) { return 1 + amp * Math.sin(i * 1.7 + 0.6) * Math.cos(i * 0.7 + 1.3); }

  // ----- بناء السلاسل الشهرية التاريخية (48 شهر) -----------------------
  const months = []; // كل عنصر: { idx, fy, fmPos, greg, year, label, short, in, out, net, cats:{}, forecast:false }
  let gIdx = 0;
  for (let f = 0; f < FY.length; f++) {
    const fy = FY[f];
    const ratios = CAT_RATIOS[fy.key];
    // إجماليات الفئات السنوية
    const catAnnual = {};
    EXP_CATS.forEach(c => { catAnnual[c.key] = fy.OUT * ratios[c.key]; });

    for (let p = 0; p < 12; p++) {
      const greg = GREG_OF_FM[p];
      const year = 2022 + f + (p >= 8 ? 1 : 0); // ماي, ... تتجاوز السنة عند كانون الثاني (p=8)
      const cats = {};
      EXP_CATS.forEach(c => {
        cats[c.key] = catAnnual[c.key] * (W[c.key][p] / 12) * jitter(gIdx + c.key.length, c.key === 'salaries' ? 0.02 : 0.06);
      });
      const inAmt = fy.IN * (W.in[p] / 12) * jitter(gIdx, 0.07);
      months.push({
        idx: gIdx, fy: fy.key, fyLabel: fy.label, fmPos: p, greg, year,
        label: `${FM_NAMES[p]} ${year}`,
        short: `${String(greg).padStart(2,'0')}/${String(year).slice(2)}`,
        in: inAmt, cats, forecast: false,
      });
      gIdx++;
    }
    // إعادة التحجيم لمطابقة الإجماليات السنوية بدقة
    const fyMonths = months.filter(m => m.fy === fy.key);
    const inSum = fyMonths.reduce((a,m)=>a+m.in,0);
    fyMonths.forEach(m => { m.in *= fy.IN / inSum; });
    EXP_CATS.forEach(c => {
      const cs = fyMonths.reduce((a,m)=>a+m.cats[c.key],0);
      fyMonths.forEach(m => { m.cats[c.key] *= catAnnual[c.key] / cs; });
    });
  }

  // out + net لكل شهر
  months.forEach(m => {
    m.out = EXP_CATS.reduce((a,c)=>a+m.cats[c.key],0);
    m.net = m.in - m.out;
  });

  // ----- فرض أول صافي سالب: شباط 2026 = -14.6M -------------------------
  // (سحب شريك كبير في شباط؛ نقابله بخفض السحوبات في نيسان لإبقاء الإجمالي السنوي)
  const feb = months.find(m => m.year === 2026 && m.greg === 2); // idx 45
  const apr = months.find(m => m.year === 2026 && m.greg === 4); // idx 47
  if (feb && apr) {
    const target = -14.6;
    const delta = (feb.net - target); // المقدار المطلوب رفعه على المصروفات في شباط
    feb.cats.partners += delta;
    feb.out += delta; feb.net = feb.in - feb.out;
    apr.cats.partners -= delta;
    apr.out -= delta; apr.net = apr.in - apr.out;
  }

  // ----- رصيد الصناديق التراكمي ----------------------------------------
  let run = START_CASH;
  months.forEach(m => { run += m.net; m.cash = run; });
  const CURRENT_CASH = months[months.length - 1].cash;

  // ======================================================================
  //  التنبؤ — 12 شهر (مايو 2026 → نيسان 2027)
  //  نمط موسمي من متوسط آخر سنتين × نمو، ناقص احتياطي 15M/شهر.
  // ======================================================================
  const SCENARIOS = {
    base:  { label: 'متحفّظ',  inG: 1.00, outG: 1.00, chart: '--chart-1' },
    opt:   { label: 'متفائل',  inG: 1.08, outG: 0.98, chart: '--chart-2' },
    pess:  { label: 'متشائم',  inG: 0.92, outG: 1.06, chart: '--chart-5' },
  };

  // متوسط موسمي لكل موضع شهر مالي من آخر سنتين (FY24, FY25)
  function seasonalAvg(getter) {
    const out = [];
    for (let p = 0; p < 12; p++) {
      const a = months.find(m => m.fy === 'FY24' && m.fmPos === p);
      const b = months.find(m => m.fy === 'FY25' && m.fmPos === p);
      out.push((getter(a) + getter(b)) / 2);
    }
    return out;
  }
  const inSeasF  = seasonalAvg(m => m.in);
  const outSeasF = seasonalAvg(m => m.out);
  const catSeasF = {};
  EXP_CATS.forEach(c => { catSeasF[c.key] = seasonalAvg(m => m.cats[c.key]); });

  const IN_GROWTH = 1.015;  // نمو مقبوضات معتدل
  const OUT_GROWTH = 1.045; // المصروفات تنمو أسرع

  const forecast = []; // { idx, fmPos, greg, year, label, short, base:{in,out,net}, opt:{}, pess:{}, cats(base) }
  for (let p = 0; p < 12; p++) {
    const greg = GREG_OF_FM[p];
    const year = 2026 + (p >= 8 ? 1 : 0);
    const baseIn  = inSeasF[p]  * IN_GROWTH;
    const baseOut = outSeasF[p] * OUT_GROWTH;
    const cats = {};
    EXP_CATS.forEach(c => { cats[c.key] = catSeasF[c.key][p] * OUT_GROWTH; });
    const mk = (s) => {
      const i = baseIn * s.inG, o = baseOut * s.outG;
      return { in: i, out: o, net: i - o };
    };
    forecast.push({
      idx: 48 + p, fmPos: p, greg, year, forecast: true,
      label: `${FM_NAMES[p]} ${year}`, short: `${String(greg).padStart(2,'0')}/${String(year).slice(2)}`,
      base: mk(SCENARIOS.base), opt: mk(SCENARIOS.opt), pess: mk(SCENARIOS.pess),
      cats,
    });
  }

  // مسارات رصيد الصناديق المتوقعة لكل سيناريو (مع خصم الاحتياطي)
  const cashPaths = { base: [], opt: [], pess: [] };
  ['base','opt','pess'].forEach(s => {
    let c = CURRENT_CASH;
    forecast.forEach(fm => { c += fm[s].net - RESERVE_M; cashPaths[s].push(c); });
  });

  const fcTotals = {};
  ['base','opt','pess'].forEach(s => {
    fcTotals[s] = {
      in:  forecast.reduce((a,m)=>a+m[s].in,0),
      out: forecast.reduce((a,m)=>a+m[s].out,0),
      net: forecast.reduce((a,m)=>a+m[s].net,0),
      endCash: cashPaths[s][11],
      minCash: Math.min(...cashPaths[s]),
    };
  });

  // ======================================================================
  //  الموردون الـ14
  // ======================================================================
  const SUPPLIERS = [
    { id: 1001, name: 'معرض البركة',           cap: 5,  cur: 'IQD' },
    { id: 2079, name: 'هيثم',                    cap: 3,  cur: 'IQD' },
    { id: 2093, name: 'وميض',                    cap: 0,  cur: 'IQD' },
    { id: 2432, name: 'حميد الشطباوي',           cap: 15, cur: 'IQD' },
    { id: 2440, name: 'معرض الهادي',             cap: 3,  cur: 'IQD' },
    { id: 2700, name: 'معرض أولاد شفيق',         cap: 3,  cur: 'IQD' },
    { id: 3123, name: 'العطاوي للمفروشات',       cap: 2,  cur: 'IQD' },
    { id: 3916, name: 'شركة أصل القمة',          cap: 3,  cur: 'IQD' },
    { id: 5721, name: 'قاسم بايسكلات',           cap: 4,  cur: 'IQD' },
    { id: 2439, name: 'معرض الواحة — سامراء',    cap: 0,  cur: 'MIX' },
    { id: 4937, name: 'شركة الحافظ',             cap: 40, cur: 'USD' },
    { id: 6444, name: 'كهربائيات المهندس',       cap: 15, cur: 'USD' },
    { id: 6552, name: 'د. يوسف — ميديا فوكس',    cap: 5,  cur: 'USD' },
    { id: 6918, name: 'شركة الريان — بغداد',     cap: 7,  cur: 'USD' },
  ];
  // متوسط الدفعة الشهرية لكل مورد (مليون) — مُعايَر قرب السقوف الصغيرة لإبراز التجاوزات
  const SUP_MEAN = [2.8, 2.2, 0.3, 2.4, 2.2, 2.0, 1.8, 2.1, 2.6, 0.7, 3.2, 2.0, 2.7, 2.0];
  // الحصة التاريخية في توزيع المجمّع التنبؤي (ورقة 12)
  const SUP_SHARE = [0.06, 0.04, 0.005, 0.16, 0.05, 0.05, 0.03, 0.04, 0.05, 0.02, 0.26, 0.11, 0.045, 0.06];
  const frac = (x) => x - Math.floor(x);
  const noise = (a) => frac(Math.sin(a * 12.9898) * 43758.5453);
  const last12 = months.slice(-12);
  SUPPLIERS.forEach((s, i) => {
    s.mean = SUP_MEAN[i];
    s.monthly = last12.map((m, k) => s.mean * (0.55 + 0.95 * noise(s.id * 0.13 + k * 1.7)));
    s.total12 = s.monthly.reduce((a, b) => a + b, 0);
    s.avg = s.total12 / 12;
    s.balance = s.total12 * (s.cur === 'USD' ? 1.7 : 1.05) * (0.85 + 0.3 * noise(s.id));
    s.overCap = s.cap > 0 ? s.monthly.filter(v => v > s.cap).length : 0;
    s.util = s.cap > 0 ? s.avg / s.cap : null;
  });

  // ======================================================================
  //  توزيع موردين تنبؤي (ورقة 12)
  //  Pool = Forecast_IN − salaries − purchases − refunds − other − 15M
  //  يوزَّع على الـ14 وفق الحصة، مع تطبيق السقف وإعادة توزيع الفائض.
  // ======================================================================
  function allocate(monthFc, reserveM = RESERVE_M, g = 1, capsOverride = null) {
    const capOf = (s) => capsOverride && capsOverride[s.id] != null ? capsOverride[s.id] : s.cap;
    const inV = monthFc.base.in * g;
    const pool = Math.max(0,
      inV - monthFc.cats.salaries - monthFc.cats.purchases - monthFc.cats.refunds
          - monthFc.cats.partners - monthFc.cats.sayrafa - reserveM);
    // توزيع المجمّع كاملاً على الـ14 وفق الحصة النسبية (CLAUDE — ورقة 12)
    let alloc = SUPPLIERS.map((s, i) => ({ id: s.id, name: s.name, cap: capOf(s), cur: s.cur, want: 0 }));
    const shareSum = SUP_SHARE.reduce((a,b)=>a+b,0);
    alloc.forEach((a,i)=> a.want = pool * (SUP_SHARE[i]/shareSum));
    // تطبيق السقف وحساب الفائض
    let overflow = 0;
    alloc.forEach(a => {
      if (a.cap > 0 && a.want > a.cap) { overflow += a.want - a.cap; a.give = a.cap; a.capped = true; }
      else { a.give = a.want; a.capped = false; }
    });
    // إعادة توزيع الفائض على غير المكتمِلين (بحد السقف)
    let guard = 0;
    while (overflow > 0.01 && guard < 6) {
      const open = alloc.filter(a => !a.capped && (a.cap === 0 || a.give < a.cap));
      if (!open.length) break;
      const room = open.reduce((acc,a)=> acc + (a.cap > 0 ? a.cap - a.give : Infinity), 0);
      if (!isFinite(room)) { open.forEach(a => a.give += overflow/open.length); overflow = 0; break; }
      const add = overflow;
      open.forEach(a => {
        const r = a.cap - a.give;
        const portion = (r / room) * add;
        const real = Math.min(portion, r);
        a.give += real; overflow -= real;
        if (a.give >= a.cap - 0.001) a.capped = true;
      });
      guard++;
    }
    const distributed = alloc.reduce((acc,a)=>acc+a.give,0);
    return { pool, alloc, leftover: Math.max(0, pool - distributed), distributed };
  }
  const supplierForecast = forecast.map(fm => ({ month: fm, ...allocate(fm) }));

  // ======================================================================
  //  الأقساط المفتوحة — 4.67 مليار د.ع
  // ======================================================================
  const INSTALLMENTS_TOTAL = 4670; // مليون = 4.67 مليار
  const AGING = [
    { key: 'current', label: 'لم يستحق بعد',  amount: 2850, color: '--bucket-0-30',    count: 3120 },
    { key: 'b0_30',   label: '1 – 30 يوم',     amount: 720,  color: '--bucket-31-60',   count: 980 },
    { key: 'b31_60',  label: '31 – 60 يوم',    amount: 430,  color: '--bucket-61-90',   count: 540 },
    { key: 'b61_90',  label: '61 – 90 يوم',    amount: 290,  color: '--bucket-91-120',  count: 360 },
    { key: 'b91_120', label: '91 – 120 يوم',   amount: 180,  color: '#EA580C',          count: 210 },
    { key: 'b120',    label: '+120 يوم',       amount: 200,  color: '--bucket-120-plus',count: 240 },
  ];
  const TOP_DEBTORS = [
    { name: 'مصطفى عبد الله',   contract: '18427', balance: 41.2, bucket: '+120 يوم',  due: 'متعثّر' },
    { name: 'علي حسين كاظم',    contract: '20913', balance: 33.8, bucket: '91 – 120',  due: 'متأخر' },
    { name: 'حسن محمود جاسم',   contract: '17655', balance: 28.5, bucket: '61 – 90',   due: 'متأخر' },
    { name: 'ليث عدنان',        contract: '21044', balance: 24.1, bucket: '31 – 60',   due: 'متابعة' },
    { name: 'عمر فاروق',        contract: '19872', balance: 22.7, bucket: '1 – 30',    due: 'جاري' },
    { name: 'سيف الدين ناجي',   contract: '20567', balance: 19.9, bucket: 'لم يستحق',  due: 'جاري' },
  ];

  // ======================================================================
  //  الصناديق السبعة — لقطة الأرصدة الحالية (المجموع = الرصيد الحالي)
  // ======================================================================
  const FUNDS = [
    { id: 181,  name: 'صندوق المعتصم (الرئيسي)', share: 0.446 },
    { id: 180,  name: 'نقد في الخزينة',           share: 0.200 },
    { id: 4935, name: 'صندوق الضلوعية',           share: 0.123 },
    { id: 6662, name: 'صندوق محمد شهاب — ضلوعية', share: 0.071 },
    { id: 6672, name: 'صندوق محمد كوان',          share: 0.086 },
    { id: 6684, name: 'صندوق عمر حردان',          share: 0.046 },
    { id: 6314, name: 'صندوق نقل مخزني',          share: 0.028 },
  ];
  FUNDS.forEach(f => { f.balance = CURRENT_CASH * f.share; });

  // ======================================================================
  //  الشركاء (سحوبات شخصية)
  // ======================================================================
  const partnersLast12 = months.slice(-12).reduce((a,m)=>a+m.cats.partners,0);
  const PARTNERS = [
    { name: 'أحمد كوان',  share: 0.42 },
    { name: 'فؤاد كريم', share: 0.34 },
    { name: 'علي كوان',  share: 0.24 },
  ];
  PARTNERS.forEach(p => { p.total12 = partnersLast12 * p.share; });

  // ======================================================================
  //  مؤشرات تنفيذية (آخر سنة مالية كاملة FY25) + مقارنات
  // ======================================================================
  function fyAgg(key) {
    const ms = months.filter(m => m.fy === key);
    return {
      in: ms.reduce((a,m)=>a+m.in,0),
      out: ms.reduce((a,m)=>a+m.out,0),
      net: ms.reduce((a,m)=>a+m.net,0),
    };
  }
  const agg = { FY22: fyAgg('FY22'), FY23: fyAgg('FY23'), FY24: fyAgg('FY24'), FY25: fyAgg('FY25') };
  const netDecline = (agg.FY24.net - agg.FY25.net) / agg.FY24.net; // ≈ 0.51
  const inGrowth = (agg.FY25.in - agg.FY22.in) / agg.FY22.in;
  const outGrowth = (agg.FY25.out - agg.FY22.out) / agg.FY22.out;
  const expenseVelocity = outGrowth / inGrowth; // ≈ 2.4×

  // ----- المنبّهات (Alerts) --------------------------------------------
  const ALERTS = [
    { tone: 'danger',  title: 'أول صافي شهري سالب خلال 4 سنوات',
      body: `شباط 2026 سجّل صافياً سالباً ${(-14.6).toFixed(1)} مليون د.ع — مدفوعاً بسحب شريك كبير.` },
    { tone: 'warning', title: 'تراجع الصافي السنوي 51%',
      body: `صافي السيولة هبط من ${Math.round(agg.FY24.net)} م إلى ${Math.round(agg.FY25.net)} م بين 2024 و2026.` },
    { tone: 'warning', title: 'المصروفات تنمو أسرع من المقبوضات',
      body: `نمت المصروفات بنحو ${expenseVelocity.toFixed(1)}× وتيرة نمو المقبوضات خلال الفترة.` },
    { tone: 'info',    title: '44% من المصروفات التشغيلية سحوبات شركاء',
      body: 'بعد استبعاد الصيرفة، تمثّل سحوبات الشركاء أكبر بند خروج نقدي — وليست مصاريف تشغيلية.' },
  ];

  // ======================================================================
  //  Formatters
  // ======================================================================
  const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
  // مبلغ بالمليون → نص مناسب (مليار عند ≥ 1000)
  function fmtM(n, opts = {}) {
    const abs = Math.abs(n);
    if (abs >= 1000) return (n / 1000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (opts.dec1 || abs < 10) return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return Math.round(n).toLocaleString('en-US');
  }
  const unitM = (n) => Math.abs(n) >= 1000 ? 'مليار د.ع' : 'مليون د.ع';
  // المبلغ الكامل بالدينار (للـ tooltips الدقيقة)
  const fmtFull = (n) => Math.round(n * 1e6).toLocaleString('en-US') + ' د.ع';
  const fmtUSD = (m, rate) => '$' + Math.round(m * 1e6 / (rate || USD_RATE)).toLocaleString('en-US');
  const fmtPct = (n, dec = 0) => (n * 100).toFixed(dec) + '%';

  // ======================================================================
  window.DATA = {
    USD_RATE, START_CASH, RESERVE_M, CURRENT_CASH,
    FY, EXP_CATS, FM_NAMES,
    months, forecast, cashPaths, fcTotals, SCENARIOS,
    SUPPLIERS, SUP_SHARE, supplierForecast, allocate, last12,
    INSTALLMENTS_TOTAL, AGING, TOP_DEBTORS,
    FUNDS, PARTNERS,
    agg, netDecline, inGrowth, outGrowth, expenseVelocity,
    ALERTS,
    fmt: { fmtInt, fmtM, unitM, fmtFull, fmtUSD, fmtPct },
  };
})();
