"""Provider selection without ever treating geometric plan numbers as handwriting."""

from pathlib import Path

from app.services.elongations.vision import (
    MeasurementExtraction,
    extract_visual_measurements,
    visual_enabled,
)


def extract_measurements(path: Path, mime_type: str) -> MeasurementExtraction:
    if visual_enabled():
        return extract_visual_measurements(path, mime_type)
    # Tesseract cannot reliably distinguish handwriting from printed dimensions.
    # A reassuring list of wrong numbers is worse than an explicit setup requirement.
    raise RuntimeError(
        "La lectura manuscrita requiere activar OpenAI en el servidor (OPENAI_API_KEY). "
        "El escaneo quedó guardado: podrá releerlo después de conectar "
        "o cargar las medidas manualmente."
    )
