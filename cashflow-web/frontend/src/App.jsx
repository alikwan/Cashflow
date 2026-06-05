import { useEffect } from "react";

// Root application component.
//
// Sets the document direction/language programmatically so RTL is active even
// when App mounts outside index.html (e.g. in jsdom under Vitest). index.html
// also sets dir="rtl" lang="ar" on <html> for the real browser.
export default function App() {
  useEffect(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "ar";
  }, []);

  return (
    <main style={{ padding: "var(--space-2xl)" }}>
      <h1>البيت السعيد · تحليل السيولة النقدية</h1>
    </main>
  );
}
