from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool

from app.core.config import get_settings

DOCUMENT_MIME_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


@dataclass(frozen=True)
class StoredUpload:
    storage_key: str
    original_filename: str
    mime_type: str
    size_bytes: int
    sha256: str


def storage_path(storage_key: str) -> Path:
    root = get_settings().upload_root.resolve()
    candidate = (root / storage_key).resolve()
    if candidate == root or root not in candidate.parents:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El archivo tiene una ubicación inválida",
        )
    return candidate


def _signature_matches(content: bytes, mime_type: str) -> bool:
    if mime_type == "application/pdf":
        return content.startswith(b"%PDF-")
    if mime_type == "image/jpeg":
        return content.startswith(b"\xff\xd8\xff")
    if mime_type == "image/png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if mime_type == "image/webp":
        return len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    return False


async def store_upload(
    file: UploadFile,
    *path_parts: str,
    allowed_mime_types: dict[str, str] | None = None,
    max_bytes: int | None = None,
) -> StoredUpload:
    allowed = allowed_mime_types or DOCUMENT_MIME_TYPES
    mime_type = file.content_type or ""
    extension = allowed.get(mime_type)
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Solo se permiten archivos PDF o imágenes JPG, PNG y WEBP",
        )
    limit = max_bytes or get_settings().document_max_bytes
    content = await file.read(limit + 1)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El archivo está vacío",
        )
    if len(content) > limit:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"El archivo supera el máximo permitido de {limit // (1024 * 1024)} MB",
        )
    if not _signature_matches(content, mime_type):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="El contenido del archivo no coincide con su tipo declarado",
        )

    clean_parts = [part.strip().replace("..", "_").strip("/") for part in path_parts]
    key = "/".join([*clean_parts, f"{uuid4().hex}{extension}"])
    target = storage_path(key)
    await run_in_threadpool(target.parent.mkdir, parents=True, exist_ok=True)
    try:
        await run_in_threadpool(target.write_bytes, content)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
            detail="No fue posible guardar el archivo",
        ) from exc

    original = Path(file.filename or f"archivo{extension}").name[:255]
    return StoredUpload(
        storage_key=key,
        original_filename=original,
        mime_type=mime_type,
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
    )


async def remove_stored_file(storage_key: str | None) -> None:
    if not storage_key:
        return
    path = storage_path(storage_key)
    try:
        await run_in_threadpool(path.unlink, missing_ok=True)
    except OSError:
        pass
