// Task C1 — component tests for the ported Primitives + Charts.
//
// These cover the pixel-parity port of design-reference/project/src/* into
// src/components/{Primitives,Charts}.jsx. The toast system was the one
// non-mechanical transform: the module-level `window.showToast` global became a
// React context (ToastProvider / useToast / ToastHost), so it gets explicit
// coverage here. Chart rendering relies on the ResizeObserver stub added to
// tests/setup.js (jsdom does not implement ResizeObserver).
import { render, screen, fireEvent } from "@testing-library/react";
import { Badge, Button, ToastProvider, useToast } from "../src/components/Primitives";
import { LineChart } from "../src/components/Charts";

// ---- Badge (verbatim from the plan) -----------------------------------
test("badge renders tone", () => {
  render(<Badge tone="red">3 نشطة</Badge>);
  expect(screen.getByText("3 نشطة")).toBeInTheDocument();
});

// ---- Button -----------------------------------------------------------
test("button renders children and responds to onClick", () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>حفظ</Button>);
  const btn = screen.getByRole("button", { name: /حفظ/ });
  expect(btn).toBeInTheDocument();
  fireEvent.click(btn);
  expect(onClick).toHaveBeenCalledTimes(1);
});

// ---- Chart smoke test (needs the ResizeObserver stub) -----------------
test("LineChart mounts an <svg> without throwing", () => {
  const { container } = render(
    <LineChart
      series={[{ key: "a", label: "A", color: "--primary-600", values: [1, 2, 3], area: true }]}
      labels={["x", "y", "z"]}
    />
  );
  expect(container.querySelector("svg")).toBeInTheDocument();
});

// ---- Toast via React context ------------------------------------------
// A tiny consumer that fires a toast on click, so we can assert it appears.
function ToastTrigger() {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast("تم")}>أطلق</button>
  );
}

test("showToast (via useToast) surfaces a toast inside a ToastProvider", () => {
  render(
    <ToastProvider>
      <ToastTrigger />
    </ToastProvider>
  );
  // No toast yet.
  expect(screen.queryByText("تم")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /أطلق/ }));
  // ToastProvider renders <ToastHost/> itself, so the toast text appears.
  expect(screen.getByText("تم")).toBeInTheDocument();
});

test("unmounting a ToastProvider mid-toast clears the pending auto-dismiss timer", () => {
  // The 2800ms auto-dismiss timer (still pending right after the toast fires)
  // must be cleared by the provider's unmount cleanup. Real timers are used so
  // the 2800ms callback never actually runs during the test; we assert on the
  // observable effect of the cleanup — a clearTimeout call at unmount time.
  // Spy on console.error too, to catch any act/unmount warning React emits.
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const clearSpy = vi.spyOn(globalThis, "clearTimeout");
  try {
    const { unmount } = render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    );
    // Fire a toast; its 2800ms dismiss timer is now pending.
    fireEvent.click(screen.getByRole("button", { name: /أطلق/ }));
    expect(screen.getByText("تم")).toBeInTheDocument();

    // Bracket the unmount: a clearTimeout MUST happen during cleanup. Without
    // the cleanup the count would not increase here (the timer would leak).
    const clearsBefore = clearSpy.mock.calls.length;
    unmount();
    expect(clearSpy.mock.calls.length).toBeGreaterThan(clearsBefore);

    // No "state update on an unmounted component" / act warning was emitted.
    expect(errSpy).not.toHaveBeenCalled();
  } finally {
    clearSpy.mockRestore();
    errSpy.mockRestore();
  }
});

test("useToast outside a provider throws a clear error", () => {
  // Render a consumer with no provider; React surfaces the thrown error.
  function Orphan() {
    useToast();
    return null;
  }
  // Silence the expected React error boundary console noise.
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<Orphan />)).toThrow(/ToastProvider/);
  spy.mockRestore();
});
