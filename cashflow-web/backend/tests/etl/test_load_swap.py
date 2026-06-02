import pandas as pd
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool
from app.config import settings
from app.db.base import Base
import app.db.models  # noqa: F401
from app.etl.load import atomic_replace

TEST_URL = settings.postgres_url.rsplit("/", 1)[0] + "/cashflow_test"

def _row(ym):
    # every NOT-NULL monthly_cashflow column (amounts default-less at DB level)
    cols = ["cash_in_m","out_suppliers_m","out_drawings_m","out_refunds_m","out_purchases_m",
            "out_salaries_m","out_other_m","out_siyrafa_m","internal_transfers_m",
            "out_total_operational_m","out_total_comprehensive_m","net_operating_m",
            "net_total_m","cash_running_m"]
    r = {c: 0 for c in cols}
    r.update(year_month=ym, bond_count=0, fiscal_year="2025-2026")
    return r

@pytest.fixture
def engine():
    eng = create_engine(TEST_URL, poolclass=NullPool, future=True)
    Base.metadata.create_all(eng)
    yield eng
    with eng.begin() as c:
        c.execute(text("DROP TABLE IF EXISTS monthly_cashflow_stg"))
        c.execute(text("TRUNCATE TABLE monthly_cashflow"))
    eng.dispose()

def test_atomic_replace_swaps_in_one_txn(engine):
    atomic_replace(engine, "monthly_cashflow", pd.DataFrame([_row("2026-01")]))
    atomic_replace(engine, "monthly_cashflow", pd.DataFrame([_row("2026-02")]))
    with engine.connect() as c:
        rows = c.execute(text("SELECT year_month FROM monthly_cashflow")).scalars().all()
    assert rows == ["2026-02"]   # full replace, no leftover from the first load
