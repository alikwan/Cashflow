// auth/Login.jsx — the unauthenticated entry screen.
//
// The Primitives library (Button/Input/Card) isn't ported yet (Task C1), so
// this is built with on-brand INLINE styles using the design tokens from
// colors_and_type.css (primary blue, Tajawal heading, Cairo body, RTL, rounded
// cards + shadows). It calls `login(username, password)` from AuthContext and
// maps the failure status to an Arabic message:
//   401 → bad credentials · 429 → throttled · network/other → connection error.
import { useState } from "react";
import { useAuth } from "./AuthContext";

const MSG = {
  bad: "اسم المستخدم أو كلمة المرور غير صحيحة",
  throttled: "محاولات كثيرة، انتظر قليلاً ثم حاول مجدداً",
  network: "تعذّر الاتصال بالخادم، تحقّق من الشبكة وحاول مجدداً",
};

// Map an error thrown by `login` to a user-facing Arabic message.
function messageFor(err) {
  const status = err && err.status;
  if (status === 401) return MSG.bad;
  if (status === 429) return MSG.throttled;
  // status 0 = network_error (per the api client contract); anything else
  // (500, unexpected) also surfaces as a generic connection problem.
  return MSG.network;
}

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      // On success AuthContext flips `user`; the guard swaps this screen out.
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={S.page}>
      <form style={S.card} onSubmit={onSubmit} noValidate>
        <div style={S.brand}>
          <div style={S.logo} aria-hidden="true">
            ب
          </div>
          <h1 style={S.title}>البيت السعيد</h1>
          <p style={S.subtitle}>تحليل السيولة النقدية</p>
        </div>

        <div style={S.field}>
          <label htmlFor="login-username" style={S.label}>
            اسم المستخدم
          </label>
          <input
            id="login-username"
            name="username"
            type="text"
            className="input"
            autoComplete="username"
            value={username}
            disabled={submitting}
            onChange={(e) => setUsername(e.target.value)}
            style={S.input}
          />
        </div>

        <div style={S.field}>
          <label htmlFor="login-password" style={S.label}>
            كلمة المرور
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            disabled={submitting}
            onChange={(e) => setPassword(e.target.value)}
            style={S.input}
          />
        </div>

        {error && (
          <div role="alert" style={S.error}>
            {error}
          </div>
        )}

        <button type="submit" disabled={submitting} style={S.button}>
          {submitting ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}
        </button>
      </form>
    </div>
  );
}

// Inline styles using design tokens. Kept local; Task C1 replaces these with
// the shared Primitives library.
const S = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--color-bg)",
    padding: "var(--space-lg)",
  },
  card: {
    width: "100%",
    maxWidth: 380,
    background: "var(--color-surface)",
    border: "1px solid var(--color-border-light)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-card)",
    padding: "var(--space-2xl) var(--space-xl)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-md)",
  },
  brand: {
    textAlign: "center",
    marginBottom: "var(--space-sm)",
  },
  logo: {
    width: 56,
    height: 56,
    margin: "0 auto var(--space-md)",
    borderRadius: "var(--radius-md)",
    background: "linear-gradient(135deg,#2563EB,#7C3AED)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "var(--font-heading)",
    fontWeight: 700,
    fontSize: 26,
    boxShadow: "0 2px 8px rgba(37,99,235,0.32)",
  },
  title: {
    fontFamily: "var(--font-heading)",
    fontSize: "var(--fs-h2)",
    fontWeight: 700,
    color: "var(--color-text)",
    margin: 0,
  },
  subtitle: {
    fontSize: "var(--fs-sm)",
    color: "var(--color-text-secondary)",
    marginTop: "var(--space-xs)",
  },
  field: {
    display: "flex",
    flexDirection: "column",
  },
  label: {
    display: "block",
    fontSize: "var(--fs-sm)",
    fontWeight: 500,
    color: "var(--slate-700)",
    marginBottom: 6,
  },
  input: {
    width: "100%",
  },
  error: {
    background: "var(--danger-50)",
    border: "1px solid var(--danger-200)",
    color: "var(--danger-700)",
    borderRadius: "var(--radius-sm)",
    padding: "10px 14px",
    fontSize: "var(--fs-sm)",
    lineHeight: 1.5,
  },
  button: {
    marginTop: "var(--space-xs)",
    width: "100%",
    padding: "12px 24px",
    borderRadius: "var(--radius-sm)",
    border: "1.5px solid transparent",
    background: "var(--primary-600)",
    color: "#fff",
    fontFamily: "var(--font-body)",
    fontWeight: 600,
    fontSize: "var(--fs-body)",
    cursor: "pointer",
    boxShadow: "var(--shadow-sm)",
  },
};
