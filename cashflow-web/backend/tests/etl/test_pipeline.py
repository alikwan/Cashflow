"""
tests/etl/test_pipeline.py

Two tests:
  (a) Lock unit test — monkeypatches _has_running_etl to True; verifies that
      ETLAlreadyRunning is raised BEFORE any real DB/conn access.
  (b) Full integration test — MSSQL→cashflow_test; skipped if either DB is
      unreachable.  Asserts shape/content invariants across all 7 loaded tables.
"""

from datetime import date

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.config import settings


# ---------------------------------------------------------------------------
# (a) Lock unit test — EXACT per spec
# ---------------------------------------------------------------------------

def test_single_flight_lock(monkeypatch):
    monkeypatch.setattr("app.etl.pipeline._has_running_etl", lambda session: True)
    from app.etl.pipeline import run_etl, ETLAlreadyRunning
    with pytest.raises(ETLAlreadyRunning):
        run_etl(session=object(), conn=object())


# ---------------------------------------------------------------------------
# (b) Integration test helpers
# ---------------------------------------------------------------------------

# cashflow_test lives at the same host/port/user as cashflow, different db name
TEST_URL = settings.postgres_url.rsplit("/", 1)[0] + "/cashflow_test"


@pytest.fixture
def pg_session():
    eng = create_engine(TEST_URL, poolclass=NullPool, future=True)
    Session = sessionmaker(bind=eng, future=True)
    s = Session()
    # Clean the lock so a fresh run can proceed
    s.execute(text("DELETE FROM etl_runs"))
    s.commit()
    yield s
    s.close()
    eng.dispose()


def _mssql():
    """Return an open MSSQL connection, or skip the test if unavailable."""
    try:
        from app.etl.extract import connect_mssql
        c = connect_mssql()
        c.cursor().execute("SELECT 1")
        return c
    except Exception as e:
        pytest.skip(f"MSSQL unavailable: {e}")


# ---------------------------------------------------------------------------
# (b) Full integration test
# ---------------------------------------------------------------------------

def test_full_etl_run_populates_analytics(pg_session):
    conn = _mssql()
    from app.etl.pipeline import run_etl

    run = run_etl(pg_session, conn, today=date(2026, 6, 3))

    assert run.status == "success"

    # ── monthly_cashflow ──────────────────────────────────────────────────
    n_months = pg_session.execute(
        text("SELECT COUNT(*) FROM monthly_cashflow")
    ).scalar()
    assert n_months >= 45, f"Expected ≥45 months, got {n_months}"

    # Siyrafa (Type-7) must be captured — spec §11 regression guard
    siyrafa = pg_session.execute(
        text("SELECT COALESCE(SUM(out_siyrafa_m), 0) FROM monthly_cashflow")
    ).scalar()
    assert float(siyrafa) > 0, "out_siyrafa_m is 0 — Type-7 bonds were dropped!"

    # Sanity check on total receipts (multi-year)
    cash_in_total = pg_session.execute(
        text("SELECT SUM(cash_in_m) FROM monthly_cashflow")
    ).scalar()
    assert float(cash_in_total) > 3000, (
        f"cash_in total {cash_in_total} looks too low — expected >3000 M"
    )

    # ── installments_summary ──────────────────────────────────────────────
    rem = pg_session.execute(
        text("SELECT remaining_m FROM installments_summary")
    ).scalar()
    assert float(rem) > 1000, f"remaining_m={rem} — expected >1000 M"

    # ── per_supplier_monthly ──────────────────────────────────────────────
    assert (
        pg_session.execute(
            text("SELECT COUNT(*) FROM per_supplier_monthly")
        ).scalar()
        > 0
    )

    # ── remaining analytical tables loaded (complete coverage) ────────────
    for tbl in ("forecast_base", "seasonal_index", "balances_snapshot", "installments_aging"):
        cnt = pg_session.execute(text(f"SELECT COUNT(*) FROM {tbl}")).scalar()
        assert cnt > 0, f"{tbl} has no rows after ETL"

    # aging must sum to a sane figure (close to remaining, minus the ~56M known gap)
    aging_sum = pg_session.execute(
        text("SELECT COALESCE(SUM(amount_m),0) FROM installments_aging")
    ).scalar()
    assert float(aging_sum) > 1000, f"aging sum {aging_sum} too low"

    conn.close()
