"""Reglas de mediciones reales: listas manuscritas, ordinales y tolerancias."""

from __future__ import annotations

import re
import subprocess
import tempfile
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Protocol

from PIL import Image, ImageEnhance, ImageOps

from app.services.elongations.theory import (
    ELONGATION_PATTERN,
    LENGTH_PATTERN,
    STRAND_PATTERN,
    TENDON_PATTERN,
    decimal_from_ocr,
)

HANDWRITTEN_NUMBER = re.compile(r"(?<![A-Za-z0-9])\d+(?:[.,]\d{1,3})?(?![A-Za-z0-9])")
PAPER_EDGE_THRESHOLD = 180
MAX_PERSPECTIVE_SCAN_SIDE = 1200


@dataclass(frozen=True)
class MeasurementRead:
    ordinal: int
    measured_elongation_cm: Decimal | None
    status: str


class HandwritingProvider(Protocol):
    """Optional provider boundary; every output remains a human-review suggestion."""

    name: str
    version: str

    def read(self, crop: bytes) -> tuple[list[Decimal], Decimal]: ...


@dataclass(frozen=True)
class LocalManualHandwritingProvider:
    """Default, no-network provider: manual confirmation is required for handwriting."""

    name: str = "local-manual"
    version: str = "1"

    def read(self, crop: bytes) -> tuple[list[Decimal], Decimal]:
        del crop
        return [], Decimal("0")


def parse_handwritten_values(text: str) -> list[Decimal]:
    """Read a handwritten list without treating a hyphen as subtraction.

    Printed anchors (``Tendon 321``/``S=4``/``L...``/``Elong...``) are removed before scanning
    values so identifiers and theory do not become measurements.
    """

    without_anchors = TENDON_PATTERN.sub(" ", text)
    without_anchors = STRAND_PATTERN.sub(" ", without_anchors)
    without_anchors = LENGTH_PATTERN.sub(" ", without_anchors)
    without_anchors = ELONGATION_PATTERN.sub(" ", without_anchors)
    values: list[Decimal] = []
    for match in HANDWRITTEN_NUMBER.finditer(without_anchors):
        value = decimal_from_ocr(match.group(0))
        if value >= 0:
            values.append(value)
    return values


def expand_measurement_slots(
    strand_count: int, values: list[Decimal]
) -> tuple[list[MeasurementRead], list[Decimal]]:
    """Create exactly the physical ``S`` slots and retain extras separately.

    Extras deliberately do not become invented tendons.  Callers must keep them in the file/job
    review summary and block final approval until a reviewer resolves them.
    """

    if strand_count <= 0:
        raise ValueError("S debe ser mayor que cero")
    slots = [
        MeasurementRead(
            ordinal=ordinal,
            measured_elongation_cm=values[ordinal - 1] if ordinal <= len(values) else None,
            status="pending" if ordinal <= len(values) else "missing",
        )
        for ordinal in range(1, strand_count + 1)
    ]
    return slots, values[strand_count:]


def tolerance_status(
    calculated_elongation_cm: Decimal,
    measured_elongation_cm: Decimal | None,
    tolerance_percent: Decimal,
    *,
    unresolved: bool = False,
) -> str:
    """Return a presentation state while keeping limits as derived Decimal values."""

    if unresolved:
        return "unresolved"
    if measured_elongation_cm is None:
        return "missing"
    tolerance = tolerance_percent / Decimal("100")
    maximum = calculated_elongation_cm + (calculated_elongation_cm * tolerance)
    minimum = calculated_elongation_cm - (calculated_elongation_cm * tolerance)
    return "within" if minimum <= measured_elongation_cm <= maximum else "outside"


def parse_labeled_measurements(text: str) -> list[tuple[str, str, list[Decimal]]]:
    """Associate only values that have a nearby printed Tendon label anchor."""

    labels = list(TENDON_PATTERN.finditer(text))
    readings: list[tuple[str, str, list[Decimal]]] = []
    for index, label_match in enumerate(labels):
        next_start = labels[index + 1].start() if index + 1 < len(labels) else len(text)
        block = text[label_match.start() : min(next_start, label_match.start() + 600)]
        label_number = int(label_match.group("value"))
        values = parse_handwritten_values(block)
        readings.append((f"T{label_number}", " ".join(block.split())[:5000], values))
    return readings


def _run(command: list[str], timeout: int = 180) -> str:
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("El motor de lectura de mediciones no está instalado") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("La lectura de mediciones tardó demasiado") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError((exc.stderr or "No fue posible leer las mediciones")[:300]) from exc
    return completed.stdout


def _document_quad(image: Image.Image) -> tuple[float, ...] | None:
    """Find a conservative bright-paper quadrilateral for local perspective correction.

    This intentionally refuses uncertain frames.  It is a convenience for a photographed white
    sheet on a darker background, not a substitute for a technician's visual verification.
    """

    width, height = image.size
    if width < 80 or height < 80:
        return None
    scale = min(1, MAX_PERSPECTIVE_SCAN_SIDE / max(width, height))
    sample = ImageOps.grayscale(image)
    if scale < 1:
        sample = sample.resize(
            (round(width * scale), round(height * scale)),
            resample=Image.Resampling.BILINEAR,
        )
    sample_width, sample_height = sample.size
    rows: list[tuple[int, int, int]] = []
    minimum_span = max(16, sample_width // 5)
    pixels = sample.load()
    for y in range(sample_height):
        bright = [x for x in range(sample_width) if pixels[x, y] >= PAPER_EDGE_THRESHOLD]
        if len(bright) >= minimum_span:
            rows.append((y, min(bright), max(bright)))
    if len(rows) < sample_height // 3:
        return None
    top_rows = rows[: max(3, len(rows) // 12)]
    bottom_rows = rows[-max(3, len(rows) // 12) :]
    top_y, top_left, top_right = top_rows[len(top_rows) // 2]
    bottom_y, bottom_left, bottom_right = bottom_rows[len(bottom_rows) // 2]
    top_span = top_right - top_left
    bottom_span = bottom_right - bottom_left
    vertical_span = bottom_y - top_y
    if (
        top_span < minimum_span
        or bottom_span < minimum_span
        or vertical_span < sample_height // 3
    ):
        return None
    inverse_scale = 1 / scale
    # Pillow QUAD expects source corners in UL, LL, LR, UR order.
    return (
        top_left * inverse_scale,
        top_y * inverse_scale,
        bottom_left * inverse_scale,
        bottom_y * inverse_scale,
        bottom_right * inverse_scale,
        bottom_y * inverse_scale,
        top_right * inverse_scale,
        top_y * inverse_scale,
    )


def _perspective_correct(image: Image.Image) -> tuple[Image.Image, bool]:
    quad = _document_quad(image)
    if quad is None:
        return image.copy(), False
    top_left = (quad[0], quad[1])
    bottom_left = (quad[2], quad[3])
    bottom_right = (quad[4], quad[5])
    top_right = (quad[6], quad[7])
    width = round(max(abs(top_right[0] - top_left[0]), abs(bottom_right[0] - bottom_left[0])))
    height = round(max(abs(bottom_left[1] - top_left[1]), abs(bottom_right[1] - top_right[1])))
    if width < 80 or height < 80:
        return image.copy(), False
    return (
        image.transform(
            (width, height),
            Image.Transform.QUAD,
            quad,
            resample=Image.Resampling.BICUBIC,
        ),
        True,
    )


def extract_measurement_text(
    path: Path, mime_type: str, max_pdf_pages: int = 25
) -> tuple[str, str]:
    """Read local scans with orientation/contrast normalization and no external provider.

    The original is never changed: a temporary EXIF-corrected, contrast-enhanced derivative is
    sent to Tesseract.  Handwriting remains ``pending`` regardless of the returned digits.
    """

    with tempfile.TemporaryDirectory(prefix="obrixapy-measurements-") as temporary_directory:
        temporary_path = Path(temporary_directory)
        if mime_type == "application/pdf":
            prefix = temporary_path / "page"
            _run(
                [
                    "pdftoppm",
                    "-f",
                    "1",
                    "-l",
                    str(max_pdf_pages),
                    "-png",
                    "-r",
                    "300",
                    str(path),
                    str(prefix),
                ],
                timeout=300,
            )
            sources = sorted(temporary_path.glob("page-*.png"))
        else:
            sources = [path]
        pages: list[str] = []
        perspective_applied = False
        for index, source in enumerate(sources, start=1):
            output = temporary_path / f"normalised-{index}.png"
            try:
                with Image.open(source) as image:
                    oriented = ImageOps.exif_transpose(image).convert("RGB")
                    try:
                        corrected, applied = _perspective_correct(oriented)
                        perspective_applied = perspective_applied or applied
                        try:
                            normalised = ImageOps.autocontrast(corrected.convert("L"))
                            normalised = ImageEnhance.Contrast(normalised).enhance(1.35)
                            normalised.save(output, format="PNG", optimize=True)
                        finally:
                            corrected.close()
                    finally:
                        oriented.close()
            except (OSError, ValueError) as exc:
                raise RuntimeError("No fue posible normalizar la foto de mediciones") from exc
            pages.append(_run(["tesseract", str(output), "stdout", "-l", "spa+eng", "--psm", "11"]))
        engine = "tesseract-spa-eng-psm11-local"
        if perspective_applied:
            engine = f"{engine}-perspective"
        return "\n".join(pages)[:60000], engine
