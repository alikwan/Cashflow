"""
ETL load helpers: staging→swap loaders for analytical tables.

Public API
----------
atomic_replace(engine, table, df, *, date_col=None, date_val=None) -> int
    Single-table thin wrapper; opens its own transaction.  Backward-compatible.

load_analytics(engine, frames, snapshot_date) -> int
    Load ALL analytical tables in ONE transaction (fix #2: cross-table atomicity).
    Tables in SNAPSHOT_TABLES get date-keyed replace (fix #3: preserve history).

Internal
--------
_replace_one(conn, table, df, *, date_col=None, date_val=None) -> int
    Does the actual staging→swap within a caller-supplied Connection (no commit).
"""

from __future__ import annotations

from datetime import date

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

# Full set of analytical tables that ETL is permitted to write.
# Defense-in-depth: _replace_one validates `table` against this set before
# executing any SQL — prevents accidental or malicious writes to other tables
# if a caller ever passes user-controlled input.
ALLOWED_TABLES: frozenset[str] = frozenset({
    "monthly_cashflow",
    "per_supplier_monthly",
    "seasonal_index",
    "forecast_base",
    "balances_snapshot",
    "installments_summary",
    "installments_aging",
})

# Tables whose PK includes snapshot_date — we keep prior dates, replacing only
# the row(s) matching today's date.
SNAPSHOT_TABLES: frozenset[str] = frozenset({
    "balances_snapshot",
    "installments_summary",
    "installments_aging",
})


def _replace_one(
    conn: Connection,
    table: str,
    df: pd.DataFrame,
    *,
    date_col: str | None = None,
    date_val: date | None = None,
) -> int:
    """Replace rows in `table` WITHIN the caller's transaction `conn`.

    No commit is issued here — that is the caller's responsibility.

    Strategy (staging → swap):
      1. Write df to {table}_stg via pandas to_sql (participates in same txn).
      2a. If date_col given: DELETE FROM {table} WHERE {date_col} = :d
      2b. Otherwise:         TRUNCATE TABLE {table}
      3.  INSERT INTO {table} (<cols>) SELECT <cols> FROM {table}_stg
      4.  DROP TABLE {table}_stg

    Column names are double-quoted to be safe with reserved words.

    Parameters
    ----------
    conn:
        SQLAlchemy Connection (already inside an open transaction).
    table:
        Destination table name (internal constant — not user input).
    df:
        DataFrame whose columns match (a subset of) the target table columns.
    date_col:
        Name of the date-partition column (e.g. "snapshot_date"). When
        provided, only rows with that date are replaced; prior dates survive.
    date_val:
        The concrete date value to delete/replace.  Required when date_col
        is given.

    Returns
    -------
    int
        Number of rows inserted.
    """
    # --- allow-list validation (defense-in-depth before the API lands) ---
    if table not in ALLOWED_TABLES:
        raise ValueError(f"refusing to load unknown table: {table!r}")
    if date_col is not None and date_col != "snapshot_date":
        raise ValueError(
            f"invalid date_col {date_col!r}: only 'snapshot_date' is permitted"
        )
    # --- end validation ---

    if df.empty:
        return 0

    stg = f"{table}_stg"

    # Step 1 — write staging table inside the same connection/transaction.
    # pandas to_sql with a SQLAlchemy Connection participates in the
    # surrounding transaction in SQLAlchemy 2.x.
    df.to_sql(stg, conn, if_exists="replace", index=False)

    # Build column list (quoted for safety; names are internal constants).
    cols = ", ".join(f'"{c}"' for c in df.columns)

    # Step 2 — clear the target rows for this date or entirely.
    if date_col is not None:
        if date_val is None:
            raise ValueError("date_val must be provided when date_col is set")
        conn.execute(
            text(f"DELETE FROM {table} WHERE {date_col} = :d"),
            {"d": date_val},
        )
    else:
        # TRUNCATE is faster on Postgres; SQLite (used in tests) only supports DELETE.
        dialect = conn.dialect.name
        if dialect == "postgresql":
            conn.execute(text(f"TRUNCATE TABLE {table}"))
        else:
            conn.execute(text(f"DELETE FROM {table}"))

    # Step 3 — copy from staging.
    conn.execute(
        text(f"INSERT INTO {table} ({cols}) SELECT {cols} FROM {stg}")
    )

    # Step 4 — drop staging table.
    conn.execute(text(f"DROP TABLE IF EXISTS {stg}"))

    return len(df)


def load_analytics(
    engine: Engine,
    frames: dict[str, pd.DataFrame],
    snapshot_date: date,
) -> int:
    """Atomically load ALL analytical tables in one transaction.

    This is the primary entry-point for the ETL pipeline.

    * All tables in `frames` are loaded inside a SINGLE ``engine.begin()``
      block — either every table commits or none does (fix #2).
    * Tables listed in SNAPSHOT_TABLES get date-keyed replace: only rows
      matching ``snapshot_date`` are deleted before INSERT, so prior
      snapshot_date values accumulate (fix #3).
    * All other tables are fully replaced (TRUNCATE + INSERT).

    Parameters
    ----------
    engine:
        SQLAlchemy engine connected to the target Postgres database.
    frames:
        Mapping of table_name -> DataFrame.  All 7 analytical tables should
        be present; any subset is also accepted.
    snapshot_date:
        The "today" date used as the date_val for SNAPSHOT_TABLES.

    Returns
    -------
    int
        Total rows loaded across all tables.
    """
    total = 0
    with engine.begin() as conn:
        for table, df in frames.items():
            if table in SNAPSHOT_TABLES:
                total += _replace_one(
                    conn, table, df,
                    date_col="snapshot_date",
                    date_val=snapshot_date,
                )
            else:
                total += _replace_one(conn, table, df)
    return total


def atomic_replace(
    engine: Engine,
    table: str,
    df: pd.DataFrame,
    *,
    date_col: str | None = None,
    date_val: date | None = None,
) -> int:
    """Single-table thin wrapper around _replace_one; opens its own transaction.

    Kept for backward compatibility with existing tests and callers.

    Parameters
    ----------
    engine:
        SQLAlchemy engine connected to the target database.
    table:
        Name of the target table.
    df:
        DataFrame whose columns match the target table columns.
    date_col:
        Optional date-partition column name (see _replace_one).
    date_val:
        Concrete date to replace (required when date_col is set).

    Returns
    -------
    int
        Number of rows loaded.
    """
    with engine.begin() as conn:
        return _replace_one(conn, table, df, date_col=date_col, date_val=date_val)
