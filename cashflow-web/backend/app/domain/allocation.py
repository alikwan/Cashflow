def compute_pool(forecast_in, salaries, purchases, refunds, partners, siyrafa, reserve):
    return max(0.0, forecast_in - salaries - purchases - refunds - partners - siyrafa - reserve)

def allocate_dinar(pool_m: float, suppliers: list[dict]) -> dict:
    """يوزّع pool على موردي الدينار فقط (currency != 'USD') حسب الحصة، يطبّق السقف،
    يعيد توزيع الفائض على غير المكتمِلين، ويُخرج leftover. الدولاريون allocated=0."""
    dinar = [s for s in suppliers if s["currency"] != "USD"]
    wsum = sum(s["share"] for s in dinar) or 1.0
    alloc = {s["id"]: pool_m * s["share"] / wsum for s in dinar}
    overflow = 0.0
    for s in dinar:
        cap = s["cap"]
        if cap > 0 and alloc[s["id"]] > cap:
            overflow += alloc[s["id"]] - cap; alloc[s["id"]] = cap
    for _ in range(6):
        if overflow <= 1e-9: break
        open_s = [s for s in dinar if s["cap"] == 0 or alloc[s["id"]] < s["cap"]]
        wo = sum(s["share"] for s in open_s)
        if wo <= 0: break
        for s in open_s:
            room = (s["cap"] - alloc[s["id"]]) if s["cap"] > 0 else overflow
            add = min(overflow * s["share"] / wo, room)
            alloc[s["id"]] += add; overflow -= add
    out = [{"id": s["id"], "name": s["name"], "currency": s["currency"],
            "allocated_m": round(alloc.get(s["id"], 0.0), 6)} for s in suppliers]
    distributed = sum(a["allocated_m"] for a in out)
    return {"alloc": out, "leftover_m": round(max(0.0, pool_m - distributed), 6)}
