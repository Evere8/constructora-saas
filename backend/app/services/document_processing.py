# ruff: noqa: E501
from __future__ import annotations

import re
import subprocess
import tempfile
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

NUMBER = re.compile(r"-?\d+(?:[.,]\d+)?")


def _run(args: list[str], timeout: int = 90) -> str:
    try:
        result = subprocess.run(
            args,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("El motor de lectura de documentos no está instalado") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("El documento tardó demasiado en procesarse") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip()[:300]
        raise RuntimeError(detail or "No fue posible leer el documento") from exc
    return result.stdout


def extract_text(path: Path, mime_type: str, max_pdf_pages: int = 25) -> str:
    if mime_type == "application/pdf":
        text = _run(["pdftotext", "-layout", str(path), "-"])
        if len(text.strip()) >= 30:
            return text[:60000]
        with tempfile.TemporaryDirectory(prefix="obrixapy-ocr-") as tmp:
            prefix = Path(tmp) / "page"
            _run(
                [
                    "pdftoppm",
                    "-f",
                    "1",
                    "-l",
                    str(max_pdf_pages),
                    "-png",
                    "-r",
                    "180",
                    str(path),
                    str(prefix),
                ],
                timeout=180,
            )
            pages = sorted(Path(tmp).glob("page-*.png"))
            return "\n".join(
                _run(["tesseract", str(page), "stdout", "-l", "spa+eng"]) for page in pages
            )[:60000]
    return _run(["tesseract", str(path), "stdout", "-l", "spa+eng"])[:60000]


def parse_elongation_rows(text: str) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    labels: set[str] = set()
    for line_number, raw in enumerate(text.splitlines(), start=1):
        line = " ".join(raw.replace(";", " ").replace("\t", " ").split())
        values = NUMBER.findall(line)
        if len(values) < 3:
            continue
        prefix = line[: line.find(values[0])].strip(" :-#")
        label = (prefix or f"ITEM-{line_number}")[:50]
        if label in labels:
            label = f"{label[:42]}-{line_number}"
        try:
            length = Decimal(values[0].replace(",", "."))
            strands = int(Decimal(values[1].replace(",", ".")))
            calculated = Decimal(values[2].replace(",", "."))
        except (InvalidOperation, ValueError):
            continue
        if length <= 0 or strands <= 0 or calculated < 0:
            continue
        labels.add(label)
        rows.append(
            {
                "label": label,
                "classification": "band" if "band" in line.lower() else "distributed",
                "length_m": length,
                "strand_count": strands,
                "calculated_elongation": calculated,
                "confidence": Decimal("0.6500"),
                "source_location_json": {"line": line_number, "text": raw[:500]},
            }
        )
        if len(rows) >= 200:
            break
    return rows


def _cell(ref: str, value: object, string: bool = False) -> str:
    if value is None:
        return f'<c r="{ref}"/>'
    if string:
        return f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
    return f'<c r="{ref}"><v>{escape(str(value))}</v></c>'


def build_xlsx(rows: list[dict[str, object]]) -> bytes:
    headers = [
        "Etiqueta",
        "Clasificación",
        "Longitud (m)",
        "Cordones",
        "Elongación calculada",
        "Elongación medida",
        "Revisión",
    ]
    sheet_rows = [
        '<row r="1">'
        + "".join(_cell(f"{chr(65 + i)}1", h, True) for i, h in enumerate(headers))
        + "</row>"
    ]
    for row_number, row in enumerate(rows, start=2):
        values = [
            row.get("label"),
            row.get("classification"),
            row.get("length_m"),
            row.get("strand_count"),
            row.get("calculated_elongation"),
            row.get("measured_elongation"),
            row.get("review_status"),
        ]
        cells = [
            _cell(f"{chr(65 + i)}{row_number}", value, i in {0, 1, 6})
            for i, value in enumerate(values)
        ]
        sheet_rows.append(f'<row r="{row_number}">' + "".join(cells) + "</row>")

    worksheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        "<sheetData>" + "".join(sheet_rows) + "</sheetData></worksheet>"
    )
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            "</Types>",
        )
        archive.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>",
        )
        archive.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Elongaciones" sheetId="1" r:id="rId1"/></sheets></workbook>',
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            "</Relationships>",
        )
        archive.writestr("xl/worksheets/sheet1.xml", worksheet)
    return output.getvalue()
