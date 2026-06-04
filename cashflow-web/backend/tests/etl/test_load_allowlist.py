"""
tests/etl/test_load_allowlist.py

TDD: verify the ETL load allow-list guard added to _replace_one / atomic_replace.

Uses the SQLite `session` fixture's engine (via a lightweight engine from
conftest) — we don't need Postgres; the validation runs before any SQL.
"""
from __future__ import annotations

from datetime import date

import pandas as pd
import pytest
from sqlalchemy import create_engine

from app.db.base import Base
import app.db.models  # noqa: F401 — registers all tables

from app.etl.load import atomic_replace


# ---------------------------------------------------------------------------
# SQLite engine fixture (mirrors conftest pattern but module-scoped for speed)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def sqlite_engine(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("etl_allowlist")
    eng = create_engine(f"sqlite:///{tmp/'t.db'}", future=True)
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


# ---------------------------------------------------------------------------
# Minimal valid DataFrame for monthly_cashflow
# ---------------------------------------------------------------------------

def _valid_df(ym: str = "2026-01") -> pd.DataFrame:
    return pd.DataFrame([{
        "year_month": ym,
        "cash_in_m": 0,
        "out_suppliers_m": 0,
        "out_drawings_m": 0,
        "out_refunds_m": 0,
        "out_purchases_m": 0,
        "out_salaries_m": 0,
        "out_other_m": 0,
        "out_siyrafa_m": 0,
        "internal_transfers_m": 0,
        "out_total_operational_m": 0,
        "out_total_comprehensive_m": 0,
        "net_operating_m": 0,
        "net_total_m": 0,
        "cash_running_m": 0,
        "bond_count": 0,
        "fiscal_year": "2025-2026",
    }])


# ---------------------------------------------------------------------------
# 1. Valid table → succeeds and returns row count
# ---------------------------------------------------------------------------

def test_valid_table_succeeds(sqlite_engine):
    """atomic_replace with an allowed table name works and returns row count."""
    df = _valid_df("2026-02")
    rows = atomic_replace(sqlite_engine, "monthly_cashflow", df)
    assert rows == 1


# ---------------------------------------------------------------------------
# 2. Unknown table → ValueError
# ---------------------------------------------------------------------------

def test_unknown_table_raises_value_error(sqlite_engine):
    """atomic_replace with an unknown table name raises ValueError immediately."""
    df = _valid_df()
    with pytest.raises(ValueError, match="refusing to load unknown table"):
        atomic_replace(sqlite_engine, "evil_table", df)


def test_sql_injection_attempt_raises_value_error(sqlite_engine):
    """A table name that looks like SQL injection is also rejected."""
    df = _valid_df()
    with pytest.raises(ValueError, match="refusing to load unknown table"):
        atomic_replace(sqlite_engine, "monthly_cashflow; DROP TABLE users--", df)


# ---------------------------------------------------------------------------
# 3. Invalid date_col → ValueError
# ---------------------------------------------------------------------------

def test_bad_date_col_raises_value_error(sqlite_engine):
    """atomic_replace with date_col != 'snapshot_date' raises ValueError."""
    df = _valid_df()
    with pytest.raises(ValueError, match="invalid date_col"):
        atomic_replace(
            sqlite_engine,
            "monthly_cashflow",
            df,
            date_col="badcol",
            date_val=date(2026, 1, 1),
        )


def test_valid_date_col_snapshot_date_accepted(sqlite_engine):
    """date_col='snapshot_date' is accepted (used for snapshot tables)."""
    # Use installments_summary which has snapshot_date as PK
    df = pd.DataFrame([{
        "snapshot_date": date(2026, 1, 1),
        "premium_count": 1,
        "face_total_m": 100.0,
        "cash_paid_m": 80.0,
        "discount_m": 0.0,
        "remaining_m": 20.0,
    }])
    rows = atomic_replace(
        sqlite_engine,
        "installments_summary",
        df,
        date_col="snapshot_date",
        date_val=date(2026, 1, 1),
    )
    assert rows == 1
