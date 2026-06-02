"""
Pure arithmetic helpers for cash-flow reconciliation.

No SQL, no I/O — stdlib only.
"""

from __future__ import annotations


def running_balance(
    opening_m: float,
    monthly_nets: list[tuple[str, float]],
) -> dict[str, float]:
    """Compute running balance anchored to an opening cash position.

    Iterates `monthly_nets` in the given order (no re-sorting).
    Each entry is ``(year_month, net_m)``.

    Returns a dict ``{year_month: balance_after_that_month}``.

    Example::

        running_balance(100.0, [("2026-01", 5.0), ("2026-02", -2.0)])
        # -> {"2026-01": 105.0, "2026-02": 103.0}
    """
    result: dict[str, float] = {}
    balance = opening_m
    for year_month, net in monthly_nets:
        balance += net
        result[year_month] = balance
    return result


def reconciliation_residual(
    actual_delta_m: float,
    classified_net_sum_m: float,
) -> float:
    """Return the unexplained gap between actual and classified cash movement.

    ``actual_delta_m``       — closing cash minus opening cash (from bank/box snapshot).
    ``classified_net_sum_m`` — sum of all IN minus OUT as classified by the ETL.

    A positive residual means cash appeared that the ETL did not account for;
    a negative residual means the ETL over-counted net inflows.
    """
    return actual_delta_m - classified_net_sum_m
