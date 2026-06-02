"""
atomic_replace: staging -> swap loader.

Fully replaces a table's contents with a DataFrame, atomically:
  1. Write df to {table}_stg (via pandas to_sql, non-transactional staging write).
  2. In ONE transaction: TRUNCATE {table}; INSERT INTO {table} SELECT FROM {table}_stg.
  3. Drop {table}_stg.

Returns the number of rows loaded.
"""

from __future__ import annotations

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine


def atomic_replace(engine: Engine, table: str, df: pd.DataFrame) -> int:
    """Replace all rows in `table` with the contents of `df`, atomically.

    Parameters
    ----------
    engine:
        SQLAlchemy engine connected to the target database.
    table:
        Name of the target table (internal constant, not user input).
    df:
        DataFrame whose columns match (a subset of) the target table columns.

    Returns
    -------
    int
        Number of rows loaded.
    """
    stg = f"{table}_stg"

    # Step 1 — write staging table (outside any transaction; if_exists="replace"
    # creates or overwrites the stg table, including schema inference).
    df.to_sql(stg, engine, if_exists="replace", index=False)

    # Build column list from df (quoted for safety, though names are internal).
    cols = ", ".join(f'"{c}"' for c in df.columns)

    # Step 2 — atomic swap in a single transaction.
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE TABLE {table}"))
        conn.execute(text(f"INSERT INTO {table} ({cols}) SELECT {cols} FROM {stg}"))

    # Step 3 — drop staging table after commit.
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {stg}"))

    return len(df)
