"""
Shared test fixtures for the cashflow-web API test suite.

Design rules:
- `_testing_session` owns the engine and sessionmaker; it is tmp_path-scoped
  so each test function gets a fresh SQLite DB (no cross-test bleed).
- `client`, `seed_user`, and `auth` all share the same `_testing_session`
  instance so rows committed by seed_user are visible to request sessions.
- The `client` fixture does NOT enter the TestClient as a context manager —
  this intentionally prevents the FastAPI lifespan from running, keeping the
  owner-seeding side-effect out of tests.
- `seed_analytics` and `seed_alerts` are available for read-endpoint tests (C1+).
"""
from datetime import datetime, date, timezone, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
import app.db.models  # noqa: F401 — register all tables on Base.metadata


@pytest.fixture
def _testing_session(tmp_path):
    """Fresh SQLite engine + sessionmaker; shared by client/seed_user/auth."""
    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}", future=True)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng, autoflush=False, future=True)


@pytest.fixture
def client(_testing_session):
    """TestClient backed by the shared in-memory DB."""
    from app.main import create_app
    from app.api.deps import get_session

    app = create_app()

    def _override():
        db = _testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_session] = _override
    return TestClient(app)


@pytest.fixture
def seed_user(_testing_session):
    """Insert owner/secret user directly (no dependency on seed_owner_user logic)."""
    from app.db.models import User
    from app.api.auth import hash_password

    s = _testing_session()
    try:
        s.add(User(
            username="owner",
            password_hash=hash_password("secret"),
            display_name="المالك",
            is_active=True,
        ))
        s.commit()
    finally:
        s.close()


@pytest.fixture
def auth(client, seed_user):
    """Return cookies dict after a successful login (used by future endpoint tests)."""
    client.post("/api/auth/login", json={"username": "owner", "password": "secret"})
    return {"session": client.cookies["session"]}


# ---------------------------------------------------------------------------
# Analytical seed fixtures (C1 and later read-endpoint tasks)
# ---------------------------------------------------------------------------

def _ym(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def _fiscal_year_label(ym: str) -> str:
    """Mirror app.domain.forecast.fiscal_year_label (avoid import cycle in tests)."""
    y, m = map(int, ym.split("-"))
    s = y if m >= 5 else y - 1
    return f"{s}-{s+1}"


@pytest.fixture
def seed_analytics(_testing_session):
    """
    Insert a realistic but minimal analytical dataset covering two complete
    fiscal years (2022-05 → 2024-04, i.e. FY2022-2023 + FY2023-2024), plus
    one InstallmentsSummary row and one successful EtlRun.

    24 MonthlyCashflow rows:
      FY2022-2023: 2022-05 → 2023-04  (12 rows)
      FY2023-2024: 2023-05 → 2024-04  (12 rows)

    net_total_m is higher in FY1 than FY2 so net_decline_pct > 0 (testable).
    cash_running_m grows monotonically from 60 → 200 (last row = 200.0).

    C2/C3 extensions: add BalancesSnapshot, ForecastBase, SeasonalIndex,
    PerSupplierMonthly rows in those tasks' own fixtures — this fixture is
    intentionally kept to what C1 needs plus a global Assumption row.
    """
    from app.db.models import (
        Assumption, EtlRun, InstallmentsSummary, MonthlyCashflow,
    )
    from app.domain.forecast import fiscal_year_label

    s = _testing_session()
    try:
        # --- Global assumptions row -----------------------------------------
        s.add(Assumption(
            scenario_id=None,
            usd_rate=Decimal("1350"),
            unexpected_reserve_m=Decimal("15"),
            fiscal_year_start_month=5,
            forecast_horizon=12,
        ))

        # --- 24 MonthlyCashflow rows ----------------------------------------
        # Plausible per-month values (millions of IQD):
        #   FY1 net = 120M total, FY2 net = 36M total  → net_decline_pct = 0.7
        # cash_running_m = 60 at start, runs up monotonically.
        # Build the exact 24 months in order: 2022-05..2023-04, 2023-05..2024-04
        ordered = []
        for y, m in [(2022, mo) for mo in range(5, 13)] + \
                    [(2023, mo) for mo in range(1, 13)] + \
                    [(2024, mo) for mo in range(1, 5)]:
            ordered.append(f"{y}-{m:02d}")
        assert len(ordered) == 24

        # Per-month values — FY1 (first 12) has higher net than FY2 (last 12)
        running = Decimal("60")
        for i, ym in enumerate(ordered):
            fy = fiscal_year_label(ym)
            # FY1 months: in=110M, out=100M, net=10M each → FY1 net=120M
            # FY2 months: in=108M, out=103M, net=5M each  → FY2 net=60M
            in_m = Decimal("110") if i < 12 else Decimal("108")
            out_sup  = Decimal("20") if i < 12 else Decimal("20")
            out_draw = Decimal("40") if i < 12 else Decimal("43")
            out_ref  = Decimal("5")
            out_pur  = Decimal("10") if i < 12 else Decimal("11")
            out_sal  = Decimal("10")
            out_siy  = Decimal("10") if i < 12 else Decimal("11")
            out_oth  = Decimal("5")
            out_op   = out_sup + out_draw + out_ref + out_pur + out_sal + out_oth
            out_comp = out_op + out_siy
            net_op   = in_m - out_op
            net_tot  = in_m - out_comp
            running += net_tot

            s.add(MonthlyCashflow(
                year_month=ym,
                fiscal_year=fy,
                cash_in_m=in_m,
                out_suppliers_m=out_sup,
                out_drawings_m=out_draw,
                out_refunds_m=out_ref,
                out_purchases_m=out_pur,
                out_salaries_m=out_sal,
                out_other_m=out_oth,
                out_siyrafa_m=out_siy,
                internal_transfers_m=Decimal("5"),
                out_total_operational_m=out_op,
                out_total_comprehensive_m=out_comp,
                net_operating_m=net_op,
                net_total_m=net_tot,
                cash_running_m=running,
                bond_count=500 + i * 10,
            ))

        # --- InstallmentsSummary row (real-world magnitudes from §6) --------
        s.add(InstallmentsSummary(
            snapshot_date=date(2024, 4, 30),
            premium_count=8500,
            face_total_m=Decimal("7122"),
            cash_paid_m=Decimal("5648"),
            discount_m=Decimal("159"),
            remaining_m=Decimal("1315"),
        ))

        # --- EtlRun row (latest successful run) -----------------------------
        # Note: EtlRun.id is BigInteger (bigserial in Postgres). SQLite does
        # not auto-increment BigInteger PKs the same way, so we supply id=1.
        now = datetime.now(timezone.utc)
        s.add(EtlRun(
            id=1,
            started_at=now - timedelta(minutes=2),
            finished_at=now - timedelta(minutes=1),
            status="success",
            rows_loaded=24,
            usd_rate_used=Decimal("1350"),
            reconciliation_residual_m=Decimal("0"),
            source_tz="Asia/Baghdad",
        ))

        s.commit()
    finally:
        s.close()


@pytest.fixture
def seed_alerts(_testing_session):
    """
    Insert 3 Alert rows with varied statuses:
      - 'new'      (active, newest)
      - 'read'     (active, older)
      - 'resolved' (inactive, oldest)

    Dashboard's active-filter test checks that 'resolved' is excluded and
    that at least one active alert appears. Alerts ordered newest-first by
    generated_at is also verifiable.
    """
    from app.db.models import Alert

    s = _testing_session()
    try:
        now = datetime.now(timezone.utc)
        s.add(Alert(
            alert_type="net_negative",
            severity="danger",
            title="أول صافي شهري سالب",
            body="شباط 2026 سجّل صافياً سالباً −14.6 مليون د.ع",
            related_key="2026-02",
            status="new",
            generated_at=now - timedelta(hours=1),
        ))
        s.add(Alert(
            alert_type="net_decline",
            severity="warning",
            title="تراجع الصافي السنوي 51%",
            body="صافي السيولة هبط بين 2024 و2026",
            related_key=None,
            status="read",
            generated_at=now - timedelta(hours=3),
        ))
        s.add(Alert(
            alert_type="expense_velocity",
            severity="info",
            title="المصروفات تنمو أسرع",
            body="المصروفات نمت بنحو 2.4× وتيرة المقبوضات",
            related_key=None,
            status="resolved",
            generated_at=now - timedelta(hours=6),
        ))
        s.commit()
    finally:
        s.close()
