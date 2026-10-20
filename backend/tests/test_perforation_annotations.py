from datetime import datetime
from decimal import Decimal
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import UploadFile
from pydantic import ValidationError
from starlette.datastructures import Headers

from app.api.schemas.rubros import PerforationAnnotationCreate, PerforationAnnotationResponse
from app.main import app
from app.services import file_storage

DOCUMENT_ID = "c7b55613-9adc-4b84-87c6-e356d1a5f983"


def make_mark(**overrides) -> PerforationAnnotationCreate:
    data = {
        "document_id": DOCUMENT_ID,
        "page_number": 1,
        "kind": "line",
        "points": [{"x": 0.1, "y": 0.2}, {"x": 0.8, "y": 0.7}],
        "color_hex": "#f97316",
        "stroke_width": 4,
        "opacity": Decimal("1"),
    }
    return PerforationAnnotationCreate(**{**data, **overrides})


def test_strokes_are_scoped_to_document_and_page_with_bounded_coordinates():
    mark = make_mark()
    assert mark.document_id == DOCUMENT_ID
    assert mark.page_number == 1
    with pytest.raises(ValidationError):
        make_mark(points=[{"x": -0.1, "y": 0.2}, {"x": 0.8, "y": 0.7}])


def test_notes_need_text_and_single_position():
    with pytest.raises(ValidationError, match="nota necesita"):
        make_mark(kind="note", points=[{"x": 0.2, "y": 0.3}], text=" ")
    note = make_mark(kind="note", points=[{"x": 0.2, "y": 0.3}], text="  Revisar  ")
    assert note.text == "Revisar"


def test_annotation_endpoints_are_in_openapi():
    prefix = "/api/v1/companies/{company_id}/projects/{project_id}/rubros/{rubro_id}"
    paths = app.openapi()["paths"]
    assert "post" in paths[f"{prefix}/perforation-annotations"]
    assert "delete" in paths[f"{prefix}/perforation-annotations/{{annotation_id}}"]


def test_annotation_response_exposes_points_not_internal_column_name():
    item = SimpleNamespace(
        id=DOCUMENT_ID,
        company_id=DOCUMENT_ID,
        project_id=DOCUMENT_ID,
        rubro_id=DOCUMENT_ID,
        document_id=DOCUMENT_ID,
        page_number=1,
        kind="line",
        points_json=[{"x": 0.1, "y": 0.2}, {"x": 0.8, "y": 0.7}],
        text=None,
        color_hex="#f97316",
        stroke_width=4,
        opacity=Decimal("1"),
        created_by_user_id=DOCUMENT_ID,
        created_at=datetime.now(),
    )
    result = PerforationAnnotationResponse.model_validate(item).model_dump(mode="json")
    assert len(result["points"]) == 2
    assert "points_json" not in result


@pytest.mark.asyncio
async def test_tablet_pdf_upload_can_use_verified_octet_stream(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "storage_path", lambda key: tmp_path / key)
    upload = UploadFile(
        filename="N2.pdf",
        file=BytesIO(b"%PDF-1.7\nvalid-header"),
        headers=Headers({"content-type": "application/octet-stream"}),
    )
    assert upload.content_type == "application/octet-stream"
    stored = await file_storage.store_upload(
        upload, "companies", DOCUMENT_ID, mime_type_override="application/pdf"
    )
    assert stored.mime_type == "application/pdf"
    assert stored.original_filename == "N2.pdf"
    assert (tmp_path / stored.storage_key).read_bytes().startswith(b"%PDF-")
