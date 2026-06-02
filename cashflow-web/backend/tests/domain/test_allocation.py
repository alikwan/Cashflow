from app.domain.allocation import compute_pool, allocate_dinar

def test_pool_subtracts_fixed_costs_and_siyrafa():
    pool = compute_pool(forecast_in=120, salaries=5, purchases=7, refunds=3,
                        partners=32, siyrafa=40, reserve=15)
    assert pool == 18.0

def test_allocation_excludes_dollar_suppliers():
    suppliers = [
        {"id": 1, "name": "دينار-أ", "currency": "IQD", "cap": 10, "share": 0.5},
        {"id": 2, "name": "دينار-ب", "currency": "IQD", "cap": 10, "share": 0.3},
        {"id": 3, "name": "الحافظ",  "currency": "USD", "cap": 40, "share": 0.2},
    ]
    res = allocate_dinar(pool_m=18, suppliers=suppliers)
    by = {a["id"]: a["allocated_m"] for a in res["alloc"]}
    assert by[3] == 0.0
    assert abs((by[1] + by[2]) - 18.0) < 1e-6
    assert res["leftover_m"] == 0.0
