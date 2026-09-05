from decimal import Decimal
from io import BytesIO
from zipfile import ZipFile

import pytest
from pydantic import ValidationError

from app.api.schemas.modules import CompanyMemberCreate, InventoryItemCreate
from app.main import app
from app.services.document_processing import build_xlsx, parse_elongation_rows
from app.services.file_storage import _signature_matches


def test_openapi_exposes_operational_modules() -> None:
    paths = app.openapi()["paths"]
    prefix = "/api/v1/companies/{company_id}"
    expected = (
        f"{prefix}/projects/{{project_id}}/plans",
        f"{prefix}/projects/{{project_id}}/documents",
        f"{prefix}/inventory",
        f"{prefix}/inventory/movements",
        f"{prefix}/members",
        f"{prefix}/reports/overview",
        f"{prefix}/settings",
    )
    for path in expected:
        assert path in paths


def test_parser_extracts_candidate_rows_and_ignores_noise() -> None:
    rows = parse_elongation_rows(
        "Encabezado sin números\nCable A banda 12,5 7 85,2\nCable B 20.000 9 101.5\n"
    )
    assert len(rows) == 2
    assert rows[0]["label"] == "Cable A banda"
    assert rows[0]["classification"] == "band"
    assert rows[0]["length_m"] == Decimal("12.5")
    assert rows[1]["classification"] == "distributed"


def test_xlsx_contains_valid_workbook_and_rows() -> None:
    content = build_xlsx(
        [
            {
                "label": "Cable A",
                "classification": "band",
                "length_m": Decimal("12.5"),
                "strand_count": 7,
                "calculated_elongation": Decimal("85.2"),
                "measured_elongation": None,
                "review_status": "approved",
            }
        ]
    )
    with ZipFile(BytesIO(content)) as workbook:
        assert "xl/worksheets/sheet1.xml" in workbook.namelist()
        sheet = workbook.read("xl/worksheets/sheet1.xml").decode()
        assert "Cable A" in sheet
        assert "Elongación calculada" in sheet


@pytest.mark.parametrize(
    ("content", "mime_type"),
    [
        (b"%PDF-1.7", "application/pdf"),
        (b"\xff\xd8\xffrest", "image/jpeg"),
        (b"\x89PNG\r\n\x1a\nrest", "image/png"),
        (b"RIFF0000WEBPrest", "image/webp"),
    ],
)
def test_file_signatures(content: bytes, mime_type: str) -> None:
    assert _signature_matches(content, mime_type)
    assert not _signature_matches(b"not-a-file", mime_type)


def test_module_schemas_validate_company_inputs() -> None:
    member = CompanyMemberCreate(email=" USER@Example.com ", full_name="User", role="worker")
    assert member.email == "user@example.com"
    item = InventoryItemCreate(
        code="MAR-01", name="Martillo", item_type="tool", quantity=Decimal("1")
    )
    assert item.unit == "unit"
    with pytest.raises(ValidationError):
        CompanyMemberCreate(email="invalido", full_name="User", role="worker")
