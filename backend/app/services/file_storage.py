from __future__ import annotations

import base64
import hashlib
import json
import tempfile
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from app.core.config import get_settings

DOCUMENT_MIME_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
XLSX_MIME_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
}


@dataclass(frozen=True)
class StoredUpload:
    storage_key: str
    original_filename: str
    mime_type: str
    size_bytes: int
    sha256: str


def storage_path(storage_key: str) -> Path:
    if storage_key.startswith(("drive:v1:", "packed:v1:")):
        raise ValueError("Use stored_path/read_stored_bytes for archived Drive files")
    root = get_settings().upload_root.resolve()
    candidate = (root / storage_key).resolve()
    if candidate == root or root not in candidate.parents:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El archivo tiene una ubicación inválida",
        )
    return candidate


def archived_metadata(storage_key: str) -> dict | None:
    if not storage_key.startswith(("drive:v1:", "packed:v1:")):
        return None
    try:
        prefix = "packed:v1:" if storage_key.startswith("packed:v1:") else "drive:v1:"
        data = json.loads(base64.urlsafe_b64decode(storage_key[len(prefix) :]))
        data["provider"] = "local" if prefix == "packed:v1:" else "drive"
        if (
            data["e"] not in {"identity", "gzip"}
            or not isinstance(data["n"], int)
            or not 0 < data["n"] <= 512 * 1024 * 1024
            or not isinstance(data["s"], int)
            or not 0 < data["s"] <= data["n"]
            or len(data["h"]) != 64
        ):
            raise ValueError("Invalid archive metadata")
        return data
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=500, detail="Referencia de archivo inválida") from exc


def archive_reference(
    key: str, content: bytes, stored_size: int, encoding: str, *, local: bool = False
) -> str:
    data = {
        "k": key,
        "n": len(content),
        "s": stored_size,
        "e": encoding,
        "h": hashlib.sha256(content).hexdigest(),
    }
    return ("packed:v1:" if local else "drive:v1:") + base64.urlsafe_b64encode(
        json.dumps(data, separators=(",", ":")).encode()
    ).decode()


async def read_stored_bytes(storage_key: str) -> bytes:
    from app.services import project_drive, project_file_codec

    metadata = archived_metadata(storage_key)
    if metadata:
        if metadata["provider"] == "local":
            try:
                stored = await run_in_threadpool(storage_path(metadata["k"]).read_bytes)
            except FileNotFoundError as exc:
                raise HTTPException(
                    status_code=404, detail="Archivo archivado no disponible"
                ) from exc
        else:
            stored = await project_drive.download(metadata["k"])
        if len(stored) != metadata["s"]:
            raise HTTPException(status_code=502, detail="El archivo archivado está incompleto")
        try:
            content = project_file_codec.decode(stored, metadata["e"], metadata["n"])
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="Archivo archivado dañado") from exc
        if hashlib.sha256(content).hexdigest() != metadata["h"]:
            raise HTTPException(
                status_code=502, detail="Falló la verificación del original archivado"
            )
        return content
    try:
        return await run_in_threadpool(storage_path(storage_key).read_bytes)
    except FileNotFoundError as exc:
        # A job which started before archival may still hold the original key.
        # The tiny, atomically written alias keeps that reference readable.
        alias = storage_path(storage_key + ".archive-ref")
        if alias.is_file():
            reference = await run_in_threadpool(alias.read_text)
            if reference.startswith("packed:v1:"):
                return await read_stored_bytes(reference)
        raise HTTPException(status_code=404, detail="El archivo no está disponible") from exc


@asynccontextmanager
async def stored_path(storage_key: str):
    """Temporary materialization for PDF/XLSX readers; removed even on errors."""
    if not archived_metadata(storage_key):
        path = storage_path(storage_key)
        if path.is_file():
            yield path
            return
    content = await read_stored_bytes(storage_key)
    with tempfile.TemporaryDirectory(prefix="obrixapy-preview-") as folder:
        path = Path(folder) / "original"
        await run_in_threadpool(path.write_bytes, content)
        yield path


async def stored_response(
    storage_key: str, mime_type: str, filename: str, headers=None
) -> Response:
    content = await read_stored_bytes(storage_key)
    return Response(
        content,
        media_type=mime_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename or 'archivo')}",
            "X-Content-Type-Options": "nosniff",
            **(headers or {}),
        },
    )


def _signature_matches(content: bytes, mime_type: str) -> bool:
    if mime_type == "application/pdf":
        return content.startswith(b"%PDF-")
    if mime_type == "image/jpeg":
        return content.startswith(b"\xff\xd8\xff")
    if mime_type == "image/png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if mime_type == "image/webp":
        return len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    if mime_type in XLSX_MIME_TYPES:
        return content.startswith(b"PK\x03\x04")
    return False


async def store_upload(
    file: UploadFile,
    *path_parts: str,
    allowed_mime_types: dict[str, str] | None = None,
    max_bytes: int | None = None,
    mime_type_override: str | None = None,
) -> StoredUpload:
    allowed = allowed_mime_types or DOCUMENT_MIME_TYPES
    mime_type = mime_type_override or file.content_type or ""
    extension = allowed.get(mime_type)
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="El tipo de archivo no está permitido para esta operación",
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


async def store_bytes(
    content: bytes,
    filename: str,
    mime_type: str,
    *path_parts: str,
) -> StoredUpload:
    """Store server-generated bytes using the same path and hash protections as uploads."""

    allowed = {**DOCUMENT_MIME_TYPES, **XLSX_MIME_TYPES}
    extension = allowed.get(mime_type)
    if extension is None or not content:
        raise ValueError("Tipo o contenido de archivo generado inválido")
    clean_parts = [part.strip().replace("..", "_").strip("/") for part in path_parts]
    key = "/".join([*clean_parts, f"{uuid4().hex}{extension}"])
    target = storage_path(key)
    await run_in_threadpool(target.parent.mkdir, parents=True, exist_ok=True)
    try:
        await run_in_threadpool(target.write_bytes, content)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
            detail="No fue posible guardar el archivo generado",
        ) from exc
    return StoredUpload(
        storage_key=key,
        original_filename=Path(filename).name[:255],
        mime_type=mime_type,
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
    )


async def remove_stored_file(storage_key: str | None) -> None:
    if not storage_key:
        return
    if archived_metadata(storage_key):
        # Shared by versions and processing jobs. Retain the verified archive
        # rather than deleting an object another record could still reference.
        return
    path = storage_path(storage_key)
    try:
        await run_in_threadpool(path.unlink, missing_ok=True)
    except OSError:
        pass
