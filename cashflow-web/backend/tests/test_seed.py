"""
Tests for app/seed.py — idempotent seed of 14 suppliers + initial monthly caps.
Uses the function-scoped SQLite session fixture from conftest.py.
"""
from datetime import date

import pytest

from app.db.models import Supplier, SupplierCap
from app.seed import CANONICAL_SUPPLIERS, seed_all

CANONICAL_ACCOUNT_IDS = {s["account_id"] for s in CANONICAL_SUPPLIERS}
EFFECTIVE_FROM = date(2022, 5, 1)


class TestSeedSuppliers:
    def test_exactly_14_suppliers(self, session):
        seed_all(session)
        assert session.query(Supplier).count() == 14

    def test_account_ids_match_canonical(self, session):
        seed_all(session)
        db_ids = {s.account_id for s in session.query(Supplier).all()}
        assert db_ids == CANONICAL_ACCOUNT_IDS

    def test_currencies_correct(self, session):
        seed_all(session)
        suppliers = session.query(Supplier).all()
        by_cur = {}
        for s in suppliers:
            by_cur.setdefault(s.currency, []).append(s.account_id)
        assert len(by_cur.get("USD", [])) == 4
        assert len(by_cur.get("MIX", [])) == 1
        assert len(by_cur.get("IQD", [])) == 9

    def test_display_order_1_to_14_no_gaps_no_dupes(self, session):
        seed_all(session)
        orders = sorted(s.display_order for s in session.query(Supplier).all())
        assert orders == list(range(1, 15))

    def test_all_active(self, session):
        seed_all(session)
        inactive = session.query(Supplier).filter(Supplier.active.is_(False)).count()
        assert inactive == 0


class TestSeedSupplierCaps:
    def test_exactly_14_caps(self, session):
        seed_all(session)
        assert session.query(SupplierCap).count() == 14

    def test_all_effective_from_anchor(self, session):
        seed_all(session)
        wrong = (
            session.query(SupplierCap)
            .filter(SupplierCap.effective_from != EFFECTIVE_FROM)
            .count()
        )
        assert wrong == 0

    def test_caps_match_canonical(self, session):
        seed_all(session)
        # Build a map of account_id -> monthly_cap_m from the DB
        rows = (
            session.query(Supplier.account_id, SupplierCap.monthly_cap_m)
            .join(SupplierCap, Supplier.id == SupplierCap.supplier_id)
            .all()
        )
        db_caps = {r.account_id: float(r.monthly_cap_m) for r in rows}
        canonical_caps = {s["account_id"]: float(s["monthly_cap_m"]) for s in CANONICAL_SUPPLIERS}
        assert db_caps == canonical_caps

    def test_spot_check_hafidh_cap_40(self, session):
        """شركة الحافظ — account_id=4937, cap=40 USD"""
        seed_all(session)
        sup = session.query(Supplier).filter_by(account_id=4937).one()
        cap = session.query(SupplierCap).filter_by(supplier_id=sup.id).one()
        assert float(cap.monthly_cap_m) == 40.0
        assert sup.currency == "USD"

    def test_spot_check_wameed_cap_0(self, session):
        """وميض — account_id=2093, cap=0 IQD"""
        seed_all(session)
        sup = session.query(Supplier).filter_by(account_id=2093).one()
        cap = session.query(SupplierCap).filter_by(supplier_id=sup.id).one()
        assert float(cap.monthly_cap_m) == 0.0
        assert sup.currency == "IQD"

    def test_created_by_is_none(self, session):
        """No user exists at seed time — created_by must be NULL."""
        seed_all(session)
        with_user = session.query(SupplierCap).filter(SupplierCap.created_by.isnot(None)).count()
        assert with_user == 0


class TestIdempotency:
    def test_double_seed_still_14_suppliers(self, session):
        seed_all(session)
        seed_all(session)
        assert session.query(Supplier).count() == 14

    def test_double_seed_still_14_caps(self, session):
        seed_all(session)
        seed_all(session)
        assert session.query(SupplierCap).count() == 14

    def test_double_seed_no_integrity_error(self, session):
        """Running seed_all twice must not raise."""
        seed_all(session)
        seed_all(session)  # must not raise

    def test_display_orders_stable_after_double_seed(self, session):
        seed_all(session)
        seed_all(session)
        orders = sorted(s.display_order for s in session.query(Supplier).all())
        assert orders == list(range(1, 15))

    def test_user_edits_survive_reseed(self, session):
        """Suppliers are user-editable (spec §3.2): re-seeding must not revert edits."""
        seed_all(session)
        sup = session.query(Supplier).filter_by(account_id=1001).one()
        sup.name = "اسم معدّل من المستخدم"
        sup.display_order = 99
        sup.active = False
        session.commit()
        seed_all(session)
        sup = session.query(Supplier).filter_by(account_id=1001).one()
        assert sup.name == "اسم معدّل من المستخدم"
        assert sup.display_order == 99
        assert sup.active is False
