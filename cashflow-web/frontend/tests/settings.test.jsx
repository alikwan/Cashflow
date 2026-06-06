// tests/settings.test.jsx — Task E1.
//
// Covers the Settings page (API-backed save: PUT /api/settings + cap POSTs,
// toasts via useToast, loaded values + null-assumption fallback, loading/error)
// and the in-app TweaksPanel (live onChange patches).
import { http, HttpResponse } from "msw";
import {
  renderWithProviders,
  render,
  screen,
  fireEvent,
  waitFor,
} from "./test-utils";
import { server } from "./setup";
import App from "../src/App";
import { ToastProvider } from "../src/components/Primitives";
import { Settings } from "../src/pages/Settings";
import { TweaksPanel } from "../src/components/TweaksPanel";

describe("Settings page", () => {
  test("saving settings calls PUT /api/settings and shows a toast", async () => {
    // Spy: record the PUT body and respond with a merged SettingsOut.
    let putBody = null;
    server.use(
      http.put("/api/settings", async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json(putBody);
      })
    );

    renderWithProviders(<Settings />);

    // The save button is disabled until the draft is dirty — make a realistic
    // edit first (toggle the first alert switch = showAlert), then save.
    await screen.findByText(/شريط الإنذار في اللوحة/);
    const toggles = screen.getAllByRole("switch");
    fireEvent.click(toggles[0]); // showAlert true → false → dirty

    fireEvent.click(await screen.findByText(/حفظ الإعدادات/));

    // Toast confirms the save.
    expect(await screen.findByText(/تم حفظ الإعدادات/)).toBeInTheDocument();

    // PUT fired with a sensibly-shaped nested body.
    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody).toHaveProperty("display");
    expect(putBody).toHaveProperty("assumptions");
    expect(putBody.display.show_alert).toBe(false);
    expect(putBody.assumptions).toHaveProperty("usd_rate");
    expect(putBody.assumptions).toHaveProperty("unexpected_reserve_m");
  });

  test("after a successful save the page is no longer dirty (bar resets, Save disables)", async () => {
    // Make the refetched GET /api/settings return the SAVED value (show_alert
    // false) so `effective` re-derives to match the draft and `dirty` clears.
    // This guards the regression where save() advanced the App baseline but not
    // the page's OWN baseline — the success toast fired while the bar still said
    // "لديك تغييرات غير محفوظة" and Save stayed enabled (re-submittable).
    let saved = false;
    server.use(
      http.get("/api/settings", () =>
        HttpResponse.json({
          display: {
            accent: "أزرق",
            show_alert: saved ? false : true,
            neg_threshold_m: 0,
            over_cap_warn: true,
          },
          assumptions: {
            usd_rate: 1350.0,
            unexpected_reserve_m: 15.0,
            income_growth_pct: null,
            fiscal_year_start_month: 5,
          },
        })
      ),
      http.put("/api/settings", async ({ request }) => {
        saved = true; // subsequent GETs now reflect the persisted change
        return HttpResponse.json(await request.json());
      })
    );

    renderWithProviders(<Settings />);

    // Edit: toggle showAlert true → false → dirty.
    await screen.findByText(/شريط الإنذار في اللوحة/);
    const toggles = screen.getAllByRole("switch");
    fireEvent.click(toggles[0]);

    // Helper: the Save button is the `.btn-primary` (the toast "تم حفظ الإعدادات"
    // also matches /حفظ/, so scope to the actual button to avoid ambiguity).
    const saveButton = () =>
      screen
        .getAllByRole("button")
        .find((b) => /حفظ الإعدادات/.test(b.textContent));

    // Bar reflects the unsaved edit; Save is enabled.
    expect(screen.getByText(/لديك تغييرات غير محفوظة/)).toBeInTheDocument();
    expect(saveButton()).not.toBeDisabled();

    fireEvent.click(saveButton());

    // Success toast fires…
    expect(await screen.findByText(/تم حفظ الإعدادات/)).toBeInTheDocument();

    // …and after the refetch lands, dirty is reset: bar reads "كل التغييرات
    // محفوظة" and Save is disabled (no further edits).
    expect(await screen.findByText(/كل التغييرات محفوظة/)).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  test("changing a supplier cap fires POST /api/suppliers/{id}/caps with monthly_cap_m", async () => {
    let capCall = null;
    server.use(
      http.put("/api/settings", () => HttpResponse.json({})),
      http.post("/api/suppliers/:id/caps", async ({ request, params }) => {
        capCall = { id: params.id, body: await request.json() };
        return HttpResponse.json(
          {
            id: 1,
            supplier_id: 1,
            monthly_cap_m: capCall.body.monthly_cap_m,
            plan_low_m: 0,
            plan_high_m: 0,
            user_monthly_m: 0,
            effective_from: capCall.body.effective_from,
            created_by: 1,
          },
          { status: 201 }
        );
      })
    );

    renderWithProviders(<Settings />);

    // Supplier 1001 (معرض البركة) seeds cap=5.0. Its cap NumberField is a
    // type=number input with value "5". Change it.
    await screen.findByText(/معرض البركة/);
    const capInputs = screen
      .getAllByRole("spinbutton")
      .filter((el) => el.value === "5");
    expect(capInputs.length).toBeGreaterThan(0);
    fireEvent.change(capInputs[0], { target: { value: "12" } });

    fireEvent.click(await screen.findByText(/حفظ الإعدادات/));

    await waitFor(() => expect(capCall).not.toBeNull());
    expect(capCall.id).toBe("1001");
    expect(capCall.body.monthly_cap_m).toBe(12);
    expect(capCall.body).toHaveProperty("effective_from");
  });

  test("loads values from the settings fixture (exchange rate, reserve)", async () => {
    renderWithProviders(<Settings />);
    // exchangeRate 1350 + reserve 15 come from the fixtures.
    const rate = await screen.findByDisplayValue("1350");
    expect(rate).toBeInTheDocument();
    // reserve slider value 15 is rendered as text "15 م".
    expect(screen.getByText(/15/)).toBeInTheDocument();
  });

  test("null income_growth_pct falls back to 0 (slider renders 0)", async () => {
    // The fixture already has income_growth_pct: null. The slider must show 0,
    // not crash on the null. Find the income-growth range input.
    renderWithProviders(<Settings />);
    await screen.findByText(/نمو المقبوضات المتوقع/);
    const sliders = screen.getAllByRole("slider");
    // Both reserve (15) and income-growth (0) are range inputs; income-growth = 0.
    expect(sliders.some((s) => s.value === "0")).toBe(true);
  });

  test("shows a loading state while the hooks resolve", async () => {
    server.use(
      http.get("/api/settings", async () => {
        await new Promise((r) => setTimeout(r, 60));
        return HttpResponse.json({ display: {}, assumptions: {} });
      })
    );
    renderWithProviders(<Settings />);
    expect(await screen.findByLabelText("جارٍ التحميل")).toBeInTheDocument();
  });

  test("shows an error state when a hook fails", async () => {
    server.use(
      http.get("/api/settings", () =>
        HttpResponse.json(
          { error: { code: "boom", message: "فشل" } },
          { status: 500 }
        )
      )
    );
    renderWithProviders(<Settings />);
    expect(await screen.findByText(/تعذّر تحميل البيانات/)).toBeInTheDocument();
  });
});

describe("TweaksPanel", () => {
  // The panel edits live app state via onChange(patch). It needs a settings
  // object to render its contents; the FAB is always present.
  const baseSettings = {
    accent: "أزرق",
    showAlert: true,
    reserve: 15,
    incomeGrowth: 0,
  };

  function renderPanel(onChange) {
    return render(
      <ToastProvider>
        <TweaksPanel settings={baseSettings} onChange={onChange} />
      </ToastProvider>
    );
  }

  test("toggling show-alert fires onChange with the patch", async () => {
    const onChange = vi.fn();
    renderPanel(onChange);
    // Open the panel via the FAB.
    fireEvent.click(screen.getByLabelText("تعديل سريع"));
    // The show-alert toggle is the (single) switch inside the open panel.
    const toggle = await screen.findByRole("switch");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ showAlert: false });
  });

  test("changing the reserve slider fires onChange with the new reserve", async () => {
    const onChange = vi.fn();
    renderPanel(onChange);
    fireEvent.click(screen.getByLabelText("تعديل سريع"));
    const sliders = await screen.findAllByRole("slider");
    // First slider = reserve (0..40).
    fireEvent.change(sliders[0], { target: { value: "25" } });
    expect(onChange).toHaveBeenCalledWith({ reserve: 25 });
  });

  test("the FAB toggles the panel open and closed", async () => {
    renderPanel(vi.fn());
    // Closed initially: the panel dialog is not present.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("تعديل سريع"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("accent theming (App-level)", () => {
  // The App applies the live accent as inline overrides on <html>: a non-default
  // accent sets --color-primary (+ ramp) so the buttons recolor; أزرق (default)
  // REMOVES the overrides so the stylesheet's blue tokens apply. The TweaksPanel
  // drives `live.accent` synchronously (no refetch), so it's the cleanest hook.
  const root = () => document.documentElement;

  test("a non-default accent sets --color-primary; reverting to أزرق removes it", async () => {
    render(<App />);
    // Wait for the authed shell to mount (the quick-tweaks FAB is always present).
    fireEvent.click(await screen.findByLabelText("تعديل سريع"));

    // Default أزرق: no inline --color-primary override (stylesheet blue wins).
    expect(root().style.getPropertyValue("--color-primary")).toBe("");

    // Switch to كحلي (indigo) → buttons/ramp recolor via the semantic vars.
    fireEvent.click(await screen.findByTitle("كحلي"));
    await waitFor(() =>
      expect(root().style.getPropertyValue("--color-primary")).toBe("#4F46E5")
    );
    expect(root().style.getPropertyValue("--color-primary-hover")).toBe("#4338CA");
    expect(root().style.getPropertyValue("--primary-500")).toBe("#6366F1");

    // Revert to أزرق → all inline overrides removed (exact stylesheet reset).
    fireEvent.click(await screen.findByTitle("أزرق"));
    await waitFor(() =>
      expect(root().style.getPropertyValue("--color-primary")).toBe("")
    );
    expect(root().style.getPropertyValue("--primary-500")).toBe("");
  });
});
