from decimal import Decimal
from io import BytesIO

import pytest
from openpyxl import load_workbook
from pydantic import ValidationError

from app.api.schemas.modules import (
    AnnotationCreate,
    CompanyMemberCreate,
    InventoryItemCreate,
    ProjectOverviewPlanPatch,
)
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


def test_legacy_parser_delegates_to_semantic_candidates_and_ignores_noise() -> None:
    rows = parse_elongation_rows(
        "Encabezado 20/02/2026 3 2 1\n"
        "Tendon 8; S=2; L=11,880; Elong=7,9\n"
        "Cable A banda 12,5 7 85,2\n"
    )
    assert len(rows) == 1
    assert rows[0]["label"] == "T8"
    assert rows[0]["classification"] == "unknown"
    assert rows[0]["length_m"] == Decimal("11.880")


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
    workbook = load_workbook(BytesIO(content), data_only=False)
    sheet = workbook["Elongaciones"]
    assert sheet["A2"].value == "Cable A"
    assert sheet["F2"].value == "=E2+(E2*0.07)"


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


def test_plan_board_schemas_keep_annotations_scoped_and_allow_clearing_overview() -> None:
    annotation = AnnotationCreate(
        page_number=1,
        level_id="c7b55613-9adc-4b84-87c6-e356d1a5f983",
        annotation_type="note",
        geometry_json={"x": 0.2, "y": 0.4},
        comment="Verificar armaduras",
    )
    assert annotation.level_id is not None
    assert ProjectOverviewPlanPatch(plan_version_id=None).plan_version_id is None
