// البيت السعيد — shared page-level loading + error states (Task D2).
//
// The design-reference pages read data synchronously off window.DATA, so they
// had no async states. Now that data arrives via the D1 hooks, every ported
// page must handle (a) the brief loading window and (b) a fetch error, WITHOUT
// breaking the pixel-parity of the loaded view. This tiny, on-brand helper
// renders those two states using the design tokens; the caller wraps it in the
// page's own padding wrapper so the layout doesn't jump.
import React from "react";
import { Card, Button } from "../components/Primitives";

// A centered, muted spinner + "جارٍ التحميل…" — reuses the App loader's spin
// keyframe pattern (self-contained <style>) so no shared CSS is required.
export function PageLoading() {
  return (
    <div
      role="status"
      aria-label="جارٍ التحميل"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        minHeight: 240,
        color: "var(--slate-500)",
      }}
    >
      <style>{"@keyframes page-spin{to{transform:rotate(360deg)}}"}</style>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          border: "3px solid var(--slate-200)",
          borderTopColor: "var(--primary-600)",
          animation: "page-spin 0.7s linear infinite",
        }}
      />
      <span style={{ fontSize: 13.5 }}>جارٍ التحميل…</span>
    </div>
  );
}

// A friendly on-brand error card with the error message and a retry button.
export function PageError({ error, onRetry }) {
  const message =
    (error && (error.message || error.toString())) || "حدث خطأ غير متوقّع";
  return (
    <Card style={{ maxWidth: 520, margin: "32px auto", textAlign: "center" }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          margin: "0 auto 14px",
          background: "var(--danger-50)",
          color: "var(--danger-600)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Tajawal",
          fontWeight: 700,
          fontSize: 24,
        }}
      >
        !
      </div>
      <div
        style={{
          fontFamily: "Tajawal",
          fontWeight: 700,
          fontSize: 17,
          color: "var(--slate-900)",
          marginBottom: 6,
        }}
      >
        تعذّر تحميل البيانات
      </div>
      <div
        style={{
          fontSize: 13,
          color: "var(--slate-500)",
          marginBottom: 18,
          lineHeight: 1.6,
        }}
      >
        {message}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" icon="reset" onClick={onRetry}>
          إعادة المحاولة
        </Button>
      )}
    </Card>
  );
}

// Convenience: pick the right state. Error wins over loading (a failed retry
// should surface the error, not spin forever). Returns null when neither — the
// caller should then render its loaded view.
export function PageState({ loading, error, onRetry }) {
  if (error) return <PageError error={error} onRetry={onRetry} />;
  if (loading) return <PageLoading />;
  return null;
}
