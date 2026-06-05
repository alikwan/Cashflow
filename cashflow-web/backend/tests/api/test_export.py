"""
tests/api/test_export.py
========================
TDD tests for E1: GET /api/export/excel and GET /api/export/pdf.

Both endpoints:
  - require auth (401 without session cookie)
  - return correct Content-Type and Content-Disposition
  - work on EMPTY DB (no seed_analytics) without raising 500
  - return valid file magic bytes
  - (xlsx) contain expected sheet names
"""
from __future__ import annotations

import io
import pytest
import openpyxl


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

_EXPECTED_SHEETS = {
    "التدفق الشهري",
    "الموردون",
    "الأقساط",
    "التنبؤ",
}


# ---------------------------------------------------------------------------
# Auth guard — no cookie → 401
# ---------------------------------------------------------------------------

def test_export_excel_requires_auth(client):
    r = client.get("/api/export/excel")
    assert r.status_code == 401


def test_export_pdf_requires_auth(client):
    r = client.get("/api/export/pdf")
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Excel — happy path (with seed data)
# ---------------------------------------------------------------------------

def test_export_excel_returns_xlsx(client, seed_analytics, auth):
    r = client.get("/api/export/excel", cookies=auth)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    # xlsx is a ZIP → starts with PK magic
    assert r.content[:2] == b"PK"
    assert "attachment" in r.headers.get("content-disposition", "")
    assert "cashflow_report_" in r.headers.get("content-disposition", "")


def test_export_excel_sheet_names(client, seed_analytics, auth):
    r = client.get("/api/export/excel", cookies=auth)
    assert r.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    sheet_names = set(wb.sheetnames)
    assert _EXPECTED_SHEETS.issubset(sheet_names), (
        f"Missing sheets: {_EXPECTED_SHEETS - sheet_names}"
    )


def test_export_excel_monthly_sheet_has_data(client, seed_analytics, auth):
    """The monthly cashflow sheet should have at least a header + 24 data rows."""
    r = client.get("/api/export/excel", cookies=auth)
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    ws = wb["التدفق الشهري"]
    # header row + 24 seed rows
    assert ws.max_row >= 25


# ---------------------------------------------------------------------------
# Excel — empty DB (no seed_analytics) must not 500
# ---------------------------------------------------------------------------

def test_export_excel_empty_db(client, auth):
    """Excel export on an empty analytical DB must succeed (empty sheets, not 500)."""
    r = client.get("/api/export/excel", cookies=auth)
    assert r.status_code == 200
    # still a valid xlsx
    assert r.content[:2] == b"PK"
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    assert _EXPECTED_SHEETS.issubset(set(wb.sheetnames))


# ---------------------------------------------------------------------------
# PDF — happy path (with seed data)
# ---------------------------------------------------------------------------

def test_export_pdf_returns_pdf(client, seed_analytics, auth):
    r = client.get("/api/export/pdf", cookies=auth)
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF"
    assert r.headers["content-type"].startswith("application/pdf")
    assert "attachment" in r.headers.get("content-disposition", "")
    assert "cashflow_summary_" in r.headers.get("content-disposition", "")


# ---------------------------------------------------------------------------
# PDF — empty DB must not 500
# ---------------------------------------------------------------------------

def test_export_pdf_empty_db(client, auth):
    """PDF export on an empty analytical DB must succeed (summary with zeros)."""
    r = client.get("/api/export/pdf", cookies=auth)
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF"
