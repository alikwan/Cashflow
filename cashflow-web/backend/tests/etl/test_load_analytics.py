"""
tests/etl/test_load_analytics.py

Tests for the refactored ETL load layer:

1. Backward-compat: atomic_replace still works (full-replace semantics).
2. Fix #3 — snapshot date preservation: load_analytics with date-keyed tables
   keeps prior snapshot_date rows intact.
3. Fix #2 — cross-table atomicity: a broken frame causes the whole batch to
   roll back, leaving previously-seeded tables untouched.
4. Fix #6 — window helper unit tests.
"""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.config import settings
from app.db.base import Base
import app.db.models  # noqa: F401  (registers all tables with Base.metadata)
from app.etl.load import atomic_replace, load_analytics

TEST_URL = settings.postgres_url.rsplit("/", 1)[0] + "/cashflow_test"

# ---------------------------------------------------------------------------
# Shared engine fixture
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def engine():
    """Module-scoped engine; creates all tables once, disposes at end."""
    eng = create_engine(TEST_URL, poolclass=NullPool, future=True)
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


# ---------------------------------------------------------------------------
# Helper row builders
# ---------------------------------------------------------------------------

def _monthly_row(ym: str) -> dict:
    cols = [
        "cash_in_m", "out_suppliers_m", "out_drawings_m", "out_refunds_m",
        "out_purchases_m", "out_salaries_m", "out_other_m", "out_siyrafa_m",
        "internal_transfers_m", "out_total_operational_m",
        "out_total_comprehensive_m", "net_operating_m",
        "net_total_m", "cash_running_m",
    ]
    r = {c: 0 for c in cols}
    r.update(year_month=ym, bond_count=0, fiscal_year="2025-2026")
    return r


def _inst_summary_row(snap_date: date, remaining_m: float = 100.0) -> dict:
    """Minimal installments_summary row — all NOT-NULL numeric cols required."""
    return {
        "snapshot_date": snap_date,
        "premium_count": 1,
        "face_total_m":  remaining_m + 10.0,
        "cash_paid_m":   10.0,
        "discount_m":    0.0,
        "remaining_m":   remaining_m,
    }


def _inst_aging_rows(snap_date: date) -> list[dict]:
    """Minimal installments_aging rows (one bucket)."""
    return [{
        "snapshot_date": snap_date,
        "bucket_key":    "not_due",
        "label":         "غير مستحق",
        "amount_m":      100.0,
        "count":         1,
    }]


def _balances_row(snap_date: date, account_id: int = 999) -> dict:
    return {
        "snapshot_date": snap_date,
        "account_id":    account_id,
        "currency_id":   1,
        "account_name":  "test",
        "account_kind":  "cashbox",
        "balance_m":     1.0,
        "balance_iqd_m": 1.0,
        "last_active":   snap_date,
    }


# ---------------------------------------------------------------------------
# 1. Backward-compat: atomic_replace still does full replace
# ---------------------------------------------------------------------------

def test_atomic_replace_backward_compat(engine):
    """atomic_replace still overwrites the whole table (original behaviour)."""
    with engine.begin() as c:
        c.execute(text("TRUNCATE TABLE monthly_cashflow"))

    atomic_replace(engine, "monthly_cashflow", pd.DataFrame([_monthly_row("2026-01")]))
    atomic_replace(engine, "monthly_cashflow", pd.DataFrame([_monthly_row("2026-02")]))

    with engine.connect() as c:
        rows = c.execute(
            text("SELECT year_month FROM monthly_cashflow ORDER BY year_month")
        ).scalars().all()

    assert rows == ["2026-02"], f"Expected full-replace to leave only 2026-02, got {rows}"


# ---------------------------------------------------------------------------
# 2. Fix #3 — snapshot date preservation
# ---------------------------------------------------------------------------

def test_snapshot_date_preservation(engine):
    """load_analytics for installments_summary keeps prior snapshot_dates intact."""
    D1 = date(2026, 5, 1)
    D2 = date(2026, 6, 3)

    # Clean slate for this table
    with engine.begin() as c:
        c.execute(text("TRUNCATE TABLE installments_summary"))

    # First run — D1
    frames_d1 = {
        "installments_summary": pd.DataFrame([_inst_summary_row(D1, remaining_m=200.0)]),
    }
    load_analytics(engine, frames_d1, D1)

    # Second run — D2 (different date)
    frames_d2 = {
        "installments_summary": pd.DataFrame([_inst_summary_row(D2, remaining_m=300.0)]),
    }
    load_analytics(engine, frames_d2, D2)

    # Both dates must survive
    with engine.connect() as c:
        dates = c.execute(
            text("SELECT snapshot_date FROM installments_summary ORDER BY snapshot_date")
        ).scalars().all()

    assert len(dates) == 2, (
        f"Expected 2 distinct snapshot_dates, got {len(dates)}: {dates}"
    )
    assert D1 in dates, f"D1 ({D1}) was wiped — expected it to survive"
    assert D2 in dates, f"D2 ({D2}) missing"


def test_snapshot_same_date_replace(engine):
    """Running load_analytics twice with the same snapshot_date replaces that
    day's rows but does NOT create duplicates."""
    D = date(2026, 6, 3)

    with engine.begin() as c:
        c.execute(text("TRUNCATE TABLE installments_summary"))

    frames1 = {"installments_summary": pd.DataFrame([_inst_summary_row(D, remaining_m=100.0)])}
    load_analytics(engine, frames1, D)

    frames2 = {"installments_summary": pd.DataFrame([_inst_summary_row(D, remaining_m=150.0)])}
    load_analytics(engine, frames2, D)

    with engine.connect() as c:
        rows = c.execute(
            text("SELECT remaining_m FROM installments_summary WHERE snapshot_date = :d"),
            {"d": D},
        ).scalars().all()

    assert len(rows) == 1, f"Expected 1 row for date {D}, got {len(rows)}"
    assert float(rows[0]) == 150.0, f"Expected remaining_m=150.0 (updated), got {rows[0]}"


# ---------------------------------------------------------------------------
# 3. Fix #2 — cross-table atomicity (rollback on failure)
# ---------------------------------------------------------------------------

def test_cross_table_atomicity_rollback(engine):
    """If any frame in the batch raises, the whole transaction rolls back.

    Strategy:
      - Seed installments_aging with a known row for a sentinel date.
      - Build a batch that includes installments_aging (good df) AND
        a deliberately bad monthly_cashflow df (missing required column
        'fiscal_year' which is NOT NULL in the DB).
      - load_analytics should raise.
      - Assert that the sentinel row in installments_aging is still present
        (i.e. the entire batch rolled back, not just the bad table).
    """
    SENTINEL_DATE = date(2025, 1, 1)

    # Seed a known row in installments_aging for sentinel date
    with engine.begin() as c:
        c.execute(
            text("DELETE FROM installments_aging WHERE snapshot_date = :d"),
            {"d": SENTINEL_DATE},
        )
        c.execute(
            text(
                "INSERT INTO installments_aging "
                "(snapshot_date, bucket_key, label, amount_m, count) "
                "VALUES (:d, 'not_due', 'test', 42.0, 1)"
            ),
            {"d": SENTINEL_DATE},
        )

    # Verify seed is in place
    with engine.connect() as c:
        cnt = c.execute(
            text("SELECT COUNT(*) FROM installments_aging WHERE snapshot_date = :d"),
            {"d": SENTINEL_DATE},
        ).scalar()
    assert cnt == 1, "Seed row not inserted"

    # Build a batch: installments_summary is fine, BUT monthly_cashflow is
    # broken — it's missing 'fiscal_year' which is NOT NULL at DB level.
    BATCH_DATE = date(2026, 6, 3)
    bad_monthly = pd.DataFrame([{
        "year_month": "2026-06",
        "cash_in_m": 0,
        # fiscal_year deliberately omitted → NOT NULL violation
    }])
    good_aging = pd.DataFrame(_inst_aging_rows(BATCH_DATE))

    frames = {
        "installments_summary": pd.DataFrame([_inst_summary_row(BATCH_DATE)]),
        "monthly_cashflow": bad_monthly,       # will fail on INSERT
        "installments_aging": good_aging,
    }

    with pytest.raises(Exception):
        load_analytics(engine, frames, BATCH_DATE)

    # The sentinel row for SENTINEL_DATE must still be there (rollback preserved it)
    with engine.connect() as c:
        cnt_after = c.execute(
            text("SELECT COUNT(*) FROM installments_aging WHERE snapshot_date = :d"),
            {"d": SENTINEL_DATE},
        ).scalar()
        amount_after = c.execute(
            text("SELECT amount_m FROM installments_aging WHERE snapshot_date = :d"),
            {"d": SENTINEL_DATE},
        ).scalar()

    assert cnt_after == 1, (
        f"Sentinel row was affected by the failed batch — expected it still there, "
        f"got count={cnt_after}"
    )
    assert float(amount_after) == 42.0, (
        f"Sentinel row data changed after rollback: amount_m={amount_after}"
    )


# ---------------------------------------------------------------------------
# 4. Fix #6 — _history_end_exclusive unit tests
# ---------------------------------------------------------------------------

def test_history_end_exclusive_mid_month():
    from app.etl.pipeline import _history_end_exclusive
    assert _history_end_exclusive(date(2026, 6, 15)) == "2026-06-01"


def test_history_end_exclusive_first_of_month():
    from app.etl.pipeline import _history_end_exclusive
    assert _history_end_exclusive(date(2026, 6, 1)) == "2026-06-01"


def test_history_end_exclusive_jan():
    from app.etl.pipeline import _history_end_exclusive
    assert _history_end_exclusive(date(2026, 1, 9)) == "2026-01-01"


def test_history_end_exclusive_year_boundary():
    from app.etl.pipeline import _history_end_exclusive
    assert _history_end_exclusive(date(2025, 12, 31)) == "2025-12-01"
