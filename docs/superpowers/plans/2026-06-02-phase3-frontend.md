# الخطة 3 — واجهة React/Vite — خطة تنفيذ

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** إعادة بناء نموذج التصميم المُسلَّم (`design-reference/`) كتطبيق **Vite + React** إنتاجي مع الحفاظ على المخرَج البصري (pixel-parity)، واستبدال بيانات `data.js` الوهمية بطبقة `api-client` تجلب من خلفية الخطة 2، وإضافة شاشة دخول، ولوحة "تعديل سريع" داخلية حقيقية، وشارة MAPE/الثقة.

**Architecture:** Vite + React (JS) + react-router. نظام التصميم يُنقل كما هو من `colors_and_type.css`. المكوّنات تُنقل من `design-reference/project/src/*.jsx` إلى `src/components` و`src/pages` مع تحويل مصدر البيانات من `window.DATA` إلى hooks تستدعي `api-client`. حالة المصادقة عبر سياق React + كوكي الجلسة.

**Tech Stack:** Vite، React 18، react-router، fetch/axios، ECharts أو إبقاء رسوم SVG المنقولة من `Charts.jsx`، Vitest + React Testing Library، MSW (محاكاة API في الاختبارات).

**المرجع الملزم:** `design-reference/project/src/` (نظام التصميم، Shell، Primitives، Charts، الصفحات الثماني، data.js كعقد بيانات)، ولقطات `design-reference/project/screenshots/` كمرجع بصري. المواصفة §7.

**تعتمد على:** الخطة 2 (نقاط API جاهزة بعقد `data.js`).

**هذه الخطة 3 من 5.**

---

## بنية الملفات (Plan 3)

```
cashflow-web/frontend/
├── package.json  vite.config.js  index.html
├── src/
│   ├── main.jsx                      # نقطة الدخول + Router + AuthProvider
│   ├── App.jsx                       # جذر التطبيق (الحارس + Shell + المسارات)
│   ├── styles/colors_and_type.css    # منقول حرفياً من design-reference
│   ├── api/client.js                 # طبقة fetch موحّدة (كوكي، أخطاء)
│   ├── api/hooks.js                   # useDashboard/useCashflow/useSuppliers... (تستبدل data.js)
│   ├── auth/AuthContext.jsx  auth/Login.jsx
│   ├── components/                    # منقولة من design-reference (Shell/Primitives/Charts/Tweaks)
│   │   ├── Shell.jsx  Primitives.jsx (يضم ToastHost)  Charts.jsx  TweaksPanel.jsx
│   ├── pages/                         # الصفحات الثماني
│   │   ├── Dashboard.jsx  MonthlyFlow.jsx  Breakdown.jsx  Suppliers.jsx
│   │   ├── Installments.jsx  Forecast.jsx  SupplierPlan.jsx  Settings.jsx
│   └── lib/format.js                  # fmt (منقول من data.js)
└── tests/                            # Vitest + RTL + MSW handlers
```

> **حدود الوحدات:** `api/client.js` المكان الوحيد لاستدعاء fetch. المكوّنات لا تستورد بيانات وهمية. كل صفحة ملف مستقل. نظام التصميم يبقى ملفاً واحداً منقولاً دون تعديل.

---

## Chunk A: السقالة + نظام التصميم + التشغيل

### Task A1: تهيئة Vite + نقل نظام التصميم + RTL

**Files:**
- Create: `frontend/package.json`, `vite.config.js`, `index.html`, `src/main.jsx`, `src/styles/colors_and_type.css`
- Test: `frontend/tests/smoke.test.jsx`

- [ ] **Step 1: اختبار دخان فاشل (يتأكد أن التطبيق يُركّب وأن RTL مفعّل)**

```jsx
// tests/smoke.test.jsx
import { render, screen } from "@testing-library/react";
import App from "../src/App";
test("app mounts and document dir is rtl", () => {
  render(<App />);
  expect(document.documentElement.dir).toBe("rtl");
});
```

- [ ] **Step 2: تشغيل للفشل** — Run: `cd cashflow-web/frontend && npm test -- smoke` → FAIL.

- [ ] **Step 3: تهيئة المشروع**: `npm create vite@latest` (React)، نسخ `colors_and_type.css` حرفياً من `design-reference/project/src/` إلى `src/styles/`، استيراده في `main.jsx`، ضبط `index.html` بـ `<html dir="rtl" lang="ar">`، وإنشاء `App.jsx` بسيط مبدئياً.

- [ ] **Step 4: تشغيل للنجاح** → PASS. وتأكيد بصري: `npm run dev` يفتح صفحة بخطوط Cairo/Tajawal واتجاه RTL.

- [ ] **Step 5: Commit**

```bash
git add cashflow-web/frontend
git commit -m "feat(web): scaffold Vite+React + ported design tokens (RTL)"
```

---

## Chunk B: طبقة API + المصادقة + التوجيه

### Task B1: api-client + معالجة الأخطاء والكوكي

**Files:**
- Create: `src/api/client.js`
- Test: `tests/api-client.test.js` (مع MSW)

- [ ] **Step 1: اختبار فاشل**

```js
// tests/api-client.test.js
import { api } from "../src/api/client";
// MSW: GET /api/meta → 200 {usd_rate:1350}; GET /api/secret → 401
test("get parses json and sends credentials", async () => {
  const meta = await api.get("/api/meta");
  expect(meta.usd_rate).toBe(1350);
});
test("401 throws AuthError", async () => {
  await expect(api.get("/api/secret")).rejects.toMatchObject({ status: 401 });
});
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `client.js`** (`fetch` مع `credentials:"include"`، يحلّل JSON، يحوّل 4xx/5xx لاستثناء يحمل `status` و`error`؛ 401 → `AuthError`).

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/client.js tests/api-client.test.js
git commit -m "feat(web): api client with cookie creds + error handling"
```

### Task B2: AuthContext + شاشة الدخول + حماية المسارات

**Files:**
- Create: `src/auth/AuthContext.jsx`, `src/auth/Login.jsx`, `src/main.jsx` (Router)
- Test: `tests/auth.test.jsx`

- [ ] **Step 1: اختبار فاشل (غير مُصادَق → شاشة دخول)**

```jsx
// tests/auth.test.jsx — MSW: /api/auth/me → 401 ثم بعد login → 200
test("shows login when unauthenticated", async () => {
  render(<App />);
  expect(await screen.findByText(/تسجيل الدخول/)).toBeInTheDocument();
});
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `AuthContext`** (يستدعي `/api/auth/me` عند الإقلاع؛ يوفّر `login/logout/user`)، `Login.jsx` (نموذج مستخدم/كلمة مرور بنظام التصميم)، و`main.jsx` يلفّ الشيل بحارس: إن لا مستخدم → `Login`.

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth src/main.jsx tests/auth.test.jsx
git commit -m "feat(web): auth context + login screen + route guard"
```

---

## Chunk C: نقل المكوّنات المشتركة (Shell/Primitives/Charts)

### Task C1: نقل Primitives + Charts (بصرياً كما هي)

**Files:**
- Create: `src/components/Primitives.jsx`, `src/components/Charts.jsx`, `src/lib/format.js`
- Test: `tests/components.test.jsx`

- [ ] **Step 1: اختبار فاشل (مكوّنات أساسية تُعرض)**

```jsx
// tests/components.test.jsx
import { Badge, Button } from "../src/components/Primitives";
test("badge renders tone", () => {
  render(<Badge tone="red">3 نشطة</Badge>);
  expect(screen.getByText("3 نشطة")).toBeInTheDocument();
});
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: نقل `Primitives.jsx` و`Charts.jsx`** من `design-reference/project/src/` مع تحويل `Object.assign(window,...)` إلى `export`؛ نقل `fmt` إلى `src/lib/format.js`؛ الحفاظ على نفس الأنماط (الأبعاد، الألوان، الأيقونات بالبكسل كما أُصلحت في المحادثة المرجعية).

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Primitives.jsx src/components/Charts.jsx src/lib/format.js tests/components.test.jsx
git commit -m "feat(web): port Primitives + Charts + formatters"
```

### Task C2: نقل Shell (Sidebar + Header + بحث + تنبيهات)

**Files:**
- Create: `src/components/Shell.jsx`
- Test: `tests/shell.test.jsx`

- [ ] **Step 1: اختبار فاشل (القائمة الثمانية + الشريط العلوي)**

```jsx
// tests/shell.test.jsx
test("sidebar lists all 8 nav items", () => {
  render(<Sidebar active="dashboard" onNavigate={()=>{}} />);
  ["اللوحة التنفيذية","التدفق الشهري","المقبوضات والمصروفات","الموردون الـ14",
   "الأقساط المفتوحة","التنبؤ والسيناريوهات","توزيع موردين تنبؤي","الإعدادات"]
   .forEach(t => expect(screen.getByText(t)).toBeInTheDocument());
});
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: نقل `Shell.jsx`** (Sidebar يمين، Header، GlobalSearch، NotificationsBell، PageHeader) مع تغذية البحث/التنبيهات من API بدل `window.DATA` (تُمرَّر props أو hooks).

- [ ] **Step 4: تشغيل للنجاح** → PASS. وتأكيد بصري مقابل لقطة `dashboard.png`.

- [ ] **Step 5: Commit**

```bash
git add src/components/Shell.jsx tests/shell.test.jsx
git commit -m "feat(web): port Shell (RTL sidebar + header + search + alerts)"
```

---

## Chunk D: hooks البيانات + الصفحات الثماني

### Task D1: api/hooks تستبدل data.js

**Files:**
- Create: `src/api/hooks.js`
- Test: `tests/hooks.test.jsx` (MSW)

- [ ] **Step 1: اختبار فاشل**

```jsx
// tests/hooks.test.jsx — MSW: /api/dashboard → عيّنة
test("useDashboard returns mapped data", async () => {
  const { result } = renderHook(() => useDashboard());
  await waitFor(() => expect(result.current.data.fy_totals).toBeDefined());
});
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: تنفيذ `hooks.js`** (`useDashboard/useCashflow/useSuppliers/useInstallments/useForecast/useSupplierPlan/useSettings/useMeta` — كلها تجلب من `api.get` وتعيد `{data, loading, error}`؛ تحترم السيناريو/المنظور النشط). **مهم — طبقة التطابق:** الـ hooks تحوّل مفاتيح الـ API الـ snake_case (الخطة 2) إلى أسماء المكوّنات (camelCase/المتداخلة: `s.cur`/`s.overCap`/`pool`/`m.in`…)، وكذلك حقول الإعدادات (`neg_threshold_m`↔`negThreshold`، `usd_rate`↔`exchangeRate`…). **مساعد اختبار مشترك:** يُعرَّف `renderWithProviders` + خادم MSW في `tests/setup.js` ويُستخدم في كل اختبارات الصفحات/الإعدادات.

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/hooks.js tests/hooks.test.jsx
git commit -m "feat(web): data hooks replacing mock data.js"
```

### Task D2: نقل لوحة المعلومات + التدفق الشهري + المقبوضات/المصروفات

**Files:**
- Create: `src/pages/{Dashboard,MonthlyFlow,Breakdown}.jsx`
- Test: `tests/pages-core.test.jsx`

- [ ] **Step 1: اختبار فاشل (اللوحة تعرض المؤشرات والتنبيه من API)**

```jsx
// tests/pages-core.test.jsx — MSW يزوّد /api/dashboard
test("dashboard shows KPI cards and alert banner", async () => {
  renderWithProviders(<Dashboard onNavigate={()=>{}} />);
  expect(await screen.findByText(/مقبوضات السنة/)).toBeInTheDocument();
  expect(await screen.findByText(/تنبيه سيولة/)).toBeInTheDocument();
});
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: نقل الصفحات الثلاث** من `design-reference` مع استبدال `window.DATA` بـ hooks؛ الحفاظ على التخطيط البصري (بطاقات KPI، شريط الإنذار، الرسوم) مقابل اللقطات. (يضبط إعداد الاختبار `showAlert:true` افتراضياً حتى يظهر شريط الإنذار في `test_dashboard`.)

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Dashboard.jsx src/pages/MonthlyFlow.jsx src/pages/Breakdown.jsx tests/pages-core.test.jsx
git commit -m "feat(web): dashboard + monthly + breakdown pages on live API"
```

### Task D3: نقل الموردون + الأقساط + التنبؤ (مع شارة MAPE) + توزيع موردين

**Files:**
- Create: `src/pages/{Suppliers,Installments,Forecast,SupplierPlan}.jsx`
- Test: `tests/pages-suppliers.test.jsx`

- [ ] **Step 1: اختبار فاشل (شارة MAPE + استبعاد الدولاريين من التوزيع)**

```jsx
test("forecast page shows MAPE confidence badge", async () => {
  renderWithProviders(<Forecast />);   // MSW: /api/forecast → {mape:18, confidence:"عالية"}
  expect(await screen.findByText(/عالية/)).toBeInTheDocument();
});
test("supplier-plan shows dollar suppliers funded via siyrafa, not in pool", async () => {
  renderWithProviders(<SupplierPlan />);  // MSW: alloc الدولاريون allocated_m=0
  // يظهر وسم/ملاحظة أن الدولاريين يُموَّلون عبر الصيرفة
  expect(await screen.findByText(/عبر الصيرفة/)).toBeInTheDocument();
});
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: نقل الصفحات الأربع**؛ في `Forecast.jsx` أضف **شارة MAPE/الثقة** (§7.5)؛ في `SupplierPlan.jsx` اعرض الموردين الدولاريين كمموَّلين عبر الصيرفة (لا حصة من المجمّع) — تجسيد الخيار 1. **ملاحظة:** منطق `allocate`/لوحة الخصومات في `SupplierPlan.jsx` يُكيَّف (لا يُنسخ حرفياً) لأن دلالات البيانات تغيّرت عمداً هنا؛ فمطابقة لقطة `supplierplan.png` لا تنطبق على هذا الجزء تحديداً.

- [ ] **Step 4: تشغيل للنجاح** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Suppliers.jsx src/pages/Installments.jsx src/pages/Forecast.jsx src/pages/SupplierPlan.jsx tests/pages-suppliers.test.jsx
git commit -m "feat(web): suppliers/installments/forecast(MAPE)/supplier-plan pages"
```

---

## Chunk E: الإعدادات (حفظ عبر API) + التعديل السريع + Toasts

### Task E1: صفحة الإعدادات + لوحة "تعديل سريع" داخلية + Toast

**Files:**
- Create: `src/pages/Settings.jsx`, `src/components/TweaksPanel.jsx`
- Test: `tests/settings.test.jsx`

- [ ] **Step 1: اختبار فاشل (الحفظ يستدعي PUT والانتشار يحدث)**

```jsx
// tests/settings.test.jsx — MSW يلتقط PUT /api/settings
test("saving settings calls PUT and shows toast", async () => {
  renderWithProviders(<Settings />);
  fireEvent.click(await screen.findByText(/حفظ الإعدادات/));
  expect(await screen.findByText(/تم حفظ الإعدادات/)).toBeInTheDocument();  // toast
});
```

- [ ] **Step 2: تشغيل للفشل** → FAIL.

- [ ] **Step 3: نقل `Settings.jsx`** (يستخدم عناصر النماذج `Toggle/NumberField/Slider/SettingRow` المنقولة من Primitives في C1) مع القراءة/الكتابة عبر `/api/settings` و`/api/suppliers/{id}/caps`؛ **إعادة بناء `TweaksPanel`** كلوحة داخلية متاحة دائماً بزرّ فتح/إغلاق (لا أداة سقالة postMessage — §7.5)؛ التنبيهات (Toasts) عبر `showToast` من **سياق React** (مصدره `ToastHost` المنقول ضمن Primitives في C1، بدل `window.showToast`).

- [ ] **Step 4: تشغيل للنجاح** → PASS. وتأكيد بصري مقابل `settings.png`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Settings.jsx src/components/TweaksPanel.jsx src/components/Toast.jsx tests/settings.test.jsx
git commit -m "feat(web): settings page (API-backed) + in-app tweaks panel + toasts"
```

---

## نهاية الخطة 3

**المخرَج:** تطبيق ويب React يطابق نموذج التصميم بصرياً، يعمل على بيانات حيّة من الخلفية، بشاشة دخول وثماني صفحات وإعدادات محفوظة وتعديل سريع داخلي وشارة MAPE. اختبارات مكوّنات/صفحات عبر Vitest + MSW.

**التالي:** الخطة 4 — التكامل والنشر (docker-compose الكامل، نسخ احتياطي/استعادة، e2e، تحقّق يدوي).
