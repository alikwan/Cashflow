"""
app/etl/extract.py — Read-only extraction layer for AlBaytAlSaeid SQL Server.

Each fetch_* function accepts an injected pymssql connection (read-only user)
and returns a pandas DataFrame. No writes, no retries, no caching.

CRITICAL accounting rules (from CLAUDE.md):
- Amount1 is ALWAYS in IQD — NEVER multiply by Rate1.
- Always filter Deleted=0 AND ISNULL(IsEdit,0)=0.
- PremiumPays.Amount = REMAINING balance (NOT paid amount) — DC-System formula.
"""

import logging
from datetime import datetime, date
from zoneinfo import ZoneInfo

import pandas as pd
import pymssql  # noqa: F401 — type hint only at runtime

from app.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Timezone helpers
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    """Return the current UTC datetime. Isolated so tests can monkeypatch it."""
    return datetime.now(ZoneInfo("UTC"))


def baghdad_today() -> date:
    """Return today's date in Asia/Baghdad (UTC+3)."""
    return _utcnow().astimezone(ZoneInfo("Asia/Baghdad")).date()


# ---------------------------------------------------------------------------
# Connection helper
# ---------------------------------------------------------------------------

def connect_mssql():
    """Open a pymssql connection using the read-only cashflow_ro credentials."""
    return pymssql.connect(
        server=settings.mssql_host,
        port=int(settings.mssql_port),
        user=settings.mssql_readonly_user,
        password=settings.mssql_readonly_password,
        database=settings.mssql_db,
        login_timeout=10,
        timeout=60,
    )


# ---------------------------------------------------------------------------
# SQL constants
# ---------------------------------------------------------------------------

_SQL_BONDS = """\
SELECT
    FORMAT(b.Date, 'yyyy-MM')       AS year_month,
    b.OperationsType,
    b.Amount1,
    b.Currency1Id,
    at.AccountTypeId                AS to_type,
    af.AccountTypeId                AS from_type
FROM Bonds b
INNER JOIN accounts at ON at.AccountId = b.AccountToId
LEFT  JOIN accounts af ON af.AccountId = b.AccountFromId
WHERE b.Deleted = 0
  AND ISNULL(b.IsEdit, 0) = 0
  AND b.Date >= %(start)s
  AND b.Date <  %(end_exclusive)s
"""

_SQL_AVG_USD_RATE = """\
SELECT AVG(Rate1) AS avg_rate
FROM Bonds
WHERE Deleted = 0
  AND Currency1Id = 2
  AND Rate1 > 0
  AND Date >= DATEADD(MONTH, -12, %(asof)s)
  AND Date <  %(asof)s
"""

_SQL_INSTALLMENTS_SUMMARY = """\
SELECT
    COUNT(*)                                                                          AS premium_count,
    SUM(p.TotalAmount) / 1000000.0                                                   AS face_total_m,
    SUM(ISNULL(inst.TotalCashPaid,  0)) / 1000000.0                                 AS cash_paid_m,
    SUM(ISNULL(inst.TotalDiscount,  0)) / 1000000.0                                 AS discount_m,
    SUM(
        CASE
            WHEN p.TotalAmount
                 - ISNULL(inst.TotalCashPaid, 0)
                 - ISNULL(inst.TotalDiscount, 0) < 0
            THEN 0
            ELSE p.TotalAmount
                 - ISNULL(inst.TotalCashPaid, 0)
                 - ISNULL(inst.TotalDiscount, 0)
        END
    ) / 1000000.0                                                                    AS remaining_m
FROM Premiums p
OUTER APPLY (
    SELECT
        SUM(per.cash) AS TotalCashPaid,
        SUM(per.disc) AS TotalDiscount
    FROM (
        SELECT
            CASE WHEN pp.DatePay > '1900-01-02'
                 THEN CASE WHEN p.PremiumPayAmount
                                - ISNULL(pp.Amount,   0)
                                - ISNULL(pp.Discount, 0) > 0
                           THEN p.PremiumPayAmount
                                - ISNULL(pp.Amount,   0)
                                - ISNULL(pp.Discount, 0)
                           ELSE 0
                      END
                 ELSE 0
            END AS cash,
            CASE WHEN pp.PremiumState IN (3, 4)
                 THEN (
                     p.PremiumPayAmount
                     - CASE WHEN pp.DatePay > '1900-01-02'
                            THEN CASE WHEN p.PremiumPayAmount
                                           - ISNULL(pp.Amount,   0)
                                           - ISNULL(pp.Discount, 0) > 0
                                      THEN p.PremiumPayAmount
                                           - ISNULL(pp.Amount,   0)
                                           - ISNULL(pp.Discount, 0)
                                      ELSE 0
                                 END
                            ELSE 0
                       END
                 )
                 ELSE ISNULL(pp.Discount, 0)
            END AS disc
        FROM PremiumPays pp
        WHERE pp.PremiumId = p.Id
          AND pp.Deleted   = 0
    ) per
) inst
WHERE p.Deleted = 0
"""

_SQL_PER_SUPPLIER_MONTHLY_TMPL = """\
WITH Sup(AccountId) AS (
    SELECT * FROM (VALUES {values}) v(AccountId)
)
SELECT
    s.AccountId                                    AS supplier_account_id,
    FORMAT(b.Date, 'yyyy-MM')                      AS year_month,
    SUM(CASE WHEN b.AccountToId   = s.AccountId
             THEN b.Amount1 ELSE 0 END) / 1000000.0  AS paid_m,
    SUM(CASE WHEN b.AccountToId   = s.AccountId
              AND b.Currency1Id   = 1
             THEN b.Amount1 ELSE 0 END) / 1000000.0  AS paid_iqd_m,
    SUM(CASE WHEN b.AccountToId   = s.AccountId
              AND b.Currency1Id   = 2
              AND b.Rate1         > 0
             THEN b.Amount1 / b.Rate1 ELSE 0 END) / 1000000.0 AS paid_usd_m,
    SUM(CASE WHEN b.AccountFromId = s.AccountId
             THEN b.Amount1 ELSE 0 END) / 1000000.0  AS recv_m
FROM Sup s
JOIN Bonds b
    ON (b.AccountFromId = s.AccountId OR b.AccountToId = s.AccountId)
   AND b.Deleted          = 0
   AND ISNULL(b.IsEdit, 0) = 0
   AND b.Date             >= %(start)s
   AND b.Date             <  %(end_exclusive)s
GROUP BY s.AccountId, FORMAT(b.Date, 'yyyy-MM')
ORDER BY s.AccountId, year_month
"""

_SQL_INSTALLMENTS_AGING = """\
SELECT bucket_key,
       SUM(outstanding) / 1000000.0 AS amount_m,
       COUNT(*)                      AS cnt
FROM (
    SELECT
        CASE
            WHEN pp.Date > %(asof)s                            THEN 'not_due'
            WHEN DATEDIFF(day, pp.Date, %(asof)s) <= 30       THEN 'b0_30'
            WHEN DATEDIFF(day, pp.Date, %(asof)s) <= 60       THEN 'b31_60'
            WHEN DATEDIFF(day, pp.Date, %(asof)s) <= 90       THEN 'b61_90'
            WHEN DATEDIFF(day, pp.Date, %(asof)s) <= 120      THEN 'b91_120'
            ELSE                                                    'b120'
        END AS bucket_key,
        pp.Amount AS outstanding
    FROM PremiumPays pp
    INNER JOIN Premiums p ON p.Id = pp.PremiumId AND p.Deleted = 0
    WHERE pp.Deleted         = 0
      AND pp.Amount          > 0
      AND pp.PremiumState NOT IN (3, 4)
) x
GROUP BY bucket_key
"""


# ---------------------------------------------------------------------------
# Fetch functions
# ---------------------------------------------------------------------------

def fetch_bonds(conn, start: str, end_exclusive: str) -> pd.DataFrame:
    """
    Return raw bond rows for the given date window (ISO strings 'YYYY-MM-DD').
    ~100k–150k rows for a 48-month window; classify_monthly aggregates them.
    """
    return pd.read_sql(_SQL_BONDS, conn, params={"start": start, "end_exclusive": end_exclusive})


def fetch_balances(conn, account_type_ids: list[int]) -> pd.DataFrame:
    """
    Balances snapshot for the given account type IDs.
    account_type_ids must be a non-empty list of ints (validated, not user input).
    """
    if not account_type_ids:
        raise ValueError("account_type_ids must be non-empty")
    # Expand ints directly — these are not user input, so no injection risk.
    ids_str = ", ".join(str(int(i)) for i in account_type_ids)
    sql = f"""\
SELECT
    a.AccountId                          AS account_id,
    a.Name                               AS account_name,
    a.AccountTypeId                      AS account_type_id,
    ta.CurrencyId                        AS currency_id,
    ta.Balance / 1000000.0               AS balance_m,
    ta.LastActive                        AS last_active
FROM accounts a
INNER JOIN tAccounts ta ON ta.AccountId = a.AccountId
WHERE a.Deleted = 0
  AND a.AccountTypeId IN ({ids_str})
"""
    return pd.read_sql(sql, conn)


def fetch_avg_usd_rate(conn, asof: date) -> float:
    """
    Average USD exchange rate (Rate1 where Currency1Id=2) over the 12 months
    before `asof`. Returns 1350.0 if no data.
    """
    df = pd.read_sql(_SQL_AVG_USD_RATE, conn, params={"asof": asof.isoformat()})
    val = df["avg_rate"].iloc[0] if not df.empty else None
    # AVG over an empty window yields a single NULL row → pandas NaN (not None);
    # pd.isna catches both so the fallback isn't silently returned as NaN.
    if val is None or pd.isna(val):
        logger.warning(
            "fetch_avg_usd_rate: no USD bonds with a rate in the 12 months before %s; "
            "using fallback 1350.0", asof.isoformat(),
        )
        return 1350.0
    return float(val)


def fetch_installments_summary(conn) -> pd.DataFrame:
    """
    One-row DataFrame with DC-System formula aggregated across all non-deleted
    contracts: face_total_m, cash_paid_m, discount_m, remaining_m (millions IQD).
    """
    return pd.read_sql(_SQL_INSTALLMENTS_SUMMARY, conn)


def fetch_installments_aging(conn, asof: date) -> pd.DataFrame:
    """
    Per-bucket outstanding installments as of `asof`.
    Buckets: not_due, b0_30, b31_60, b61_90, b91_120, b120.
    Columns: bucket_key, amount_m, cnt.
    """
    return pd.read_sql(_SQL_INSTALLMENTS_AGING, conn, params={"asof": asof.isoformat()})


def fetch_per_supplier_monthly(
    conn,
    supplier_account_ids: list[int],
    start: str,
    end_exclusive: str,
) -> pd.DataFrame:
    """
    Monthly payments to / receipts from each supplier for the given date window.

    Parameters
    ----------
    conn :
        Injected pymssql connection (read-only).
    supplier_account_ids :
        List of integer AccountIds for the suppliers to include (the 14 main
        distributors or any subset).  These are trusted ints — never user input.
    start, end_exclusive :
        ISO date strings 'YYYY-MM-DD' bounding the window (start inclusive,
        end_exclusive exclusive).

    Returns
    -------
    DataFrame with columns:
        supplier_account_id  int     — MSSQL AccountId (no FK on this side)
        year_month           str     — 'YYYY-MM'
        paid_m               float   — Σ Amount1 paid TO supplier  / 1e6  (IQD M)
        paid_iqd_m           float   — same, Currency1Id=1 only     / 1e6
        paid_usd_m           float   — Amount1/Rate1 paid TO supplier
                                       where Currency1Id=2 & Rate1>0 / 1e6 (USD M)
        recv_m               float   — Σ Amount1 received FROM supplier / 1e6

    CRITICAL: Amount1 is always IQD — NEVER multiply by Rate1.  paid_usd_m uses
    Amount1/Rate1 to express dollar-denominated bonds in their native currency.
    """
    if not supplier_account_ids:
        raise ValueError("supplier_account_ids must be non-empty")

    # Build VALUES list from trusted ints — not user input, no injection risk.
    values_str = ", ".join(f"({int(sid)})" for sid in supplier_account_ids)
    sql = _SQL_PER_SUPPLIER_MONTHLY_TMPL.format(values=values_str)

    return pd.read_sql(
        sql,
        conn,
        params={"start": start, "end_exclusive": end_exclusive},
    )
