"""
Idempotent seed functions for the cashflow application database.

Provides:
  - CANONICAL_SUPPLIERS: module-level list of dicts (single source of truth for the 14 suppliers)
  - seed_suppliers(session) -> int   — upsert 14 Supplier rows
  - seed_supplier_caps(session) -> int — insert one SupplierCap per supplier (idempotent)
  - seed_all(session) -> None        — run both then commit

Arabic names are copied verbatim from design-reference/project/src/data.js SUPPLIERS array.
"""

from datetime import date

from sqlalchemy.orm import Session

from app.db.models import Supplier, SupplierCap

# ---------------------------------------------------------------------------
# Canonical data (single source of truth)
# ---------------------------------------------------------------------------
# Each entry: account_id (MSSQL accounts.id), name (Arabic), currency, monthly_cap_m.
# display_order = 1-based position in this list.
CANONICAL_SUPPLIERS: list[dict] = [
    {"account_id": 1001, "name": "معرض البركة",            "currency": "IQD", "monthly_cap_m": 5},
    {"account_id": 2079, "name": "هيثم",                    "currency": "IQD", "monthly_cap_m": 3},
    {"account_id": 2093, "name": "وميض",                    "currency": "IQD", "monthly_cap_m": 0},
    {"account_id": 2432, "name": "حميد الشطباوي",           "currency": "IQD", "monthly_cap_m": 15},
    {"account_id": 2440, "name": "معرض الهادي",             "currency": "IQD", "monthly_cap_m": 3},
    {"account_id": 2700, "name": "معرض أولاد شفيق",         "currency": "IQD", "monthly_cap_m": 3},
    {"account_id": 3123, "name": "العطاوي للمفروشات",       "currency": "IQD", "monthly_cap_m": 2},
    {"account_id": 3916, "name": "شركة أصل القمة",          "currency": "IQD", "monthly_cap_m": 3},
    {"account_id": 5721, "name": "قاسم بايسكلات",           "currency": "IQD", "monthly_cap_m": 4},
    {"account_id": 2439, "name": "معرض الواحة — سامراء",    "currency": "MIX", "monthly_cap_m": 0},
    {"account_id": 4937, "name": "شركة الحافظ",             "currency": "USD", "monthly_cap_m": 40},
    {"account_id": 6444, "name": "كهربائيات المهندس",       "currency": "USD", "monthly_cap_m": 15},
    {"account_id": 6552, "name": "د. يوسف — ميديا فوكس",    "currency": "USD", "monthly_cap_m": 5},
    {"account_id": 6918, "name": "شركة الريان — بغداد",     "currency": "USD", "monthly_cap_m": 7},
]

# Historical-window anchor date — cap is effective for the entire analysis window.
_EFFECTIVE_FROM = date(2022, 5, 1)


def seed_suppliers(session: Session) -> int:
    """
    Insert the 14 canonical suppliers keyed by account_id, ONLY if absent.

    The suppliers table is user-editable (spec §3.2: name/display_order/active can
    be changed via the API), so re-seeding must NOT overwrite existing rows — it
    would silently revert owner edits. Existing account_ids are left untouched.
    Returns count of rows actually inserted.
    """
    inserted = 0
    for pos, entry in enumerate(CANONICAL_SUPPLIERS, start=1):
        existing = (
            session.query(Supplier)
            .filter(Supplier.account_id == entry["account_id"])
            .first()
        )
        if existing is None:
            session.add(
                Supplier(
                    account_id=entry["account_id"],
                    name=entry["name"],
                    currency=entry["currency"],
                    display_order=pos,
                    active=True,
                )
            )
            inserted += 1
        # else: row exists — leave user edits intact (insert-only seeding).
    session.flush()
    return inserted


def seed_supplier_caps(session: Session) -> int:
    """
    Insert one SupplierCap row per supplier with effective_from = 2022-05-01.
    Skips any (supplier_id, effective_from) pair that already exists.
    Must be called after seed_suppliers (or after the suppliers are otherwise flushed).
    Returns count of rows actually inserted.
    """
    inserted = 0
    canonical_by_aid = {e["account_id"]: e for e in CANONICAL_SUPPLIERS}

    # Load all 14 supplier ORM objects in one query.
    suppliers = (
        session.query(Supplier)
        .filter(Supplier.account_id.in_(canonical_by_aid.keys()))
        .all()
    )

    for sup in suppliers:
        entry = canonical_by_aid[sup.account_id]
        existing_cap = (
            session.query(SupplierCap)
            .filter(
                SupplierCap.supplier_id == sup.id,
                SupplierCap.effective_from == _EFFECTIVE_FROM,
            )
            .first()
        )
        if existing_cap is None:
            session.add(
                SupplierCap(
                    supplier_id=sup.id,
                    monthly_cap_m=entry["monthly_cap_m"],
                    effective_from=_EFFECTIVE_FROM,
                    created_by=None,
                )
            )
            inserted += 1
    session.flush()
    return inserted


def seed_all(session: Session) -> None:
    """Run seed_suppliers then seed_supplier_caps, then commit."""
    seed_suppliers(session)
    seed_supplier_caps(session)
    session.commit()
