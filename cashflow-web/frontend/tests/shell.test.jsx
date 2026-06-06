// Task C2 — unit tests for the ported Shell (Sidebar + Header + GlobalSearch +
// NotificationsBell + PageHeader) and the NEW AppShell layout composition.
//
// The pixel-parity port of design-reference/project/src/Shell.jsx into
// src/components/Shell.jsx. The one behavioral change: search index and alerts
// now flow in via props (the source read window.DATA) — these tests pin that
// contract. AppShell is genuinely new layout code (the design reference did not
// ship the sidebar+header+content composition) so it gets a smoke test.
import { render, screen, fireEvent } from "@testing-library/react";
import {
  Sidebar,
  Header,
  GlobalSearch,
  NotificationsBell,
  AppShell,
} from "../src/components/Shell";

// ---- Sidebar: 8 nav items (verbatim from the plan) --------------------
test("sidebar lists all 8 nav items", () => {
  render(<Sidebar active="dashboard" onNavigate={() => {}} />);
  [
    "اللوحة التنفيذية",
    "التدفق الشهري",
    "المقبوضات والمصروفات",
    "الموردون الـ14",
    "الأقساط المفتوحة",
    "التنبؤ والسيناريوهات",
    "توزيع موردين تنبؤي",
    "الإعدادات",
  ].forEach((t) => expect(screen.getByText(t)).toBeInTheDocument());
});

// ---- Sidebar / NavButton: clicking navigates --------------------------
test("clicking a nav item calls onNavigate with its id", () => {
  const onNavigate = vi.fn();
  render(<Sidebar active="dashboard" onNavigate={onNavigate} />);
  fireEvent.click(screen.getByText("الموردون الـ14"));
  expect(onNavigate).toHaveBeenCalledWith("suppliers");
});

// ---- Header: breadcrumb + exchange rate -------------------------------
test("header renders the breadcrumb for the active page and the exchange rate", () => {
  render(
    <Header
      page="suppliers"
      onNavigate={() => {}}
      exchangeRate={1350}
      alerts={[]}
      searchIndex={[]}
    />
  );
  // Breadcrumb crumb for suppliers.
  expect(screen.getByText("الموردون الـ14")).toBeInTheDocument();
  // Exchange-rate pill, formatted with the en-US grouping separator.
  expect(screen.getByText("1,350")).toBeInTheDocument();
});

// ---- NotificationsBell: count badge + dropdown ------------------------
test("notifications bell shows the alert count and reveals titles when opened", () => {
  render(
    <NotificationsBell
      onNavigate={() => {}}
      alerts={[{ tone: "danger", title: "تنبيه سيولة", body: "تفاصيل" }]}
    />
  );
  // Count badge.
  expect(screen.getByText("1")).toBeInTheDocument();
  // Title hidden until the bell is opened.
  expect(screen.queryByText("تنبيه سيولة")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "التنبيهات" }));
  expect(screen.getByText("تنبيه سيولة")).toBeInTheDocument();
});

// ---- GlobalSearch: filters the props index + picks ---------------------
test("global search filters the supplied index and picks an item", () => {
  const onNavigate = vi.fn();
  const searchIndex = [
    { kind: "مورد", label: "معرض البركة", icon: "truck", page: "suppliers" },
    { kind: "مورد", label: "حميد الشطباوي", icon: "truck", page: "suppliers" },
  ];
  render(<GlobalSearch onNavigate={onNavigate} searchIndex={searchIndex} />);
  const input = screen.getByPlaceholderText("بحث في النظام…");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "البركة" } });
  // Matching result shows; the non-matching one does not.
  expect(screen.getByText("معرض البركة")).toBeInTheDocument();
  expect(screen.queryByText("حميد الشطباوي")).not.toBeInTheDocument();
  // Picking it navigates to its page.
  fireEvent.click(screen.getByText("معرض البركة"));
  expect(onNavigate).toHaveBeenCalledWith("suppliers");
});

// ---- AppShell: smoke (sidebar + child content both render) ------------
test("AppShell renders the sidebar and the active page content", () => {
  render(
    <AppShell
      active="dashboard"
      onNavigate={() => {}}
      exchangeRate={1350}
      alerts={[]}
      searchIndex={[]}
    >
      <div>محتوى</div>
    </AppShell>
  );
  // A sidebar nav item proves the Sidebar mounted. (The same label also appears
  // as the Header breadcrumb for the active "dashboard" page, so match all.)
  expect(screen.getAllByText("اللوحة التنفيذية").length).toBeGreaterThan(0);
  // The child (active page) content renders in the content area.
  expect(screen.getByText("محتوى")).toBeInTheDocument();
});
