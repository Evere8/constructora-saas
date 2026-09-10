"""Regression cases for CAD SHX data and the visual OCR boundary. No paid API calls."""

import json
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, TextStringObject

from app.api.schemas.elongations import ElongationItemCreate
from app.core.config import Settings
from app.services.elongations import theory, vision
from app.services.elongations.measurements import expand_measurement_slots


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_cad_shx_original_text_and_rotated_rectangles(tmp_path, monkeypatch, rotation):
    writer = PdfWriter()
    page = writer.add_blank_page(300, 600)
    page.rotate(rotation)
    annotation = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Text"),
            NameObject("/T"): TextStringObject("AutoCAD SHX Text"),
            NameObject("/Contents"): TextStringObject("Tendon 8;S=2;L11.880;Elong=7.9"),
            # Reversed x coordinates are valid in real AutoCAD exports.
            NameObject("/Rect"): ArrayObject([FloatObject(n) for n in [90, 420, 30, 540]]),
        }
    )
    page[NameObject("/Annots")] = ArrayObject([writer._add_object(annotation)])
    path = tmp_path / "cad.pdf"
    writer.write(path)
    monkeypatch.setattr(theory, "_pdf_layout", lambda *a: (1, 300, 600))
    monkeypatch.setattr(theory, "_vector_blocks", lambda *a, **kw: ([], 1))
    monkeypatch.setattr(
        vision, "visual_enabled", lambda: pytest.fail("CAD does not need cloud OCR")
    )
    result = theory.extract_theory(path, "application/pdf")
    assert result.engine == "autocad-shx+pdftotext"
    assert [
        (v.label, v.strand_count, v.length_m, v.calculated_elongation_cm) for v in result.candidates
    ] == [("T8", 2, Decimal("11.880"), Decimal("7.9"))]
    box = result.candidates[0].bbox
    assert box["width"] == box["height"] == Decimal("0.2")
    assert (box["x"], box["y"]) == {
        0: (Decimal(".1"), Decimal(".1")),
        90: (Decimal(".7"), Decimal(".1")),
        180: (Decimal(".7"), Decimal(".7")),
        270: (Decimal(".1"), Decimal(".7")),
    }[rotation]


def test_incomplete_neighbour_does_not_supply_a_different_elongation():
    assert (
        theory.parse_theory_candidates(
            "Tendon 202;S=2;L11.697;Elong=/7.5 203; S=1;L5.950;Elong=3.7"
        )
        == []
    )


def test_separated_cad_word_is_joined_only_on_same_line():
    def box(x, y, width):
        return {
            "x": Decimal(x),
            "y": Decimal(y),
            "width": Decimal(width),
            "height": Decimal(".005"),
        }

    blocks = [
        ("Tendon", 1, box(".01", ".02", ".01"), Decimal(".9")),
        ("8;S=2;L11.880;Elong=7.9", 1, box(".021", ".02", ".09"), Decimal(".9")),
        ("9;S=1;L20;Elong=12", 1, box(".021", ".08", ".09"), Decimal(".9")),
    ]
    candidates = [
        v
        for text, page, bbox, _ in theory._semantic_ocr_blocks(blocks)
        for v in theory.parse_theory_candidates(text, page=page, bbox=bbox)
    ]
    assert {v.label for v in candidates} == {"T8"}


def test_null_handwritten_slot_preserves_ordinal_and_comma_decimal(monkeypatch):
    row = vision.VisualMeasurementRow(
        region=0,
        label="T8",
        values=["4,8", None, "5,0"],
        raw_text="4,8 - ? - 5,0",
        bbox={"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1},
        uncertain=True,
    )
    monkeypatch.setattr(vision, "_read_pages", lambda *a: [(row, 2, {"x": ".1"}, [])])
    monkeypatch.setattr(vision, "get_settings", lambda: Settings(mysql_password="test"))
    extraction = vision.extract_visual_measurements(Path("scan.pdf"), "application/pdf")
    slots, extras = expand_measurement_slots(3, list(extraction.groups[0].values))
    assert [s.measured_elongation_cm for s in slots] == [Decimal("4.8"), None, Decimal("5.0")]
    assert slots[1].status == "missing"
    assert extraction.groups[0].page == 2
    assert extras == []


def test_visual_unreadable_theory_stays_in_warnings(monkeypatch):
    row = vision.VisualTheoryRow(
        region=0,
        label="T8",
        strand_count=2,
        length_m=None,
        calculated_elongation_cm="7,9",
        raw_text="Tendon 8;S=2;L?;Elong=7.9",
        bbox={"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1},
        uncertain=True,
    )
    monkeypatch.setattr(vision, "_read_pages", lambda *a: [(row, 1, {}, [])])
    monkeypatch.setattr(vision, "get_settings", lambda: Settings(mysql_password="test"))
    result = vision.extract_visual_theory(Path("scan.pdf"), "application/pdf")
    assert not result.candidates
    assert "T8" in result.warnings[0]


def test_openai_contract_keeps_documents_private_and_validates_response(monkeypatch):
    settings = Settings(mysql_password="test", openai_api_key="sk-test-only")
    monkeypatch.setattr(vision, "get_settings", lambda: settings)
    calls = []

    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload)
        assert payload["store"] is False
        assert payload["text"]["format"]["strict"] is True
        assert payload["input"][0]["content"][0]["text"] == "source pixels only"
        assert "sk-test-only" not in json.dumps(payload)
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": '{"rows":[],"warnings":[]}'}],
                    }
                ],
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(vision.httpx, "Client", lambda **kw: client)
    result = vision.request_transcription(
        [{"type": "input_text", "text": "source pixels only"}], vision.MeasurementPage
    )
    assert result.rows == [] and len(calls) == 1


@pytest.mark.parametrize("status", [401, 403, 429, 500])
def test_provider_errors_do_not_expose_secrets_or_become_empty_success(monkeypatch, status):
    monkeypatch.setattr(
        vision,
        "get_settings",
        lambda: Settings(mysql_password="test", openai_api_key="sk-test-only"),
    )
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(status, text="private diagnostic")
        )
    )
    monkeypatch.setattr(vision.httpx, "Client", lambda **kw: client)
    with pytest.raises(RuntimeError) as error:
        vision.request_transcription([], vision.MeasurementPage)
    assert "sk-test-only" not in str(error.value) and "private diagnostic" not in str(error.value)


def test_manual_theory_requires_all_fields_and_accepts_decimal_comma():
    result = ElongationItemCreate(
        label="8", length_m="11,880", strand_count=2, calculated_elongation="7,9"
    )
    assert result.label == "T8" and result.length_m == Decimal("11.880")
    with pytest.raises(ValueError):
        ElongationItemCreate(label="8", strand_count=2, calculated_elongation="7,9")
