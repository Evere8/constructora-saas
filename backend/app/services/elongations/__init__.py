"""Servicios aislados para el flujo V2 de listas de elongaciones.

Las rutas legacy de ``documents`` conservan sus adaptadores anteriores.  Este paquete no
depende de FastAPI y concentra las reglas que requieren pruebas determinísticas.
"""

from app.services.elongations.classification import (
    GeometryProposal,
    propose_classifications,
    zone_contains,
)
from app.services.elongations.measurements import (
    MeasurementRead,
    expand_measurement_slots,
    parse_handwritten_values,
    tolerance_status,
)
from app.services.elongations.theory import (
    TheoryCandidate,
    deduplicate_candidates,
    parse_theory_candidates,
)

__all__ = [
    "MeasurementRead",
    "GeometryProposal",
    "TheoryCandidate",
    "deduplicate_candidates",
    "expand_measurement_slots",
    "parse_handwritten_values",
    "parse_theory_candidates",
    "propose_classifications",
    "tolerance_status",
    "zone_contains",
]
