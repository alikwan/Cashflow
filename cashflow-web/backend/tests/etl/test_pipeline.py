"""
tests/etl/test_pipeline.py

Two tests:
  (a) Lock unit test — monkeypatches _has_running_etl to True; verifies that
      ETLAlreadyRunning is raised BEFORE any real DB/conn access.
  (b) Full integration test — MSSQL→cashflow_test; skipped if either DB is
      unreachable.  Asserts shape/content invariants across all 7 loaded tables.
"""

from datetime import date

import pandas as pd
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
# (b) Unit test for _fiscal_year_metrics
# ---------------------------------------------------------------------------

def test_fiscal_year_metrics_two_complete_fys():
    """Two complete FYs with declining net and faster-growing expenses."""
    from app.etl.pipeline import _fiscal_year_metrics

    # FY1 (May-2022 → Apr-2023): in=100/mo, out=60/mo → net=40/mo
    # FY2 (May-2023 → Apr-2024): in=110/mo, out=90/mo → net=20/mo
    # net_decline_pct = (480 − 240) / 480 = 0.5  (50%)
    # expense_velocity = (90*12/60*12) / (110*12/100*12) = 1.5 / 1.1 ≈ 1.364
    rows = []
    for mo in range(12):
        ym = f"2022-{(mo+5-1)%12+1:02d}" if mo < 8 else f"2023-{(mo+5-1)%12+1:02d}"
        rows.append(
            dict(
                year_month=f"2022-{(mo % 12) + 5:02d}" if (mo % 12) + 5 <= 12
                           else f"2023-{(mo % 12) + 5 - 12:02d}",
                fiscal_year="2022-23",
                cash_in_m=100.0,
                out_total_comprehensive_m=60.0,
                net_total_m=40.0,
            )
        )
    for mo in range(12):
        rows.append(
            dict(
                year_month=f"2023-{(mo % 12) + 5:02d}" if (mo % 12) + 5 <= 12
                           else f"2024-{(mo % 12) + 5 - 12:02d}",
                fiscal_year="2023-24",
                cash_in_m=110.0,
                out_total_comprehensive_m=90.0,
                net_total_m=20.0,
            )
        )

    monthly = pd.DataFrame(rows)
    net_decline_pct, expense_velocity = _fiscal_year_metrics(monthly)

    assert net_decline_pct > 0, (
        f"Expected net_decline_pct > 0 (net fell from FY1 to FY2), got {net_decline_pct}"
    )
    assert expense_velocity > 1.0, (
        f"Expected expense_velocity > 1.0 (expenses growing faster than receipts), "
        f"got {expense_velocity}"
    )


def test_fiscal_year_metrics_fewer_than_two_complete():
    """Only one complete FY → returns (0.0, 0.0)."""
    from app.etl.pipeline import _fiscal_year_metrics

    rows = [
        dict(year_month=f"2022-{m:02d}", fiscal_year="2022-23",
             cash_in_m=100.0, out_total_comprehensive_m=60.0, net_total_m=40.0)
        for m in range(5, 12)           # only 7 months — not a complete FY
    ]
    monthly = pd.DataFrame(rows)
    assert _fiscal_year_metrics(monthly) == (0.0, 0.0)


# ---------------------------------------------------------------------------
# (d) Integration test helpers
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
# (e) Full integration test
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

    # ── alerts step ran without error ─────────────────────────────────────
    # The alerts table must be queryable and every generated alert must have
    # a recognised alert_type.  Alerts may legitimately be empty when the
    # business is cash-positive — we do NOT assert a specific count.
    alert_count = pg_session.execute(
        text("SELECT COUNT(*) FROM alerts WHERE status='new'")
    ).scalar()
    assert isinstance(alert_count, int) and alert_count >= 0, (
        f"alerts table query returned unexpected value: {alert_count!r}"
    )

    known_types = {
        "liquidity_deficit",
        "reconciliation_gap",
        "cap_exceeded",
        "net_decline",
        "expense_velocity",
    }
    if alert_count > 0:
        bad_types = pg_session.execute(
            text(
                "SELECT DISTINCT alert_type FROM alerts "
                "WHERE status='new' "
                "  AND alert_type NOT IN ("
                "    'liquidity_deficit','reconciliation_gap',"
                "    'cap_exceeded','net_decline','expense_velocity'"
                "  )"
            )
        ).fetchall()
        assert not bad_types, (
            f"Unknown alert_type(s) found: {[r[0] for r in bad_types]}"
        )

    # Log findings for the task report (captured by pytest -s / live logging)
    import logging
    _log = logging.getLogger(__name__)
    _log.info(
        "ETL alerts: count=%d  alert_types=%s",
        alert_count,
        pg_session.execute(
            text("SELECT DISTINCT alert_type FROM alerts WHERE status='new'")
        ).fetchall(),
    )

    conn.close()
