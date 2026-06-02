"""
Migration tests — always run against the dedicated `cashflow_test` DB,
never the dev `cashflow` DB, regardless of .env or POSTGRES_DB env var.

Three tests:
  1. upgrade/downgrade/upgrade cycle is idempotent.
  2. no model↔migration drift (compare_metadata is empty).
  3. the assumptions partial-unique indexes are functionally enforced:
     exactly one global row (scenario_id IS NULL) is allowed.
"""
import pathlib

import pytest
from alembic.config import Config
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool

from app.config import settings
from app.db.base import Base
import app.db.models  # noqa: F401 — registers all 20 tables on Base.metadata

# -----------------------------------------------------------------------
# Always use the dedicated test DB — never churn the dev DB.
# -----------------------------------------------------------------------
TEST_URL = settings.postgres_url.rsplit("/", 1)[0] + "/cashflow_test"

# alembic.ini lives in backend/ (one level above tests/). Anchor to it so the
# tests work regardless of the pytest invocation directory.
_BACKEND = pathlib.Path(__file__).resolve().parent.parent


def _cfg() -> Config:
    """Return an Alembic Config (anchored to backend/alembic.ini) with the test DB URL.

    The URL is passed via config.attributes (NOT set_main_option) so it bypasses
    configparser's BasicInterpolation — a password containing '%' won't break it.
    """
    c = Config(str(_BACKEND / "alembic.ini"))
    c.attributes["sqlalchemy.url"] = TEST_URL
    return c


# -----------------------------------------------------------------------
# Autouse fixture: reset to clean head before every test.
# -----------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _fresh_schema():
    # Safety guard: the first action below is a destructive `downgrade base`.
    # Refuse to run unless we're truly pointed at the throwaway test DB.
    assert TEST_URL.endswith("/cashflow_test"), f"Refusing to wipe a non-test DB: {TEST_URL}"
    cfg = _cfg()
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield


# -----------------------------------------------------------------------
# Tests
# -----------------------------------------------------------------------

def test_upgrade_downgrade_cycle_idempotent():
    """upgrade→downgrade→upgrade must complete without error."""
    cfg = _cfg()
    command.upgrade(cfg, "head")     # head (already there from fixture, idempotent)
    command.downgrade(cfg, "base")   # drop everything
    command.upgrade(cfg, "head")     # re-apply


def test_no_model_migration_drift():
    """
    compare_metadata must return an empty diff after `upgrade head`.

    Note: autogenerate emits the uq_assumptions_global expression index as
    `literal_column('(scenario_id IS NULL)')`, which Postgres normalises to
    `(((scenario_id IS NULL)))` in pg_indexes.  Empirical testing confirmed
    that compare_metadata sees NO drift for either assumptions partial index
    with this encoding, so no include_object exclusion is needed.
    If a future Alembic version regresses this, the diff will surface here
    and should be fixed in the migration — not masked.
    """
    engine = create_engine(TEST_URL, poolclass=NullPool, future=True)
    try:
        with engine.connect() as conn:
            mc = MigrationContext.configure(conn)
            diff = compare_metadata(mc, Base.metadata)
        assert diff == [], (
            f"Model↔migration drift detected ({len(diff)} item(s)):\n"
            + "\n".join(f"  {item}" for item in diff)
        )
    finally:
        engine.dispose()


def test_assumptions_partial_unique_enforced():
    """
    The uq_assumptions_global partial unique index must prevent a second
    row with scenario_id IS NULL (the global-singleton invariant).
    """
    engine = create_engine(TEST_URL, poolclass=NullPool, future=True)
    try:
        with engine.begin() as conn:
            # Start clean (fixture already reset, but delete for safety).
            conn.execute(text("DELETE FROM assumptions WHERE scenario_id IS NULL"))
            # Insert the first global row — must succeed.
            conn.execute(
                text(
                    "INSERT INTO assumptions (usd_rate, updated_at) "
                    "VALUES (1350, NOW())"
                )
            )

        # Inserting a second global row must violate the partial unique index.
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO assumptions (usd_rate, updated_at) "
                        "VALUES (1400, NOW())"
                    )
                )
    finally:
        engine.dispose()
