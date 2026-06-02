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

from app.db.models import EtlRun

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

        # TODO(alerts): generate liquidity alerts from monthly + forecast here
        # (deferred — out of scope for this task)

        # ---------------------------------------------------------------- #
        # 10. FINISH                                                        #
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
