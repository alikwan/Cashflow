// Global test setup. Kept minimal: jest-dom matchers + a ResizeObserver stub.
// Task D1 will extend this file with MSW server lifecycle hooks and a
// renderWithProviders helper.
import "@testing-library/jest-dom";

// jsdom does not implement ResizeObserver, which Charts.jsx's `useWidth` hook
// constructs (`new ResizeObserver(...)`). Without this stub any test that
// renders a chart throws "ResizeObserver is not defined". A no-op class is
// enough: the hook also seeds an initial width from `clientWidth`, so charts
// still mount and render. Backward-compatible — existing tests are unaffected.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserver;
}
