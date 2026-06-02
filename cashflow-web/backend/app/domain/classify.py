import pandas as pd

M = 1_000_000.0
def _sum(df, mask): return float(df.loc[mask, "Amount1"].sum()) / M

def classify_monthly(bonds: pd.DataFrame) -> pd.DataFrame:
    """bonds: صفوف خام تحوي year_month, OperationsType, Amount1, to_type, from_type, Currency1Id.
    يُعيد صفاً لكل شهر بالفئات والمنظورين A/C."""
    out = []
    for ym, g in bonds.groupby("year_month"):
        cash_in   = _sum(g, g.OperationsType == 0)
        suppliers = _sum(g, (g.OperationsType == 1) & (g.to_type == 2614))
        drawings  = _sum(g, (g.OperationsType == 1) & (g.to_type == 2518))
        refunds   = _sum(g, (g.OperationsType == 1) & (g.to_type == 1631))
        purchases = _sum(g, (g.OperationsType == 5) & (g.to_type == 3110))
        salaries  = _sum(g, (g.OperationsType == 5) & (g.to_type == 3121))
        other     = _sum(g, (g.OperationsType == 5) & (g.to_type.isin([3124, 2110])))
        siyrafa   = _sum(g, g.OperationsType == 7)
        internal  = _sum(g, g.OperationsType == 3)
        op  = suppliers + drawings + refunds + purchases + salaries + other
        comp = op + siyrafa
        out.append(dict(
            year_month=ym, cash_in_m=cash_in, out_suppliers_m=suppliers,
            out_drawings_m=drawings, out_refunds_m=refunds, out_purchases_m=purchases,
            out_salaries_m=salaries, out_other_m=other, out_siyrafa_m=siyrafa,
            internal_transfers_m=internal, out_total_operational_m=op,
            out_total_comprehensive_m=comp, net_operating_m=cash_in - op,
            net_total_m=cash_in - comp, bond_count=int(len(g))))
    return pd.DataFrame(out).sort_values("year_month").reset_index(drop=True)
