"""Validación, lectura y reconstrucción segura de la plantilla XLSX V2."""

from __future__ import annotations

import re
import unicodedata
from copy import copy
from dataclasses import asdict, dataclass
from decimal import Decimal
from io import BytesIO
from pathlib import PurePosixPath
from typing import Any
from zipfile import BadZipFile, ZipFile

from openpyxl import Workbook, load_workbook
from openpyxl.cell.cell import Cell
from openpyxl.formatting.formatting import ConditionalFormattingList
from openpyxl.formatting.rule import FormulaRule
from openpyxl.formula.translate import Translator
from openpyxl.styles import Alignment, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.pagebreak import Break, RowBreak

MAX_TEMPLATE_BYTES = 20 * 1024 * 1024
MAX_TEMPLATE_UNCOMPRESSED_BYTES = 150 * 1024 * 1024
MAX_TEMPLATE_COMPRESSION_RATIO = 120
XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
FORMULA_REFERENCE = re.compile(r"\$?([A-Z]{1,3})\$?(\d+)")


class TemplateValidationError(ValueError):
    """The uploaded workbook is unsafe or cannot supply the required operational structure."""


@dataclass(frozen=True)
class TemplateSection:
    name: str
    section_row: int
    header_row: int
    body_start_row: int
    body_end_row: int
    formula_seed_row: int


@dataclass(frozen=True)
class TemplateMapping:
    sheet_name: str
    sections: dict[str, TemplateSection]
    columns: dict[str, int]
    formula_seeds: dict[str, str]
    tolerance_percent: Decimal
    warnings: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "sheet_name": self.sheet_name,
            "sections": {name: asdict(section) for name, section in self.sections.items()},
            "columns": self.columns,
            "formula_seeds": self.formula_seeds,
            "tolerance_percent": str(self.tolerance_percent),
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True)
class TemplateGroupSlot:
    """Presentation of a source group, independent of its example label or class."""

    label_key: str
    prototypes: tuple[dict[str, Any], ...]
    spacer_prototypes: tuple[dict[str, Any], ...] = ()



@dataclass(frozen=True)
class TemplateHeaderSnapshot:
    """A title/spacer/header block restored after the preceding section grows."""

    row_count: int
    cells: tuple[tuple[int, int, Any, Any], ...]
    row_dimensions: tuple[tuple[int, float | None, bool, int, bool], ...]
    merged_ranges: tuple[tuple[int, int, int, int], ...]


def _normalise(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^A-Za-z0-9]+", " ", text.upper())
    return " ".join(text.split())


def validate_template_bytes(content: bytes, filename: str | None = None) -> None:
    """Reject malformed OOXML, macros, external links and compressed bombs before parsing."""

    if not content:
        raise TemplateValidationError("La plantilla XLSX está vacía")
    if len(content) > MAX_TEMPLATE_BYTES:
        raise TemplateValidationError("La plantilla XLSX supera el tamaño máximo permitido")
    if filename and not filename.lower().endswith(".xlsx"):
        raise TemplateValidationError("La plantilla debe tener extensión .xlsx")
    try:
        with ZipFile(BytesIO(content)) as archive:
            infos = archive.infolist()
            if not infos:
                raise TemplateValidationError("La plantilla XLSX no contiene archivos")
            total_uncompressed = sum(info.file_size for info in infos)
            if total_uncompressed > MAX_TEMPLATE_UNCOMPRESSED_BYTES:
                raise TemplateValidationError("La plantilla XLSX se expande demasiado al abrirse")
            if total_uncompressed > len(content) * MAX_TEMPLATE_COMPRESSION_RATIO:
                raise TemplateValidationError("La compresión de la plantilla XLSX no es segura")
            names = set(archive.namelist())
            required = {"[Content_Types].xml", "xl/workbook.xml"}
            if not required.issubset(names):
                raise TemplateValidationError("El archivo no es una plantilla XLSX válida")
            for name in names:
                path = PurePosixPath(name)
                if path.is_absolute() or ".." in path.parts:
                    raise TemplateValidationError("La plantilla XLSX contiene rutas inválidas")
                if name.lower().endswith("vbaProject.bin".lower()):
                    raise TemplateValidationError("No se permiten macros en la plantilla")
            for name in names:
                if name.endswith(".rels") or "externalLinks" in name:
                    relation = archive.read(name)
                    if b'TargetMode="External"' in relation or b"externalLink" in relation:
                        raise TemplateValidationError(
                            "No se permiten enlaces externos en la plantilla"
                        )
    except BadZipFile as exc:
        raise TemplateValidationError("El archivo no es un XLSX ZIP válido") from exc


def _cell_containing(ws: Any, predicate: Any) -> tuple[int, int] | None:
    for row in ws.iter_rows():
        for cell in row:
            if predicate(_normalise(cell.value)):
                return cell.row, cell.column
    return None


def _find_section(ws: Any, expected: str) -> int:
    match = _cell_containing(ws, lambda value: value == expected)
    if match is None:
        raise TemplateValidationError(
            f"No se encontró la sección {expected.title()} en la plantilla"
        )
    return match[0]


def _row_has_required_headers(ws: Any, row_number: int) -> bool:
    """Return whether a row contains the stable, semantic template headings."""

    values = [
        _normalise(ws.cell(row_number, column).value) for column in range(1, ws.max_column + 1)
    ]
    joined = " ".join(values)
    return "ITEM" in joined and "LABEL" in joined and "LONGITUD" in joined and "CANTIDAD" in joined


def _find_header_row(ws: Any, section_row: int) -> int:
    """Find headers placed either after or immediately before a section title.

    Legacy templates repeat their headers below ``BANDAS`` and ``DISTRIBUIDOS``.
    Operational templates supplied by the field team keep one shared header above
    ``BANDAS`` and only repeat the section label later.  Both structures remain
    safe because the complete required column set is still checked separately.
    """

    for row_number in range(section_row + 1, min(ws.max_row, section_row + 10) + 1):
        if _row_has_required_headers(ws, row_number):
            return row_number
    for row_number in range(section_row - 1, max(0, section_row - 11), -1):
        if _row_has_required_headers(ws, row_number):
            return row_number
    raise TemplateValidationError("No se localizaron las columnas obligatorias de la plantilla")


def _section_body_start_row(ws: Any, section_row: int, header_row: int) -> int:
    """Keep the title and spacer row when a template shares headers above it."""

    if header_row < section_row:
        # A shared heading can be followed immediately by the first group. Do not
        # skip that group merely because another template contains a spacer.
        row = section_row + 1
        if any(
            _label_key(cell.value).startswith("T") and _positive_integer(_label_key(cell.value)[1:])
            for cell in ws[row]
        ):
            return row
        return section_row + 2
    return header_row + 2


def _find_columns(ws: Any, header_row: int) -> dict[str, int]:
    columns: dict[str, int] = {}
    for row_number in (header_row, header_row + 1):
        for column in range(1, ws.max_column + 1):
            value = _normalise(ws.cell(row_number, column).value)
            if value == "ITEM":
                columns.setdefault("item", column)
            elif value == "LABEL":
                columns.setdefault("label", column)
            elif "LONGITUD" in value:
                columns.setdefault("length_m", column)
            elif "CANTIDAD" in value and "TENDON" in value:
                columns.setdefault("strand_count", column)
            elif value == "CALCULADA":
                columns.setdefault("calculated", column)
            elif value.startswith("MAX"):
                columns.setdefault("maximum", column)
            elif "MEDIDA" in value:
                columns.setdefault("measured", column)
            elif value.startswith("MIN"):
                columns.setdefault("minimum", column)
    missing = {
        "item",
        "label",
        "length_m",
        "strand_count",
        "calculated",
        "maximum",
        "measured",
        "minimum",
    } - set(columns)
    if missing:
        raise TemplateValidationError(
            f"Faltan columnas requeridas en la plantilla: {', '.join(sorted(missing))}"
        )
    return columns


def _formula_references_own_calculated_row(formula: str, calculated_column: int, row: int) -> bool:
    if not formula.startswith("=") or "#REF!" in formula.upper():
        return False
    expected = get_column_letter(calculated_column)
    references = FORMULA_REFERENCE.findall(formula.upper())
    return bool(references) and all(
        column == expected and int(reference_row) == row for column, reference_row in references
    )


def _formula_signature(formula: str, origin: str, destination: str) -> str:
    return Translator(formula, origin=origin).translate_formula(destination)


def _formula_tolerance(formula: str) -> Decimal | None:
    match = re.search(r"\*\s*\(?\s*(0[.,]\d+|\d+[.,]\d+)\s*\)?", formula)
    if not match:
        return None
    return Decimal(match.group(1).replace(",", ".")) * Decimal("100")


def _find_formula_seed(
    ws: Any,
    start_row: int,
    end_row: int,
    columns: dict[str, int],
    warnings: list[str],
) -> tuple[int, dict[str, str], Decimal]:
    formula_pairs: list[tuple[int, str, str]] = []
    broken = 0
    for row in range(start_row, end_row + 1):
        maximum = ws.cell(row, columns["maximum"]).value
        minimum = ws.cell(row, columns["minimum"]).value
        if not isinstance(maximum, str) or not isinstance(minimum, str):
            continue
        if not (
            _formula_references_own_calculated_row(maximum, columns["calculated"], row)
            and _formula_references_own_calculated_row(minimum, columns["calculated"], row)
        ):
            broken += 1
            continue
        max_signature = _formula_signature(
            maximum,
            f"{get_column_letter(columns['maximum'])}{row}",
            f"{get_column_letter(columns['maximum'])}1",
        )
        min_signature = _formula_signature(
            minimum,
            f"{get_column_letter(columns['minimum'])}{row}",
            f"{get_column_letter(columns['minimum'])}1",
        )
        formula_pairs.append((row, max_signature, min_signature))
    if broken:
        warnings.append(f"Se detectaron {broken} fórmulas Max./Min. heredadas inválidas")
    if not formula_pairs:
        raise TemplateValidationError("No existe una fila con fórmulas Max./Min. válidas")
    counts: dict[tuple[str, str], int] = {}
    for _, max_signature, min_signature in formula_pairs:
        counts[(max_signature, min_signature)] = counts.get((max_signature, min_signature), 0) + 1
    (dominant_max, dominant_min), dominant_count = max(counts.items(), key=lambda entry: entry[1])
    if dominant_count * 2 <= len(formula_pairs):
        raise TemplateValidationError("No existe una regla Max./Min. dominante y segura")
    seed_row = next(
        row
        for row, max_signature, min_signature in formula_pairs
        if (max_signature, min_signature) == (dominant_max, dominant_min)
    )
    tolerance = _formula_tolerance(ws.cell(seed_row, columns["maximum"]).value)
    if tolerance is None or tolerance < 0 or tolerance > 100:
        raise TemplateValidationError("No fue posible determinar la tolerancia desde la fórmula")
    return (
        seed_row,
        {
            "maximum": dominant_max,
            "minimum": dominant_min,
        },
        tolerance,
    )


def analyse_template(content: bytes, filename: str | None = None) -> TemplateMapping:
    """Discover visual structure and a verified dominant formula, never fixed cell addresses."""

    validate_template_bytes(content, filename)
    try:
        workbook = load_workbook(BytesIO(content), data_only=False, keep_vba=False)
    except Exception as exc:  # openpyxl groups multiple malformed OOXML exceptions
        raise TemplateValidationError("No fue posible abrir la plantilla XLSX") from exc
    worksheet = workbook.active
    band_row = _find_section(worksheet, "BANDAS")
    distributed_row = _find_section(worksheet, "DISTRIBUIDOS")
    if distributed_row <= band_row:
        raise TemplateValidationError(
            "Las secciones BANDAS y DISTRIBUIDOS están en un orden inválido"
        )
    band_header = _find_header_row(worksheet, band_row)
    warnings: list[str] = []
    try:
        distributed_header = _find_header_row(worksheet, distributed_row)
    except TemplateValidationError:
        # Some production templates have a single heading above BANDAS and no
        # duplicate heading near DISTRIBUIDOS.  Reusing a fully validated
        # heading is safer than guessing columns by position.
        distributed_header = band_header
        warnings.append("Distribuidos reutiliza los encabezados compartidos de Bandas")
    columns = _find_columns(worksheet, band_header)
    distributed_columns = _find_columns(worksheet, distributed_header)
    if columns != distributed_columns:
        raise TemplateValidationError(
            "Las secciones de la plantilla no comparten las mismas columnas"
        )
    band_start = _section_body_start_row(worksheet, band_row, band_header)
    distributed_start = _section_body_start_row(worksheet, distributed_row, distributed_header)
    band_seed, formulas, tolerance = _find_formula_seed(
        worksheet, band_start, distributed_row - 1, columns, warnings
    )
    distributed_seed, distributed_formulas, distributed_tolerance = _find_formula_seed(
        worksheet, distributed_start, worksheet.max_row, columns, warnings
    )
    if tolerance != distributed_tolerance or formulas != distributed_formulas:
        warnings.append(
            "La sección Distribuidos usa una fórmula diferente; se aplicará la regla dominante"
        )
    return TemplateMapping(
        sheet_name=worksheet.title,
        sections={
            "band": TemplateSection(
                "band", band_row, band_header, band_start, distributed_row - 1, band_seed
            ),
            "distributed": TemplateSection(
                "distributed",
                distributed_row,
                distributed_header,
                distributed_start,
                worksheet.max_row,
                distributed_seed,
            ),
        },
        columns=columns,
        formula_seeds=formulas,
        tolerance_percent=tolerance.quantize(Decimal("0.01")),
        warnings=tuple(warnings),
    )


def _prototype(ws: Any, row: int, columns: dict[str, int]) -> dict[str, Any]:
    return {
        "cells": {
            column: copy(ws.cell(row, column)._style) for column in range(1, ws.max_column + 1)
        },
        "height": ws.row_dimensions[row].height,
        "number_formats": {
            key: ws.cell(row, column).number_format for key, column in columns.items()
        },
    }


def _physical_row_prototype(ws: Any, row: int, columns: dict[str, int]) -> dict[str, Any]:
    """Collapse a physical slot without losing its formula helpers or lower border."""

    prototype = _prototype(ws, row, columns)
    end = _merged_end_row(ws, row, (columns["item"],))
    default_height = ws.sheet_format.defaultRowHeight or 15
    prototype["height"] = sum(
        ws.row_dimensions[index].height or default_height for index in range(row, end + 1)
    )
    largest_font = max(ws.cell(row, col).font.sz or 11 for col in columns.values())
    prototype["height"] = max(prototype["height"], largest_font * 1.5 + 3)
    for col in range(1, ws.max_column + 1):
        cell = ws.cell(row, col)
        style = copy(cell._style)
        if style is not None and end > row:
            border = copy(cell.border)
            bottom = ws.cell(end, col).border.bottom
            if bottom.style is not None:
                border.bottom = copy(bottom)
            detached = Cell(ws, row=row, column=col)
            detached._style = style
            detached.border = border
            style = copy(detached._style)
        prototype["cells"][col] = style
    prototype["source_end_row"] = end
    prototype["formula_origin_row"] = row
    prototype["formulas"] = {
        col: cell.value
        for col in range(1, ws.max_column + 1)
        if isinstance((cell := ws.cell(row, col)).value, str) and cell.value.startswith("=")
    }
    return prototype


def _label_key(value: object) -> str:
    """Return a stable key for both ``T200`` and ``Tendon 200`` template labels."""

    normalised = _normalise(value)
    tendon = re.search(r"\b(?:TENDON|T)\s*0*(\d+)\b", normalised)
    if tendon:
        return f"T{int(tendon.group(1))}"
    return normalised


def _positive_integer(value: object) -> int | None:
    """Read a positive source S value without guessing from arbitrary text."""

    if isinstance(value, bool) or value is None:
        return None
    try:
        number = Decimal(str(value))
    except Exception:  # noqa: BLE001 - cells may contain labels or formulas
        return None
    if number <= 0 or number != number.to_integral_value():
        return None
    return int(number)


def _merged_end_row(ws: Any, row: int, columns: tuple[int, ...]) -> int:
    """Find the visual end of a source group from its merged key cells."""

    end_row = row
    for merged_range in ws.merged_cells.ranges:
        if merged_range.min_row != row:
            continue
        if any(merged_range.min_col <= column <= merged_range.max_col for column in columns):
            end_row = max(end_row, merged_range.max_row)
    return end_row


def _row_is_empty(ws: Any, row: int) -> bool:
    return all(ws.cell(row, column).value is None for column in range(1, ws.max_column + 1))


def _template_group_slots(
    ws: Any,
    mapping: TemplateMapping,
    section_name: str,
) -> list[TemplateGroupSlot]:
    """Read the original label order and group-specific row presentation.

    A production workbook often carries a deliberately arranged sequence (for
    example T200, T201, T202 in BANDAS).  Previous exports ignored it, rebuilt
    every row from one generic prototype and regrouped those labels by OCR class.
    This helper captures each existing block before rows are replaced.
    """

    section = mapping.sections[section_name]
    label_column = mapping.columns["label"]
    strand_column = mapping.columns["strand_count"]
    starts: list[tuple[int, str]] = []
    for row in range(section.body_start_row, section.body_end_row + 1):
        key = _label_key(ws.cell(row, label_column).value)
        if not re.fullmatch(r"T\d+", key):
            continue
        starts.append((row, key))

    slots: list[TemplateGroupSlot] = []
    for index, (row, key) in enumerate(starts):
        has_next_group = index + 1 < len(starts)
        next_row = starts[index + 1][0] if has_next_group else section.body_end_row + 1
        source_count = _positive_integer(ws.cell(row, strand_column).value) or 1
        merged_end = _merged_end_row(
            ws,
            row,
            (label_column, mapping.columns["length_m"], strand_column),
        )
        group_end = min(next_row - 1, max(row + source_count - 1, merged_end))
        physical_rows = []
        source_row = row
        while source_row <= group_end:
            prototype = _physical_row_prototype(ws, source_row, mapping.columns)
            physical_rows.append(prototype)
            source_row = prototype["source_end_row"] + 1
        prototypes = tuple(physical_rows)
        spacer_prototypes = (
            tuple(
                _prototype(ws, source_row, mapping.columns)
                for source_row in range(group_end + 1, next_row)
                if _row_is_empty(ws, source_row)
            )
            if has_next_group
            else ()
        )
        slots.append(
            TemplateGroupSlot(
                label_key=key,
                prototypes=prototypes,
                spacer_prototypes=spacer_prototypes,
            )
        )
    return slots


def _groups_for_template_sections(
    groups: list[dict[str, Any]],
    slots_by_section: dict[str, list[TemplateGroupSlot]],
) -> dict[str, list[tuple[dict[str, Any], TemplateGroupSlot | None]]]:
    """Keep the two operational blocks separate and order Labels inside each one."""

    result: dict[str, list[tuple[dict[str, Any], TemplateGroupSlot | None]]] = {
        "band": [],
        "distributed": [],
    }
    for section_name in ("band", "distributed"):
        slots = {slot.label_key: slot for slot in slots_by_section[section_name]}
        section_groups = [
            group for group in groups if group["classification"] == section_name
        ]
        result[section_name] = [
            (group, slots.get(_label_key(group["label"])))
            for group in sorted(section_groups, key=_group_sort_key)
        ]
    return result


def _group_sort_key(group: dict[str, Any]) -> tuple[int, str]:
    label = _label_key(group["label"])
    match = re.search(r"\d+", label)
    return (int(match.group()) if match else 0, label)


def _prototype_for_group_row(
    slot: TemplateGroupSlot | None,
    ordinal: int,
    physical_count: int,
    fallback: dict[str, Any],
) -> dict[str, Any]:
    """Reuse first/intermediate/last source-row presentation as a group resizes."""

    if slot is None or not slot.prototypes:
        return fallback
    source = slot.prototypes
    if physical_count == 1 or len(source) == 1:
        return source[0]
    if ordinal == physical_count:
        return source[-1]
    return source[min(ordinal - 1, len(source) - 2)]


def _unmerge_body_ranges(ws: Any, start_row: int) -> None:
    for merged_range in list(ws.merged_cells.ranges):
        if merged_range.max_row >= start_row:
            ws.unmerge_cells(str(merged_range))


def _apply_prototype(ws: Any, row: int, prototype: dict[str, Any]) -> None:
    for column, style in prototype["cells"].items():
        ws.cell(row, column)._style = copy(style)
        ws.cell(row, column).value = None
    ws.row_dimensions[row].height = prototype["height"]


def _formula_for_row(seed: str, source_column: int, target_column: int, row: int) -> str:
    translated = Translator(seed, origin=f"{get_column_letter(target_column)}1").translate_formula(
        f"{get_column_letter(target_column)}{row}"
    )
    if not _formula_references_own_calculated_row(translated, source_column, row):
        raise TemplateValidationError(
            "La fórmula trasladada no apunta a Calculada de su propia fila"
        )
    return translated


def _write_section(
    ws: Any,
    mapping: TemplateMapping,
    start_row: int,
    groups: list[tuple[dict[str, Any], TemplateGroupSlot | None]],
    prototypes: dict[str, dict[str, Any]],
    *,
    final: bool,
) -> int:
    columns = mapping.columns
    row_number = start_row
    item_number = 1
    for group, slot in groups:
        prototype = prototypes[group["classification"]]
        physical_count = int(group["strand_count"])
        group_start_row = row_number
        measurements = {int(value["ordinal"]): value for value in group.get("measurements", [])}
        for ordinal in range(1, physical_count + 1):
            row_prototype = _prototype_for_group_row(slot, ordinal, physical_count, prototype)
            _apply_prototype(ws, row_number, row_prototype)
            for column, formula in row_prototype.get("formulas", {}).items():
                if column in columns.values():
                    continue
                ws.cell(row_number, column).value = _translate_template_formula(
                    formula,
                    int(row_prototype.get("formula_origin_row", row_number)),
                    row_number,
                )
            measurement = measurements.get(ordinal)
            ws.cell(row_number, columns["item"]).value = item_number
            ws.cell(row_number, columns["calculated"]).value = group["calculated_elongation"]
            ws.cell(row_number, columns["maximum"]).value = _formula_for_row(
                mapping.formula_seeds["maximum"],
                columns["calculated"],
                columns["maximum"],
                row_number,
            )
            ws.cell(row_number, columns["minimum"]).value = _formula_for_row(
                mapping.formula_seeds["minimum"],
                columns["calculated"],
                columns["minimum"],
                row_number,
            )
            ws.cell(row_number, columns["measured"]).value = (
                measurement.get("measured_elongation") if final and measurement else None
            )
            for key, column in row_prototype["number_formats"].items():
                ws.cell(row_number, columns[key]).number_format = column
            for column in columns.values():
                ws.cell(row_number, column).alignment = Alignment(
                    horizontal="center", vertical="center"
                )
            row_number += 1
            item_number += 1

        ws.cell(group_start_row, columns["label"]).value = group["label"]
        ws.cell(group_start_row, columns["length_m"]).value = group["length_m"]
        ws.cell(group_start_row, columns["strand_count"]).value = physical_count
        if physical_count > 1:
            end_row = group_start_row + physical_count - 1
            for key in ("label", "length_m", "strand_count"):
                column = get_column_letter(columns[key])
                ws.merge_cells(f"{column}{group_start_row}:{column}{end_row}")
        if slot is not None:
            for spacer_prototype in slot.spacer_prototypes:
                _apply_prototype(ws, row_number, spacer_prototype)
                row_number += 1
    return row_number



def _translate_template_formula(formula: str, origin_row: int, target_row: int) -> str:
    """Translate a helper formula (for example the template's hidden controls)."""

    return Translator(formula, origin=f"A{origin_row}").translate_formula(f"A{target_row}")


def _snapshot_section_header(ws: Any, section: TemplateSection) -> TemplateHeaderSnapshot:
    """Capture the original DISTRIBUIDOS block before the body is rebuilt."""

    start_row = section.section_row
    end_row = section.body_start_row - 1
    cells = tuple(
        (
            row - start_row,
            column,
            copy(ws.cell(row, column).value),
            copy(ws.cell(row, column)._style),
        )
        for row in range(start_row, end_row + 1)
        for column in range(1, ws.max_column + 1)
    )
    row_dimensions = tuple(
        (
            row - start_row,
            ws.row_dimensions[row].height,
            ws.row_dimensions[row].hidden,
            ws.row_dimensions[row].outlineLevel,
            ws.row_dimensions[row].collapsed,
        )
        for row in range(start_row, end_row + 1)
    )
    merged_ranges = tuple(
        (
            merged.min_row - start_row,
            merged.max_row - start_row,
            merged.min_col,
            merged.max_col,
        )
        for merged in ws.merged_cells.ranges
        if start_row <= merged.min_row and merged.max_row <= end_row
    )
    return TemplateHeaderSnapshot(
        row_count=end_row - start_row + 1,
        cells=cells,
        row_dimensions=row_dimensions,
        merged_ranges=merged_ranges,
    )


def _restore_section_header(
    ws: Any,
    snapshot: TemplateHeaderSnapshot,
    start_row: int,
) -> int:
    """Restore a previously captured section at its new dynamic row."""

    for row_offset, column, value, style in snapshot.cells:
        cell = ws.cell(start_row + row_offset, column)
        cell._style = copy(style)
        cell.value = copy(value)
    for row_offset, height, hidden, outline_level, collapsed in snapshot.row_dimensions:
        dimension = ws.row_dimensions[start_row + row_offset]
        dimension.height = height
        dimension.hidden = hidden
        dimension.outlineLevel = outline_level
        dimension.collapsed = collapsed
    for min_row, max_row, min_col, max_col in snapshot.merged_ranges:
        ws.merge_cells(
            start_row=start_row + min_row,
            end_row=start_row + max_row,
            start_column=min_col,
            end_column=max_col,
        )
    return start_row + snapshot.row_count


def _add_measurement_conditional_formatting(
    ws: Any,
    mapping: TemplateMapping,
    first_data_row: int,
    last_data_row: int,
) -> None:
    if last_data_row < first_data_row:
        return
    measured_column = get_column_letter(mapping.columns["measured"])
    maximum_column = get_column_letter(mapping.columns["maximum"])
    minimum_column = get_column_letter(mapping.columns["minimum"])
    calculated_column = get_column_letter(mapping.columns["calculated"])
    measured_range = f"{measured_column}{first_data_row}:{measured_column}{last_data_row}"
    ws.conditional_formatting.add(
        measured_range,
        FormulaRule(
            formula=[
                f'AND({measured_column}{first_data_row}="",'
                f'{calculated_column}{first_data_row}<>"")'
            ],
            fill=PatternFill("solid", fgColor="FEF3C7"),
        ),
    )
    ws.conditional_formatting.add(
        measured_range,
        FormulaRule(
            formula=[
                f'AND({measured_column}{first_data_row}<>"",'
                f"OR({measured_column}{first_data_row}<{minimum_column}{first_data_row},"
                f"{measured_column}{first_data_row}>{maximum_column}{first_data_row}))"
            ],
            fill=PatternFill("solid", fgColor="FECACA"),
        ),
    )


def _assert_export_groups(groups: list[dict[str, Any]], final: bool) -> None:
    labels: set[str] = set()
    for group in groups:
        label = _label_key(group["label"])
        if label in labels:
            raise TemplateValidationError(f"La etiqueta {label} está duplicada")
        labels.add(label)
        if _positive_integer(group.get("strand_count")) is None:
            raise TemplateValidationError(f"{label} tiene una cantidad S inválida")
        if group.get("classification") not in {"band", "distributed"}:
            raise TemplateValidationError(f"La etiqueta {label} sigue sin clasificar")
        measurements = group.get("measurements", [])
        if final:
            expected = int(group["strand_count"])
            if len(measurements) != expected:
                raise TemplateValidationError(f"{label} no tiene exactamente S mediciones")
            for measurement in measurements:
                if measurement.get("measured_elongation") is None:
                    raise TemplateValidationError(f"{label} tiene mediciones faltantes")
                if measurement.get("review_status") != "approved":
                    raise TemplateValidationError(
                        f"{label} tiene mediciones sin aprobación técnica"
                    )
                if measurement.get("tolerance_status") == "outside" and not measurement.get(
                    "override_reason"
                ):
                    raise TemplateValidationError(
                        f"{label} tiene una excepción fuera de tolerancia sin observación"
                    )


def _write_project_header(ws: Any, project_name: str | None, *, before_row: int) -> None:
    """Replace a stale ``OBRA: ...`` header without duplicating the project title.

    Field templates are commonly reused between works.  The job knows the current project, so an
    old project name in the static header must not accompany the generated values.  Some templates
    also carry the current name in the neighbouring cell; clear that exact duplicate so text does
    not overlap in Excel.
    """

    name = str(project_name or "").strip()
    if not name:
        return
    name_key = _normalise(name)
    header_limit = min(max(before_row - 1, 0), ws.max_row)
    header_pattern = re.compile(r"^(\s*(?:obra|proyecto)\s*:).*$", re.IGNORECASE)
    target = None
    prefix = ""
    for row in ws.iter_rows(min_row=1, max_row=header_limit):
        for cell in row:
            if not isinstance(cell.value, str):
                continue
            match = header_pattern.match(cell.value)
            if match:
                target = cell
                prefix = match.group(1).strip()
                break
        if target is not None:
            break
    if target is None:
        return

    target.value = f"{prefix} {name}"
    for cell in ws[target.row]:
        if cell.column != target.column and _normalise(cell.value) == name_key:
            cell.value = None


def _add_control_sheets(
    workbook: Workbook,
    groups: list[dict[str, Any]],
    *,
    history: dict[str, Any],
) -> None:
    for name in ("Control OCR", "Historial Obrixapy"):
        if name in workbook.sheetnames:
            del workbook[name]
    control = workbook.create_sheet("Control OCR")
    control.append(
        [
            "Label",
            "Ordinal",
            "Valor (cm)",
            "Archivo/página",
            "Recorte",
            "Confianza",
            "Asociación",
            "Revisión",
            "Tolerancia",
            "Observación",
        ]
    )
    for group in sorted(groups, key=_group_sort_key):
        for measurement in sorted(group.get("measurements", []), key=lambda item: item["ordinal"]):
            raw_location = measurement.get("source_location_json")
            location = raw_location if isinstance(raw_location, dict) else {}
            control.append(
                [
                    group["label"],
                    measurement["ordinal"],
                    measurement.get("measured_elongation"),
                    location.get("file") or location.get("page"),
                    _control_location_text(location.get("bbox")),
                    measurement.get("confidence"),
                    measurement.get("match_method"),
                    measurement.get("review_status"),
                    measurement.get("tolerance_status"),
                    measurement.get("override_reason"),
                ]
            )
    history_sheet = workbook.create_sheet("Historial Obrixapy")
    history_sheet.append(
        ["Trabajo", "Versión", "Tipo", "Fecha", "Usuario", "Fuentes", "SHA salida"]
    )
    history_sheet.append(
        [
            history.get("job_title"),
            history.get("version_number"),
            history.get("kind"),
            history.get("created_at"),
            history.get("created_by"),
            history.get("source_hashes"),
            history.get("output_sha256"),
        ]
    )
    for sheet in (control, history_sheet):
        sheet.freeze_panes = "A2"
        for cell in sheet[1]:
            cell.font = copy(workbook.active[1][0].font)
            cell.fill = PatternFill("solid", fgColor="EDE9FE")
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        sheet.row_dimensions[1].height = 30
        for column in range(1, sheet.max_column + 1):
            sheet.column_dimensions[get_column_letter(column)].width = 20
        sheet.print_area = f"A1:{get_column_letter(sheet.max_column)}{sheet.max_row}"
        sheet.print_title_rows = "1:1"
        sheet.sheet_properties.pageSetUpPr.fitToPage = True
        sheet.page_setup.orientation = "landscape"
        sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
        sheet.page_setup.fitToWidth = 1
        sheet.page_setup.fitToHeight = 0


def _control_location_text(value: object) -> str | None:
    """Return OCR geometry as a readable Excel cell, never as a JSON object.

    ``openpyxl`` accepts scalar values only.  The OCR source stores a bounding box as a
    dictionary, so placing it directly in ``Control OCR`` raised a ``ValueError`` and made the
    entire theoretical export fail.  Preserve the four coordinates as review evidence while
    serialising any unexpected shape safely as text too.
    """

    if value is None:
        return None
    if isinstance(value, dict):
        preferred = ("x", "y", "width", "height")
        ordered_keys = [key for key in preferred if key in value]
        ordered_keys.extend(key for key in value if key not in preferred)
        return " · ".join(f"{key}={value[key]}" for key in ordered_keys)
    if isinstance(value, list | tuple):
        return " · ".join(str(item) for item in value)
    return str(value)


def build_export_xlsx(
    template_content: bytes,
    mapping: TemplateMapping,
    groups: list[dict[str, Any]],
    *,
    final: bool,
    history: dict[str, Any],
    project_name: str | None = None,
) -> bytes:
    """Rebuild both operational sections while retaining the supplied template layout."""

    _assert_export_groups(groups, final)
    validate_template_bytes(template_content)
    workbook = load_workbook(BytesIO(template_content), data_only=False, keep_vba=False)
    ws = workbook[mapping.sheet_name]
    band_section = mapping.sections["band"]
    distributed_section = mapping.sections["distributed"]
    _write_project_header(ws, project_name, before_row=band_section.section_row)
    distributed_header = _snapshot_section_header(ws, distributed_section)
    slots_by_section = {
        "band": _template_group_slots(ws, mapping, "band"),
        "distributed": _template_group_slots(ws, mapping, "distributed"),
    }
    groups_by_section = _groups_for_template_sections(groups, slots_by_section)
    prototypes = {
        name: _physical_row_prototype(ws, section.formula_seed_row, mapping.columns)
        for name, section in mapping.sections.items()
    }

    # Everything below BANDAS is rebuilt so no old item, formula or merge remains.
    _unmerge_body_ranges(ws, band_section.body_start_row)
    ws.delete_rows(band_section.body_start_row, ws.max_row - band_section.body_start_row + 1)
    for row in list(ws.row_dimensions):
        if row >= band_section.body_start_row:
            del ws.row_dimensions[row]

    band_first_data_row = band_section.body_start_row
    after_bands = _write_section(
        ws,
        mapping,
        band_first_data_row,
        groups_by_section["band"],
        prototypes,
        final=final,
    )
    distributed_body_start = _restore_section_header(ws, distributed_header, after_bands)
    after_distributed = _write_section(
        ws,
        mapping,
        distributed_body_start,
        groups_by_section["distributed"],
        prototypes,
        final=final,
    )

    # Old body rules reference example rows. Keep only rules above the rebuilt body.
    header_rules = ConditionalFormattingList()
    for conditional, rules in ws.conditional_formatting._cf_rules.items():
        if all(area.max_row < band_first_data_row for area in conditional.sqref.ranges):
            for rule in rules:
                header_rules.add(copy(conditional), copy(rule))
    ws.conditional_formatting = header_rules
    _add_measurement_conditional_formatting(
        ws, mapping, band_first_data_row, after_bands - 1
    )
    _add_measurement_conditional_formatting(
        ws, mapping, distributed_body_start, after_distributed - 1
    )

    last_column = max(mapping.columns.values())
    last_data_row = max(band_first_data_row, after_distributed - 1)
    ws.print_area = f"A1:{get_column_letter(last_column)}{last_data_row}"
    ws.print_title_rows = f"{band_section.header_row}:{band_section.header_row + 1}"
    ws.freeze_panes = f"A{band_first_data_row}"
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.page_setup.scale = None
    ws.page_setup.orientation = ws.page_setup.orientation or "landscape"
    ws.page_setup.paperSize = ws.page_setup.paperSize or ws.PAPERSIZE_A4
    _set_group_print_breaks(ws, mapping, last_column, last_data_row)
    workbook.calculation.fullCalcOnLoad = True
    workbook.calculation.forceFullCalc = True
    workbook.calculation.calcMode = "auto"
    _add_control_sheets(workbook, groups, history=history)

    output = BytesIO()
    workbook.save(output)
    result = output.getvalue()
    _validate_generated_export(result, mapping, band_first_data_row, last_data_row)
    return result


def _set_group_print_breaks(
    ws: Any, mapping: TemplateMapping, last_column: int, last_row: int
) -> None:
    """Keep ordinary S blocks on one printed page instead of cutting a Label.

    Leave a safety margin for different spreadsheet/printer font metrics. Large
    groups exceeding a whole page still flow naturally; their values are never
    removed or squeezed to fit.
    """

    paper_sizes = {
        ws.PAPERSIZE_A4: (595.3, 841.9),
        ws.PAPERSIZE_A3: (841.9, 1190.6),
        ws.PAPERSIZE_LETTER: (612, 792),
        ws.PAPERSIZE_LEGAL: (612, 1008),
    }
    width, height = paper_sizes.get(ws.page_setup.paperSize, (595.3, 841.9))
    if ws.page_setup.orientation == "landscape":
        width, height = height, width
    margins = ws.page_margins
    width -= 72 * (margins.left + margins.right)
    height -= 72 * (margins.top + margins.bottom)
    table_width = 0.0
    for col in range(1, last_column + 1):
        dimension = ws.column_dimensions.get(get_column_letter(col))
        if dimension is not None and dimension.hidden:
            continue
        units = (
            dimension.width if dimension is not None else ws.sheet_format.defaultColWidth or 8.43
        )
        table_width += (units * 7 + 5) * 0.75
    capacity = height * 0.88 / max(1, width / max(table_width, 1))
    default_height = ws.sheet_format.defaultRowHeight or 15

    def rows_height(first: int, last: int) -> float:
        return sum(ws.row_dimensions[r].height or default_height for r in range(first, last + 1))

    section = mapping.sections["band"]
    used = rows_height(1, section.body_start_row - 1)
    repeated = rows_height(section.header_row, section.header_row + 1)
    ws.row_breaks = RowBreak()
    next_row = section.body_start_row
    for row in range(section.body_start_row, last_row + 1):
        if not ws.cell(row, mapping.columns["label"]).value:
            continue
        count = _positive_integer(ws.cell(row, mapping.columns["strand_count"]).value) or 1
        used += rows_height(next_row, row - 1)
        group_height = rows_height(row, row + count - 1)
        if used + group_height > capacity and row > section.body_start_row:
            ws.row_breaks.append(Break(id=row - 1))
            used = repeated
        used += group_height
        next_row = row + count



def _validate_generated_export(
    content: bytes,
    mapping: TemplateMapping,
    first_data_row: int,
    last_data_row: int,
) -> None:
    """Reopen and prove formula integrity before bytes are stored as an export version."""

    workbook = load_workbook(BytesIO(content), data_only=False, keep_vba=False)
    ws = workbook[mapping.sheet_name]
    for row in range(first_data_row, last_data_row + 1):
        calculated = ws.cell(row, mapping.columns["calculated"]).value
        if calculated is None or isinstance(calculated, str):
            continue
        for key in ("maximum", "minimum"):
            formula = ws.cell(row, mapping.columns[key]).value
            if not isinstance(formula, str) or not _formula_references_own_calculated_row(
                formula, mapping.columns["calculated"], row
            ):
                raise TemplateValidationError(
                    "El Excel generado contiene una fórmula Max./Min. inválida"
                )
            if "#REF!" in formula.upper():
                raise TemplateValidationError("El Excel generado contiene una referencia rota")
