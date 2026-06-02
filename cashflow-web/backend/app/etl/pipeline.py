"""
app/etl/pipeline.py — ETL orchestrator.

Wires extraction (MSSQL) + domain logic + atomic loading (Postgres) into a
single `run_etl` call, with a single-flight lock (via etl_runs.status) and
full lifecycle management in the EtlRun audit row.

Usage::

    from sqlalchemy.orm import Session
    from app.etl.pipeline import run_etl

    run = run_etl(session, mssql_conn)      # today = baghdad_today()
    print(run.status, run.rows_loaded)
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone, date

import pandas as pd
from sqlalchemy import select, func

from app.db.models import Alert, EtlRun

logger = logging.getLogger(__name__)
from app.domain.classify import classify_monthly
from app.domain.forecast import seasonal_forecast
from app.etl.extract import (
    baghdad_today,
    fetch_avg_usd_rate,
    fetch_balances,
    fetch_bonds,
    fetch_installments_aging,
    fetch_installments_summary,
    fetch_per_supplier_monthly,
)
from app.etl.load import atomic_replace
from app.etl.reconcile import running_balance
from app.domain.alerts import generate_alerts

# ---------------------------------------------------------------------------
# Module-level constants (spec §CLAUDE.md + task brief)
# ---------------------------------------------------------------------------

START_DATE = "2022-05-01"   # fixed historical window anchor

# A 'running' row older than this is considered a crashed/stale lock and no longer
# blocks new runs (normal ETL finishes in seconds; this only frees genuine crashes).
STALE_LOCK_HOURS = 6

# The 14 main distributors: (account_id, currency_of_balance)
SUPPLIER_ACCOUNTS: list[tuple[int, str]] = [
    (1001, "IQD"), (2079, "IQD"), (2093, "IQD"), (2432, "IQD"),
    (2440, "IQD"), (2700, "IQD"), (3123, "IQD"), (3916, "IQD"),
    (5721, "IQD"), (2439, "MIX"),
    (4937, "USD"), (6444, "USD"), (6552, "USD"), (6918, "USD"),
]

ACCOUNT_KIND_MAP: dict[int, str] = {
    2614: "supplier",
    1811: "cashbox",
    1812: "cashbox",
    1631: "debtor",
    2518: "partner",
}

BALANCE_TYPE_IDS: list[int] = [2614, 1811, 1812, 1631, 2518]

# Maps series_key → monthly_cashflow column used to build the seasonal index
# and forecast.
SERIES_COLS: dict[str, str] = {
    "cash_in":       "cash_in_m",
    "out_suppliers": "out_suppliers_m",
    "out_drawings":  "out_drawings_m",
    "out_refunds":   "out_refunds_m",
    "out_purchases": "out_purchases_m",
    "out_salaries":  "out_salaries_m",
    "out_other":     "out_other_m",
    "out_siyrafa":   "out_siyrafa_m",
}

AGING_LABELS: dict[str, str] = {
    "not_due":  "غير مستحق",
    "b0_30":    "0-30 يوم",
    "b31_60":   "31-60 يوم",
    "b61_90":   "61-90 يوم",
    "b91_120":  "91-120 يوم",
    "b120":     "أكثر من 120 يوم",
}


# ---------------------------------------------------------------------------
# Lock helpers
# ---------------------------------------------------------------------------

class ETLAlreadyRunning(Exception):
    """Raised when a second run_etl call is attempted while one is in progress."""


def _has_running_etl(session) -> bool:
    """Return True if a *fresh* etl_runs row has status == 'running'.

    A 'running' row older than STALE_LOCK_HOURS is treated as a crashed run and
    does NOT block — this auto-recovers the single-flight lock from hard crashes
    (where the failure-path update never ran), instead of deadlocking forever.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=STALE_LOCK_HOURS)
    return (
        session.scalar(
            select(func.count())
            .select_from(EtlRun)
            .where(EtlRun.status == "running", EtlRun.started_at > cutoff)
        )
        > 0
    )


# ---------------------------------------------------------------------------
# Alert-context helpers (called only from run_etl)
# ---------------------------------------------------------------------------

def _forecast_net_by_month(forecast_df: pd.DataFrame) -> dict[str, float]:
    """Compute forecast net cash per year_month.

    net = value_m(series_key=='cash_in') − Σ value_m(series_key starts with 'out_')
    Returns {year_month: net_m}.
    """
    if forecast_df.empty:
        return {}

    pivot = forecast_df.pivot_table(
        index="year_month",
        columns="series_key",
        values="value_m",
        aggfunc="sum",
        fill_value=0.0,
    )

    cash_in_col = pivot.get("cash_in", pd.Series(0.0, index=pivot.index))
    out_cols = [c for c in pivot.columns if str(c).startswith("out_")]
    out_total = pivot[out_cols].sum(axis=1) if out_cols else pd.Series(0.0, index=pivot.index)

    net = cash_in_col - out_total
    return {str(ym): float(v) for ym, v in net.items()}


def _fiscal_year_metrics(monthly: pd.DataFrame) -> tuple[float, float]:
    """Return (net_decline_pct, expense_velocity) from complete fiscal years.

    A complete FY has exactly 12 months.  If fewer than 2 complete FYs exist,
    returns (0.0, 0.0).

    net_decline_pct:
        (prev_net − last_net) / prev_net  when prev_net > 0 and last_net < prev_net,
        else 0.0.

    expense_velocity:
        (out_last / out_first) / (in_last / in_first) — how much faster expenses
        grew relative to receipts across the first and last complete FYs.
        Guards against divide-by-zero.
    """
    if monthly.empty:
        return 0.0, 0.0

    fy_groups = (
        monthly
        .groupby("fiscal_year", sort=True)
        .agg(
            month_count=("year_month", "count"),
            in_total=("cash_in_m", "sum"),
            out_total=("out_total_comprehensive_m", "sum"),
            net_total=("net_total_m", "sum"),
        )
        .reset_index()
    )

    complete = fy_groups[fy_groups["month_count"] == 12].reset_index(drop=True)

    if len(complete) < 2:
        return 0.0, 0.0

    first = complete.iloc[0]
    last  = complete.iloc[-1]
    prev  = complete.iloc[-2]

    # net_decline_pct: compare the last two complete FYs
    prev_net = float(prev["net_total"])
    last_net = float(last["net_total"])
    if prev_net > 0 and last_net < prev_net:
        net_decline_pct = (prev_net - last_net) / prev_net
    else:
        net_decline_pct = 0.0

    # expense_velocity: first vs last complete FY
    in_first  = float(first["in_total"])
    in_last   = float(last["in_total"])
    out_first = float(first["out_total"])
    out_last  = float(last["out_total"])

    if in_first <= 0 or in_last <= 0 or out_first <= 0:
        return net_decline_pct, 0.0

    in_growth  = in_last  / in_first
    out_growth = out_last / out_first

    if in_growth <= 0:
        return net_decline_pct, 0.0

    expense_velocity = out_growth / in_growth
    return net_decline_pct, expense_velocity


# ---------------------------------------------------------------------------
# Shape-building helpers (keep small; called only from run_etl)
# ---------------------------------------------------------------------------

def _build_seasonal_index(monthly: pd.DataFrame) -> pd.DataFrame:
    """For each series_key × calendar-month, compute avg_value_m.

    fm_pos = (calendar_month - 5) % 12  (fiscal-month position, 0=May … 11=Apr).
    """
    rows: list[dict] = []
    # Derive calendar month once (identical for every series_key)
    months = monthly["year_month"].str[5:7].astype(int)
    for series_key, col in SERIES_COLS.items():
        for m in months.unique():
            mask = months == m
            avg_val = float(monthly.loc[mask, col].mean())
            rows.append({
                "series_key":   series_key,
                "fm_pos":       int((m - 5) % 12),
                "avg_value_m":  avg_val,
            })
    return pd.DataFrame(rows)


def _build_forecast_base(monthly: pd.DataFrame) -> pd.DataFrame:
    """Run seasonal_forecast for each series and flatten into rows."""
    rows: list[dict] = []
    for series_key, col in SERIES_COLS.items():
        series = pd.Series(
            monthly[col].values,
            index=monthly["year_month"],
            dtype=float,
        )
        fc = seasonal_forecast(series, horizon=12)
        for ym, val in zip(fc.index, fc.values):
            rows.append({
                "series_key": series_key,
                "year_month": ym,
                "engine":     "seasonal",
                "value_m":    float(val),
                "cagr":       float(fc.cagr),
                "mape":       float(fc.mape) if fc.mape is not None else None,
            })
    return pd.DataFrame(rows)


def _build_balances_snapshot(
    bal: pd.DataFrame,
    today: date,
    usd_rate: float,
) -> pd.DataFrame:
    """Build the balances_snapshot DataFrame (one row per account)."""
    df = bal.copy()
    df["snapshot_date"] = today
    df["account_kind"] = df["account_type_id"].map(ACCOUNT_KIND_MAP)

    # Convert balance to IQD:
    # currency_id == 1 → already IQD; anything else (2 = USD) → multiply by rate
    df["balance_iqd_m"] = df.apply(
        lambda r: float(r["balance_m"])
        if r["currency_id"] == 1
        else float(r["balance_m"]) * usd_rate,
        axis=1,
    )

    # Drop account_type_id — not a column on balances_snapshot
    return df.drop(columns=["account_type_id"])[
        [
            "snapshot_date",
            "account_id",
            "currency_id",
            "account_name",
            "account_kind",
            "balance_m",
            "balance_iqd_m",
            "last_active",
        ]
    ]


def _build_installments_summary(inst_sum: pd.DataFrame, today: date) -> pd.DataFrame:
    df = inst_sum.copy()
    df["snapshot_date"] = today
    return df[
        ["snapshot_date", "premium_count", "face_total_m", "cash_paid_m", "discount_m", "remaining_m"]
    ]


def _build_installments_aging(inst_age: pd.DataFrame, today: date) -> pd.DataFrame:
    df = inst_age.copy()
    df["snapshot_date"] = today
    df["label"] = df["bucket_key"].map(AGING_LABELS).fillna(df["bucket_key"])
    df = df.rename(columns={"cnt": "count"})
    return df[["snapshot_date", "bucket_key", "label", "amount_m", "count"]]


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def run_etl(session, conn, today: date | None = None) -> EtlRun:
    """Run the full ETL pipeline (MSSQL → classify → forecast → Postgres).

    Parameters
    ----------
    session:
        SQLAlchemy Session bound to the target Postgres database.
    conn:
        Open pymssql connection to AlBaytAlSaeid (read-only).
    today:
        Override "today" for the source window ceiling (default: baghdad_today()).

    Returns
    -------
    EtlRun row with status="success" and all metrics populated.

    Raises
    ------
    ETLAlreadyRunning
        If another run row with status="running" already exists.
    Exception
        Any other error — the EtlRun row is updated to status="failed" first,
        then the exception is re-raised.
    """
    # ------------------------------------------------------------------ #
    # LOCK: must be the very first check, before any other DB/conn use.   #
    # ------------------------------------------------------------------ #
    if _has_running_etl(session):
        raise ETLAlreadyRunning(
            "ETL is already running — found a row with status='running' in etl_runs. "
            "Wait for it to complete or manually clear the stale lock."
        )

    # Resolve 'today'
    today = today or baghdad_today()
    end_exclusive = today.isoformat()

    # Create and persist the run row
    run = EtlRun(
        status="running",
        started_at=datetime.now(timezone.utc),
        source_tz="Asia/Baghdad",
        source_max_date=today,
    )
    session.add(run)
    session.commit()

    # The Postgres engine is needed by atomic_replace
    engine = session.get_bind()

    try:
        # ---------------------------------------------------------------- #
        # 1. EXTRACT                                                        #
        # ---------------------------------------------------------------- #
        bonds = fetch_bonds(conn, START_DATE, end_exclusive)
        per_sup = fetch_per_supplier_monthly(
            conn,
            [a for a, _ in SUPPLIER_ACCOUNTS],
            START_DATE,
            end_exclusive,
        )
        bal = fetch_balances(conn, BALANCE_TYPE_IDS)
        inst_sum = fetch_installments_summary(conn)
        inst_age = fetch_installments_aging(conn, today)
        usd_rate = fetch_avg_usd_rate(conn, today)

        # ---------------------------------------------------------------- #
        # 2. monthly_cashflow — classify + running balance                  #
        # ---------------------------------------------------------------- #
        monthly = classify_monthly(bonds)   # 16 cols from classify

        # Back-solve opening cash:
        #   opening = current_cash_balance − Σ net_total_m
        # This makes residual = 0 by construction (see note below).
        current_cash = float(
            bal[bal["account_type_id"].isin([1811, 1812])]["balance_m"].sum()
        )
        net_sum = float(monthly["net_total_m"].sum())
        opening = current_cash - net_sum

        rb = running_balance(
            opening,
            list(zip(monthly["year_month"], monthly["net_total_m"])),
        )
        monthly["cash_running_m"] = monthly["year_month"].map(rb)
        # monthly now has 17 cols (the 16 from classify + cash_running_m)

        # ---------------------------------------------------------------- #
        # 3. seasonal_index                                                 #
        # ---------------------------------------------------------------- #
        seasonal_df = _build_seasonal_index(monthly)

        # ---------------------------------------------------------------- #
        # 4. forecast_base                                                  #
        # ---------------------------------------------------------------- #
        forecast_df = _build_forecast_base(monthly)

        # ---------------------------------------------------------------- #
        # 5. balances_snapshot                                              #
        # ---------------------------------------------------------------- #
        balances_df = _build_balances_snapshot(bal, today, usd_rate)

        # ---------------------------------------------------------------- #
        # 6. installments_summary                                           #
        # ---------------------------------------------------------------- #
        inst_sum_df = _build_installments_summary(inst_sum, today)

        # ---------------------------------------------------------------- #
        # 7. installments_aging                                             #
        # (Do NOT assert Σ(aging)==remaining_m — ~56M known gap; load both) #
        # ---------------------------------------------------------------- #
        inst_age_df = _build_installments_aging(inst_age, today)

        # ---------------------------------------------------------------- #
        # 8. per_supplier_monthly — load as-is (columns already match)     #
        # ---------------------------------------------------------------- #

        # ---------------------------------------------------------------- #
        # 9. LOAD (atomic staging→swap for each analytical table)           #
        # ---------------------------------------------------------------- #
        rows_loaded = 0
        rows_loaded += atomic_replace(engine, "monthly_cashflow",      monthly)
        rows_loaded += atomic_replace(engine, "per_supplier_monthly",  per_sup)
        rows_loaded += atomic_replace(engine, "balances_snapshot",     balances_df)
        rows_loaded += atomic_replace(engine, "installments_summary",  inst_sum_df)
        rows_loaded += atomic_replace(engine, "installments_aging",    inst_age_df)
        rows_loaded += atomic_replace(engine, "seasonal_index",        seasonal_df)
        rows_loaded += atomic_replace(engine, "forecast_base",         forecast_df)

        # ---------------------------------------------------------------- #
        # 10. ALERTS (best-effort; failure is non-fatal)                    #
        # ---------------------------------------------------------------- #
        try:
            fc_net = _forecast_net_by_month(forecast_df)
            net_decline_pct, expense_velocity = _fiscal_year_metrics(monthly)
            ctx = {
                "forecast_net_by_month":     fc_net,
                "neg_threshold_m":           0.0,
                "reconciliation_residual_m": 0.0,       # back-solved → 0 for now
                "reconciliation_threshold_m": 25.0,     # discovery/03 suggested ±25M
                "cap_exceedances":           [],         # supplier caps not seeded yet
                "net_decline_pct":           net_decline_pct,
                "expense_velocity":          expense_velocity,
            }
            new_alerts = generate_alerts(ctx)
            # Refresh the auto-generated set: drop unacknowledged 'new',
            # keep 'read'/'resolved' so acknowledged alerts are preserved.
            session.query(Alert).filter(Alert.status == "new").delete(
                synchronize_session=False
            )
            now = datetime.now(timezone.utc)
            for a in new_alerts:
                session.add(Alert(status="new", generated_at=now, **a))
            session.flush()
            logger.info(
                "alert generation: %d alerts (net_decline_pct=%.3f, "
                "expense_velocity=%.3f, alert_types=%s)",
                len(new_alerts),
                net_decline_pct,
                expense_velocity,
                sorted({a["alert_type"] for a in new_alerts}),
            )
        except Exception:
            logger.exception(
                "alert generation failed (non-fatal; analytics already loaded)"
            )
            # Discard only the alert changes; data loads were separate txns
            # (atomic_replace commits its own transactions) and are already done.
            session.rollback()

        # ---------------------------------------------------------------- #
        # 11. FINISH                                                        #
        # ---------------------------------------------------------------- #
        # reconciliation_residual_m = 0.0 intentionally:
        # opening is back-solved from (current_cash − Σ net_total_m), making
        # the residual tautologically zero.  A real residual requires
        # historical balance snapshots (§4.3 / discovery/03), which will
        # accumulate once balances_snapshot has multi-date history.
        run.status = "success"
        run.finished_at = datetime.now(timezone.utc)
        run.opening_cash_m = opening
        run.reconciliation_residual_m = 0.0
        run.rows_loaded = rows_loaded
        run.usd_rate_used = usd_rate
        session.commit()

    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)[:2000]
        run.finished_at = datetime.now(timezone.utc)
        try:
            session.commit()
        except Exception:
            # Don't let a secondary commit failure mask the real error; the
            # 'running' row may persist but STALE_LOCK_HOURS will free it.
            session.rollback()
            logger.exception("ETL failure-path commit failed; lock may stay until stale")
        raise

    return run
