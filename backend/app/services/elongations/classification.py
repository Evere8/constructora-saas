"""Conservative geometry proposals for the theory review stage.

The proposal is intentionally weaker than a technical decision.  It uses only normalized source
coordinates and nearby labels; every result remains pending until a reviewer classifies and
approves it.  Ambiguous candidates stay ``unknown`` instead of inferring a class from a word in
the OCR text.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from app.services.elongations.theory import TheoryCandidate


@dataclass(frozen=True)
class GeometryProposal:
    classification: str
    confidence: Decimal
    reason: str

    def to_dict(self) -> dict[str, str]:
        return {
            "classification": self.classification,
            "confidence": str(self.confidence),
            "reason": self.reason,
        }


def normalised_rect(
    value: dict[str, Any] | None,
) -> tuple[Decimal, Decimal, Decimal, Decimal] | None:
    """Return a bounded normalized rectangle, refusing pixel or malformed coordinates."""

    if not value:
        return None
    try:
        x = Decimal(str(value["x"]))
        y = Decimal(str(value["y"]))
        width = Decimal(str(value["width"]))
        height = Decimal(str(value["height"]))
    except (InvalidOperation, KeyError, TypeError, ValueError):
        return None
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1 or y + height > 1:
        return None
    return x, y, width, height


def zone_contains(zone: dict[str, Any], location: dict[str, Any] | None) -> bool:
    """Classify by the candidate center only when both source and zone are normalized."""

    zone_rect = normalised_rect(zone)
    source = location or {}
    source_rect = normalised_rect(source.get("bbox"))
    if zone_rect is None or source_rect is None:
        return False
    try:
        if int(zone.get("page", 1)) != int(source.get("page", 1)):
            return False
    except (TypeError, ValueError):
        return False
    zone_x, zone_y, zone_width, zone_height = zone_rect
    x, y, width, height = source_rect
    center_x = x + width / 2
    center_y = y + height / 2
    return zone_x <= center_x <= zone_x + zone_width and zone_y <= center_y <= zone_y + zone_height


def propose_classifications(candidates: list[TheoryCandidate]) -> dict[str, GeometryProposal]:
    """Propose only clear outer/central spatial groups; preserve ``unknown`` otherwise.

    Plans do not encode the business class in a text line.  A perimeter cluster can be a useful
    *Banda* hint and a multi-label central cluster can be a *Distribuido* hint, but no single
    coordinate is sufficient.  The deliberately low confidence documents that the reviewer owns
    the final class.
    """

    positions: dict[str, tuple[Decimal, Decimal]] = {}
    for candidate in candidates:
        rect = normalised_rect(candidate.bbox)
        if rect is None:
            continue
        x, y, width, height = rect
        positions[candidate.label] = (x + width / 2, y + height / 2)
    proposals = {
        candidate.label: GeometryProposal("unknown", Decimal("0"), "sin coordenadas confiables")
        for candidate in candidates
    }
    if len(positions) < 2:
        return proposals

    corridors = {
        "left": [label for label, (x, _) in positions.items() if x <= Decimal("0.18")],
        "right": [label for label, (x, _) in positions.items() if x >= Decimal("0.82")],
        "top": [label for label, (_, y) in positions.items() if y <= Decimal("0.18")],
        "bottom": [label for label, (_, y) in positions.items() if y >= Decimal("0.82")],
    }
    perimeter_labels = {
        label for labels in corridors.values() if len(labels) >= 2 for label in labels
    }
    for label in perimeter_labels:
        proposals[label] = GeometryProposal(
            "band",
            Decimal("0.5500"),
            "propuesta geométrica: agrupación de rótulos en perímetro",
        )
    central_labels = {
        label
        for label, (x, y) in positions.items()
        if Decimal("0.24") <= x <= Decimal("0.76")
        and Decimal("0.24") <= y <= Decimal("0.76")
    }
    if len(central_labels) >= 3:
        for label in central_labels - perimeter_labels:
            proposals[label] = GeometryProposal(
                "distributed",
                Decimal("0.5000"),
                "propuesta geométrica: agrupación central de rótulos",
            )
    return proposals
