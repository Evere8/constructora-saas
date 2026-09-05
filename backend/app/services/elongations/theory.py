"""Lectura semántica y trazable de la teoría de elongaciones.

Un candidato se acepta únicamente cuando el mismo bloque contiene los cuatro campos del
detalle técnico: Tendón, S, L y Elong.  En particular, este módulo no deduce filas a partir
de la posición de los primeros números que aparezcan en una línea.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
import xml.etree.ElementTree as element_tree
from dataclasses import dataclass, field, replace
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from PIL import Image

TENDON_PATTERN = re.compile(
    r"\b(?:tendon|tend[oó]n|tend0n|tendqn)\s*(?:n(?:[oº°.]|ro)?\s*)?[#№]?\s*"
    r"(?P<value>\d{1,6})(?!\d)",
    re.IGNORECASE,
)
STRAND_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])(?:S|\$)\s*(?:=|:)?\s*(?P<value>\d{1,4})(?![\d.,])",
    re.IGNORECASE,
)
LENGTH_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])L\s*(?:=|:)?\s*(?P<value>\d+(?:[.,]\d{1,3})?)(?![\d.,])",
    re.IGNORECASE,
)
ELONGATION_PATTERN = re.compile(
    r"\b(?:elong(?:aci[oó]n)?|elongaci[oó]n)\s*(?:=|:)?\s*"
    r"(?P<value>\d+(?:[.,]\d{1,3})?)(?![\d.,])",
    re.IGNORECASE,
)
PDF_PAGE_SIZE_PATTERN = re.compile(
    r"Page size:\s*(?P<width>\d+(?:\.\d+)?)\s+x\s+(?P<height>\d+(?:\.\d+)?)\s+pts",
    re.IGNORECASE,
)
PDF_PAGE_COUNT_PATTERN = re.compile(r"^Pages:\s*(?P<pages>\d+)\s*$", re.MULTILINE)
PDF_PAGE_ROTATION_PATTERN = re.compile(r"^Page rot:\s*(?P<rotation>\d+)\s*$", re.MULTILINE)

# A0 post-tensioning plans are exceptionally large.  225 DPI keeps the labels
# readable for Tesseract while reducing the supplied A0 plan from 20 tiles to 6
# before its orientation passes.  Every accepted result remains subject to the
# complete Tendon/S/L/Elong semantic rule and human review.
OCR_DPI = 225
OCR_TILE_SIZE_PX = 4096
OCR_TILE_OVERLAP_PX = 512
MAX_OCR_IMAGE_PIXELS = 100_000_000
MAX_OCR_PDF_RENDER_PIXELS = 250_000_000


def decimal_from_ocr(value: str) -> Decimal:
    """Return a Decimal from an OCR value, accepting a comma or dot separator."""

    normalised = value.strip().replace(" ", "").replace(",", ".")
    try:
        decimal_value = Decimal(normalised)
    except InvalidOperation as exc:
        raise ValueError(f"Decimal de OCR inválido: {value!r}") from exc
    if not decimal_value.is_finite():
        raise ValueError(f"Decimal de OCR inválido: {value!r}")
    return decimal_value


def normalise_label(value: str | int) -> tuple[str, int]:
    """Normalize only a Tendon label into the stable ``T<number>`` form."""

    match = re.fullmatch(r"\s*(?:T(?:ENDON)?\s*)?0*(\d+)\s*", str(value), re.IGNORECASE)
    if match is None:
        raise ValueError("La etiqueta debe contener un número de tendón")
    number = int(match.group(1))
    if number <= 0:
        raise ValueError("La etiqueta de tendón debe ser positiva")
    return f"T{number}", number


def natural_label_key(label: str) -> tuple[int, str]:
    """Sort T2 before T10 while retaining a stable fallback for manual labels."""

    match = re.fullmatch(r"T(\d+)", label.strip().upper())
    return (int(match.group(1)), label.upper()) if match else (10**12, label.upper())


@dataclass(frozen=True)
class TheoryCandidate:
    """A complete semantic theoretical group, never a loose numeric row."""

    label: str
    label_number: int
    strand_count: int
    length_m: Decimal
    calculated_elongation_cm: Decimal
    raw_label: str
    raw_text: str
    page: int = 1
    bbox: dict[str, Decimal] | None = None
    field_confidence: dict[str, Decimal] = field(default_factory=dict)
    confidence: Decimal = Decimal("0.0000")
    conflict: bool = False
    alternatives: tuple[dict[str, str], ...] = ()

    def values_key(self) -> tuple[int, Decimal, Decimal]:
        return (self.strand_count, self.length_m, self.calculated_elongation_cm)

    def source_location(self) -> dict[str, Any]:
        return {
            "page": self.page,
            "bbox": {key: str(value) for key, value in (self.bbox or {}).items()} or None,
            "raw_text": self.raw_text,
        }

    def field_confidence_json(self) -> dict[str, str]:
        return {key: str(value) for key, value in self.field_confidence.items()}


@dataclass(frozen=True)
class TheoryExtraction:
    """OCR/vector result retained by the pipeline for review and retry diagnostics."""

    extracted_text: str
    candidates: tuple[TheoryCandidate, ...]
    page_count: int
    engine: str
    warnings: tuple[str, ...] = ()


def _candidate_confidence(
    field_confidence: dict[str, Decimal] | None,
) -> tuple[dict[str, Decimal], Decimal]:
    defaults = {
        "label": Decimal("0.9600"),
        "strand_count": Decimal("0.9600"),
        "length_m": Decimal("0.9600"),
        "calculated_elongation_cm": Decimal("0.9600"),
    }
    if field_confidence:
        for key, value in field_confidence.items():
            if key in defaults:
                defaults[key] = max(Decimal("0"), min(Decimal("1"), Decimal(str(value))))
    return defaults, min(defaults.values())


def _window_after_label(text: str, start: int, next_start: int | None) -> str:
    """Keep a bounded semantic block.  A neighbouring label terminates the block."""

    end = next_start if next_start is not None else min(len(text), start + 420)
    return text[start:end]


def parse_theory_candidates(
    text: str,
    *,
    page: int = 1,
    bbox: dict[str, Decimal] | None = None,
    field_confidence: dict[str, Decimal] | None = None,
) -> list[TheoryCandidate]:
    """Extract only complete Tendon/S/L/Elong blocks from text or OCR output.

    ``text`` may contain new lines, arbitrary spacing and comma decimals.  An incomplete block
    intentionally produces no automatic candidate; it remains a reviewer concern instead of an
    invented row.
    """

    matches = list(TENDON_PATTERN.finditer(text))
    candidates: list[TheoryCandidate] = []
    confidences, confidence = _candidate_confidence(field_confidence)
    for index, tendon_match in enumerate(matches):
        next_start = matches[index + 1].start() if index + 1 < len(matches) else None
        block = _window_after_label(text, tendon_match.start(), next_start)
        strand_match = STRAND_PATTERN.search(block)
        length_match = LENGTH_PATTERN.search(block)
        elongation_match = ELONGATION_PATTERN.search(block)
        if not (strand_match and length_match and elongation_match):
            continue
        try:
            label, label_number = normalise_label(tendon_match.group("value"))
            strand_count = int(strand_match.group("value"))
            length_m = decimal_from_ocr(length_match.group("value"))
            calculated = decimal_from_ocr(elongation_match.group("value"))
        except (ValueError, InvalidOperation):
            continue
        if strand_count <= 0 or length_m <= 0 or calculated < 0:
            continue
        raw_label = tendon_match.group(0).strip()
        candidates.append(
            TheoryCandidate(
                label=label,
                label_number=label_number,
                strand_count=strand_count,
                length_m=length_m,
                calculated_elongation_cm=calculated,
                raw_label=raw_label,
                raw_text=" ".join(block.split())[:1000],
                page=page,
                bbox=bbox,
                field_confidence=confidences,
                confidence=confidence,
            )
        )
    return deduplicate_candidates(candidates)


def _alternative(candidate: TheoryCandidate) -> dict[str, str]:
    return {
        "strand_count": str(candidate.strand_count),
        "length_m": str(candidate.length_m),
        "calculated_elongation_cm": str(candidate.calculated_elongation_cm),
        "raw_text": candidate.raw_text,
    }


def deduplicate_candidates(candidates: list[TheoryCandidate]) -> list[TheoryCandidate]:
    """Deduplicate identical overlapping reads without silently overwriting conflicts.

    A duplicate with identical semantic values keeps the highest-confidence source.  Different
    values for one label become one explicit conflict with all alternatives retained for review.
    """

    by_label: dict[str, list[TheoryCandidate]] = {}
    for candidate in candidates:
        by_label.setdefault(candidate.label, []).append(candidate)
    result: list[TheoryCandidate] = []
    for label in sorted(by_label, key=natural_label_key):
        group = by_label[label]
        values = {candidate.values_key() for candidate in group}
        selected = max(group, key=lambda item: item.confidence)
        if len(values) == 1:
            result.append(selected)
            continue
        alternatives = tuple(_alternative(candidate) for candidate in group)
        result.append(replace(selected, conflict=True, alternatives=alternatives))
    return result


def _run(command: list[str], *, timeout: int = 180) -> str:
    try:
        completed = subprocess.run(
            command,
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
    return completed.stdout


def _normalised_bbox(
    attributes: dict[str, str], width: Decimal, height: Decimal
) -> dict[str, Decimal] | None:
    try:
        return {
            "x": (Decimal(attributes["xMin"]) / width).quantize(Decimal("0.000001")),
            "y": (Decimal(attributes["yMin"]) / height).quantize(Decimal("0.000001")),
            "width": ((Decimal(attributes["xMax"]) - Decimal(attributes["xMin"])) / width).quantize(
                Decimal("0.000001")
            ),
            "height": (
                (Decimal(attributes["yMax"]) - Decimal(attributes["yMin"])) / height
            ).quantize(Decimal("0.000001")),
        }
    except (InvalidOperation, KeyError, ZeroDivisionError):
        return None


def _vector_blocks(
    path: Path,
    *,
    rendered_width: int,
    rendered_height: int,
) -> tuple[list[tuple[str, int, dict[str, Decimal] | None]], int]:
    source = _run(["pdftotext", "-bbox-layout", str(path), "-"])
    try:
        root = element_tree.fromstring(source)
    except element_tree.ParseError:
        return [], 0
    blocks: list[tuple[str, int, dict[str, Decimal] | None]] = []
    pages = list(root.findall(".//{*}page"))
    for page_number, page in enumerate(pages, start=1):
        for block in page.findall(".//{*}block"):
            words = [word.text or "" for word in block.findall(".//{*}word")]
            block_text = " ".join(word for word in words if word).strip()
            if block_text:
                blocks.append(
                    (
                        block_text,
                        page_number,
                        _normalised_bbox(
                            block.attrib,
                            Decimal(rendered_width),
                            Decimal(rendered_height),
                        ),
                    )
                )
    return blocks, len(pages)


def _parse_tsv_blocks(
    content: str,
    *,
    page_number: int,
    x_offset: int,
    y_offset: int,
    page_width: int,
    page_height: int,
    tile_width: int | None = None,
    tile_height: int | None = None,
    rotation: int = 0,
) -> list[tuple[str, int, dict[str, Decimal] | None, Decimal]]:
    """Return paragraph-sized OCR blocks rather than isolated visual lines.

    Tesseract commonly places ``Tendon``, ``S``, ``L`` and ``Elong`` on separate lines in a
    single label.  Grouping at paragraph level preserves the semantic relationship while the
    enclosing bounding box remains an honest review location.
    """

    groups: dict[tuple[str, str], list[tuple[str, Decimal, int, int, int, int]]] = {}
    for row in content.splitlines()[1:]:
        parts = row.split("\t")
        if len(parts) < 12 or not parts[11].strip():
            continue
        (
            level,
            _page,
            block,
            paragraph,
            _line,
            _word,
            left,
            top,
            width,
            height,
            confidence,
            text,
        ) = parts[:12]
        if level != "5":
            continue
        try:
            groups.setdefault((block, paragraph), []).append(
                (text.strip(), Decimal(confidence), int(left), int(top), int(width), int(height))
            )
        except (InvalidOperation, ValueError):
            continue
    result: list[tuple[str, int, dict[str, Decimal] | None, Decimal]] = []
    for words in groups.values():
        values = [word[0] for word in words]
        confidence = max(
            Decimal("0"),
            min(Decimal("1"), sum(word[1] for word in words) / (100 * len(words))),
        )
        left = min(word[2] for word in words)
        top = min(word[3] for word in words)
        right = max(word[2] + word[4] for word in words)
        bottom = max(word[3] + word[5] for word in words)
        mapped_left, mapped_top, mapped_width, mapped_height = _map_rotated_tile_box(
            left,
            top,
            right - left,
            bottom - top,
            tile_width=tile_width or page_width,
            tile_height=tile_height or page_height,
            rotation=rotation,
        )
        bbox = {
            "x": (Decimal(mapped_left + x_offset) / Decimal(page_width)).quantize(
                Decimal("0.000001")
            ),
            "y": (Decimal(mapped_top + y_offset) / Decimal(page_height)).quantize(
                Decimal("0.000001")
            ),
            "width": (Decimal(mapped_width) / Decimal(page_width)).quantize(
                Decimal("0.000001")
            ),
            "height": (Decimal(mapped_height) / Decimal(page_height)).quantize(
                Decimal("0.000001")
            ),
        }
        result.append(
            (" ".join(values), page_number, bbox, confidence.quantize(Decimal("0.0001")))
        )
    return result


def _map_rotated_tile_box(
    left: int,
    top: int,
    width: int,
    height: int,
    *,
    tile_width: int,
    tile_height: int,
    rotation: int,
) -> tuple[int, int, int, int]:
    """Map a Tesseract box from a Pillow-rotated tile back to source pixels."""

    if rotation == 0:
        return left, top, width, height
    if rotation == 90:  # Pillow positive degrees are counter-clockwise.
        return tile_width - (top + height), left, height, width
    if rotation == 270:
        return top, tile_height - (left + width), height, width
    raise ValueError("Rotación OCR no admitida")


def _box_distance(first: dict[str, Decimal], second: dict[str, Decimal]) -> Decimal:
    """Return the normalized edge distance between two OCR boxes on one page."""

    first_right = first["x"] + first["width"]
    first_bottom = first["y"] + first["height"]
    second_right = second["x"] + second["width"]
    second_bottom = second["y"] + second["height"]
    horizontal = max(first["x"] - second_right, second["x"] - first_right, Decimal("0"))
    vertical = max(first["y"] - second_bottom, second["y"] - first_bottom, Decimal("0"))
    return max(horizontal, vertical)


def _union_bbox(boxes: list[dict[str, Decimal]]) -> dict[str, Decimal]:
    left = min(box["x"] for box in boxes)
    top = min(box["y"] for box in boxes)
    right = max(box["x"] + box["width"] for box in boxes)
    bottom = max(box["y"] + box["height"] for box in boxes)
    return {
        "x": left,
        "y": top,
        "width": right - left,
        "height": bottom - top,
    }


def _semantic_ocr_blocks(
    blocks: list[tuple[str, int, dict[str, Decimal] | None, Decimal]],
) -> list[tuple[str, int, dict[str, Decimal] | None, Decimal]]:
    """Reassemble only nearby OCR paragraphs around a real Tendon anchor.

    A dense plan often makes Tesseract start a separate paragraph for ``S``, ``L`` or ``Elong``.
    We do not join generic neighbouring numbers.  A composite block is emitted only if a Tendon
    anchor and the three named fields are all within a small normalized neighbourhood on the same
    tile/page.  The original blocks remain available so ordinary one-paragraph labels are not
    degraded.
    """

    composite: list[tuple[str, int, dict[str, Decimal] | None, Decimal]] = []
    threshold = Decimal("0.030000")
    for anchor_text, page, anchor_bbox, anchor_confidence in blocks:
        if anchor_bbox is None or TENDON_PATTERN.search(anchor_text) is None:
            continue
        selected = [(anchor_text, anchor_bbox, anchor_confidence)]
        patterns = (STRAND_PATTERN, LENGTH_PATTERN, ELONGATION_PATTERN)
        for pattern in patterns:
            if pattern.search(anchor_text):
                continue
            matches = [
                (text, bbox, confidence)
                for text, candidate_page, bbox, confidence in blocks
                if candidate_page == page
                and bbox is not None
                and pattern.search(text)
                and _box_distance(anchor_bbox, bbox) <= threshold
            ]
            if not matches:
                selected = []
                break
            selected.append(
                min(matches, key=lambda value: _box_distance(anchor_bbox, value[1]))
            )
        if not selected:
            continue
        ordered = sorted(selected, key=lambda value: (value[1]["y"], value[1]["x"]))
        text = " ".join(value[0] for value in ordered)
        if not parse_theory_candidates(text):
            continue
        boxes = [value[1] for value in selected]
        composite.append(
            (
                text,
                page,
                _union_bbox(boxes),
                min(value[2] for value in selected).quantize(Decimal("0.0001")),
            )
        )
    return [*blocks, *composite]


def _pdf_layout(path: Path, max_pdf_pages: int) -> tuple[int, int, int]:
    """Return safe raster dimensions without rendering an entire A0 page first."""

    info = _run(["pdfinfo", str(path)])
    pages_match = PDF_PAGE_COUNT_PATTERN.search(info)
    size_match = PDF_PAGE_SIZE_PATTERN.search(info)
    if pages_match is None or size_match is None:
        raise RuntimeError("No fue posible inspeccionar el tamaño del plano PDF")
    page_count = int(pages_match.group("pages"))
    if page_count <= 0 or page_count > max_pdf_pages:
        raise RuntimeError(f"El PDF supera el máximo de {max_pdf_pages} páginas para OCR")
    width = int(
        (Decimal(size_match.group("width")) * OCR_DPI / Decimal("72")).to_integral_value()
    )
    height = int(
        (Decimal(size_match.group("height")) * OCR_DPI / Decimal("72")).to_integral_value()
    )
    rotation_match = PDF_PAGE_ROTATION_PATTERN.search(info)
    rotation = int(rotation_match.group("rotation")) if rotation_match else 0
    if rotation % 180:
        width, height = height, width
    if width <= 0 or height <= 0 or width * height > MAX_OCR_PDF_RENDER_PIXELS:
        raise RuntimeError("El plano PDF supera el límite de píxeles para OCR")
    return page_count, width, height


def _tile_offsets(total: int) -> list[int]:
    if total <= OCR_TILE_SIZE_PX:
        return [0]
    stride = OCR_TILE_SIZE_PX - OCR_TILE_OVERLAP_PX
    span = total - OCR_TILE_SIZE_PX
    tile_count = (span + stride - 1) // stride + 1
    # Distribute the last tile across the page instead of creating a near-duplicate final tile.
    return [round(index * span / (tile_count - 1)) for index in range(tile_count)]


def _ocr_tsv(path: Path) -> str:
    return _run(
        ["tesseract", str(path), "stdout", "-l", "spa+eng", "--psm", "11", "tsv"],
        timeout=180,
    )


def _ocr_passes(path: Path) -> list[tuple[int, str]]:
    """Read sparse text in source orientation plus both right-angle alternatives.

    CAD plans commonly place labels along a vertical tendon.  PDF page rotation alone does not
    make each label horizontal, so boxes from rotated copies are transformed back before review.
    """

    results = [(0, _ocr_tsv(path))]
    try:
        with Image.open(path) as image:
            for rotation in (90, 270):
                rotated_path = path.with_name(f"{path.stem}-ocr-{rotation}.png")
                rotated = image.rotate(rotation, expand=True)
                try:
                    rotated.save(rotated_path, format="PNG")
                finally:
                    rotated.close()
                results.append((rotation, _ocr_tsv(rotated_path)))
    except (OSError, ValueError) as exc:
        raise RuntimeError("No fue posible preparar las orientaciones OCR") from exc
    return results


def _ocr_blocks(
    path: Path, mime_type: str, max_pdf_pages: int
) -> tuple[list[tuple[str, int, dict[str, Decimal] | None, Decimal]], str, int]:
    with tempfile.TemporaryDirectory(prefix="obrixapy-elongations-") as temporary_directory:
        temporary_path = Path(temporary_directory)
        blocks: list[tuple[str, int, dict[str, Decimal] | None, Decimal]] = []
        text_parts: list[str] = []
        if mime_type == "application/pdf":
            page_count, page_width, page_height = _pdf_layout(path, max_pdf_pages)
            for page_number in range(1, page_count + 1):
                for row_index, y_offset in enumerate(_tile_offsets(page_height)):
                    for column_index, x_offset in enumerate(_tile_offsets(page_width)):
                        tile_width = min(OCR_TILE_SIZE_PX, page_width - x_offset)
                        tile_height = min(OCR_TILE_SIZE_PX, page_height - y_offset)
                        prefix = temporary_path / f"page-{page_number}-{row_index}-{column_index}"
                        _run(
                            [
                                "pdftoppm",
                                "-f",
                                str(page_number),
                                "-l",
                                str(page_number),
                                "-singlefile",
                                "-png",
                                "-r",
                                str(OCR_DPI),
                                "-x",
                                str(x_offset),
                                "-y",
                                str(y_offset),
                                "-W",
                                str(tile_width),
                                "-H",
                                str(tile_height),
                                str(path),
                                str(prefix),
                            ],
                            timeout=180,
                        )
                        rendered = prefix.with_suffix(".png")
                        if not rendered.is_file():
                            raise RuntimeError("No fue posible renderizar un mosaico del plano")
                        for rotation, tsv in _ocr_passes(rendered):
                            page_blocks = _parse_tsv_blocks(
                                tsv,
                                page_number=page_number,
                                x_offset=x_offset,
                                y_offset=y_offset,
                                page_width=page_width,
                                page_height=page_height,
                                tile_width=tile_width,
                                tile_height=tile_height,
                                rotation=rotation,
                            )
                            semantic_blocks = _semantic_ocr_blocks(page_blocks)
                            blocks.extend(semantic_blocks)
                            text_parts.extend(text for text, _, _, _ in semantic_blocks)
            return blocks, "tesseract-spa-eng-psm11-tiles-rotations", page_count
        try:
            with Image.open(path) as image:
                page_width, page_height = image.size
        except (OSError, ValueError) as exc:
            raise RuntimeError("No fue posible inspeccionar la imagen del plano") from exc
        if page_width * page_height > MAX_OCR_IMAGE_PIXELS:
            raise RuntimeError("La imagen del plano supera el límite de píxeles para OCR")
        for rotation, tsv in _ocr_passes(path):
            page_blocks = _parse_tsv_blocks(
                tsv,
                page_number=1,
                x_offset=0,
                y_offset=0,
                page_width=page_width,
                page_height=page_height,
                tile_width=page_width,
                tile_height=page_height,
                rotation=rotation,
            )
            semantic_blocks = _semantic_ocr_blocks(page_blocks)
            blocks.extend(semantic_blocks)
            text_parts.extend(text for text, _, _, _ in semantic_blocks)
        return blocks, "tesseract-spa-eng-psm11-rotations", 1


def extract_theory(path: Path, mime_type: str, max_pdf_pages: int = 25) -> TheoryExtraction:
    """Use vector text first, then OCR when semantic coverage is not sufficient.

    Text volume is deliberately irrelevant: a title block with hundreds of characters is not a
    successful extraction until at least one complete Tendon/S/L/Elong group exists.
    """

    vector_candidates: list[TheoryCandidate] = []
    text_parts: list[str] = []
    page_count = 0
    if mime_type == "application/pdf":
        page_count, rendered_width, rendered_height = _pdf_layout(path, max_pdf_pages)
        vector_blocks, page_count = _vector_blocks(
            path,
            rendered_width=rendered_width,
            rendered_height=rendered_height,
        )
        for block, page, bbox in vector_blocks:
            text_parts.append(block)
            vector_candidates.extend(
                parse_theory_candidates(
                    block,
                    page=page,
                    bbox=bbox,
                    field_confidence={
                        "label": Decimal("1"),
                        "strand_count": Decimal("1"),
                        "length_m": Decimal("1"),
                        "calculated_elongation_cm": Decimal("1"),
                    },
                )
            )
    if vector_candidates:
        candidates = deduplicate_candidates(vector_candidates)
        return TheoryExtraction(
            extracted_text="\n".join(text_parts)[:60000],
            candidates=tuple(candidates),
            page_count=page_count,
            engine="pdftotext-bbox",
        )

    ocr_blocks, engine, ocr_page_count = _ocr_blocks(path, mime_type, max_pdf_pages)
    ocr_candidates: list[TheoryCandidate] = []
    for block, page, bbox, confidence in ocr_blocks:
        text_parts.append(block)
        field_confidence = {
            "label": confidence,
            "strand_count": confidence,
            "length_m": confidence,
            "calculated_elongation_cm": confidence,
        }
        ocr_candidates.extend(
            parse_theory_candidates(
                block,
                page=page,
                bbox=bbox,
                field_confidence=field_confidence,
            )
        )
    return TheoryExtraction(
        extracted_text="\n".join(text_parts)[:60000],
        candidates=tuple(deduplicate_candidates(ocr_candidates)),
        page_count=page_count or ocr_page_count,
        engine=engine,
        warnings=("No hubo candidatos completos en texto vectorial; se aplicó OCR por bloques.",),
    )
