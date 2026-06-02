"""
app/domain/alerts.py
Pure alert-generation rules for the monthly cash-flow dashboard.
No I/O, no ORM, no external dependencies — stdlib only.

generate_alerts(ctx: dict) -> list[dict]

Each alert dict has keys:
  alert_type   : str  — one of liquidity_deficit | reconciliation_gap |
                         cap_exceeded | net_decline | expense_velocity
  severity     : str  — info | warning | danger
  title        : str  — short Arabic label
  body         : str  — Arabic detail sentence
  related_key  : str  — month string, supplier id str, or ""

Rules and thresholds
---------------------
1. liquidity_deficit  — fires for each month whose forecast net < neg_threshold_m (default 0)
2. reconciliation_gap — fires when |reconciliation_residual_m| > reconciliation_threshold_m
3. cap_exceeded        — fires for each item in cap_exceedances list
4. net_decline         — fires when net_decline_pct >= 0.25 (25 %)
5. expense_velocity    — fires when expense_velocity  >= 2.0  (expenses growing ≥ 2× receipts)
"""


def _alert(alert_type: str, severity: str, title: str, body: str,
           related_key: str = "") -> dict:
    return {
        "alert_type": alert_type,
        "severity": severity,
        "title": title,
        "body": body,
        "related_key": related_key,
    }


def generate_alerts(ctx: dict) -> list[dict]:
    alerts: list[dict] = []

    # ── 1. liquidity_deficit ────────────────────────────────────────────────
    forecast_net = ctx.get("forecast_net_by_month", {})
    neg_threshold = ctx.get("neg_threshold_m", 0.0)
    for month, net_m in forecast_net.items():
        if net_m < neg_threshold:
            alerts.append(_alert(
                alert_type="liquidity_deficit",
                severity="danger",
                title="عجز سيولة متوقع",
                body=f"شهر {month}: صافي تدفق نقدي سالب ({net_m:.1f}M د.ع).",
                related_key=month,
            ))

    # ── 2. reconciliation_gap ───────────────────────────────────────────────
    residual = ctx.get("reconciliation_residual_m", 0.0)
    recon_threshold = ctx.get("reconciliation_threshold_m", 50.0)
    if abs(residual) > recon_threshold:
        alerts.append(_alert(
            alert_type="reconciliation_gap",
            severity="warning",
            title="فجوة تسوية محاسبية",
            body=(
                f"الفارق المحاسبي ({residual:.1f}M) يتجاوز الحد المسموح "
                f"({recon_threshold:.1f}M). يُنصح بمراجعة السندات."
            ),
            related_key="",
        ))

    # ── 3. cap_exceeded ─────────────────────────────────────────────────────
    for exc in ctx.get("cap_exceedances", []):
        supplier_id = exc.get("supplier_id", "")
        name = exc.get("name", str(supplier_id))
        paid_m = exc.get("paid_m", 0.0)
        cap_m = exc.get("cap_m", 0.0)
        overage = paid_m - cap_m
        alerts.append(_alert(
            alert_type="cap_exceeded",
            severity="warning",
            title="تجاوز سقف مورّد",
            body=(
                f"المورّد '{name}' تجاوز سقفه الشهري: "
                f"مدفوع {paid_m:.1f}M مقابل سقف {cap_m:.1f}M "
                f"(زيادة {overage:.1f}M)."
            ),
            related_key=str(supplier_id),
        ))

    # ── 4. net_decline ──────────────────────────────────────────────────────
    net_decline_pct = ctx.get("net_decline_pct", 0.0)
    if net_decline_pct >= 0.25:
        alerts.append(_alert(
            alert_type="net_decline",
            severity="warning",
            title="تراجع حاد في صافي التدفق",
            body=(
                f"صافي التدفق النقدي تراجع بنسبة {net_decline_pct:.0%} "
                "مقارنةً بالعام الماضي. يُنصح بمراجعة هيكل المصروفات."
            ),
            related_key="",
        ))

    # ── 5. expense_velocity ─────────────────────────────────────────────────
    expense_velocity = ctx.get("expense_velocity", 0.0)
    if expense_velocity >= 2.0:
        alerts.append(_alert(
            alert_type="expense_velocity",
            severity="warning",
            title="تسارع غير طبيعي في المصروفات",
            body=(
                f"المصروفات تنمو بمعدل {expense_velocity:.1f}× أسرع من المقبوضات. "
                "يُنصح بمراجعة بنود الصرف."
            ),
            related_key="",
        ))

    return alerts
