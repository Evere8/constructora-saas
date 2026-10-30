"""Private, separately credentialed Drive object storage for project folders.

The backup remote is deliberately forbidden.  Objects use opaque database IDs,
never untrusted filenames or folder labels in the remote path.
"""

import asyncio
import re
from pathlib import Path

from fastapi import HTTPException

from app.core.config import get_settings


def drive_location(key: str) -> tuple[str, str]:
    settings = get_settings()
    remote = settings.drive_document_remote
    if (
        not remote
        or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]*:", remote)
        or remote in {"gdrive:", "gdrive-crypt:"}
        or not settings.drive_document_config.is_file()
    ):
        raise HTTPException(
            status_code=503,
            detail="Drive operativo no configurado; los respaldos no sirven archivos activos.",
        )
    if not re.fullmatch(r"[0-9a-f]{32}/[0-9a-f]{32}/[0-9a-f]{32}", key):
        raise HTTPException(status_code=500, detail="Ruta de archivo inválida")
    return str(settings.drive_document_config), f"{remote}obrixapy/project-files/{key}"


async def _rclone(command: str, key: str, body: bytes | None = None) -> bytes:
    config, remote_path = drive_location(key)
    proc = await asyncio.create_subprocess_exec(
        "rclone",
        "--config",
        config,
        command,
        remote_path,
        stdin=asyncio.subprocess.PIPE if body is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(body), timeout=120)
    except TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise HTTPException(status_code=504, detail="Drive no respondió a tiempo") from exc
    if proc.returncode:
        raise HTTPException(
            status_code=502, detail="Drive rechazó la transferencia; compruebe el remoto operativo"
        )
    return stdout


async def upload(key: str, content: bytes) -> None:
    await _rclone("rcat", key, content)


async def download(key: str) -> bytes:
    return await _rclone("cat", key)


async def delete(key: str) -> None:
    """Only an exact opaque object key; never a directory or backup remote."""
    await _rclone("deletefile", key)


async def _copyto(source: str, destination: str) -> None:
    settings = get_settings()
    proc = await asyncio.create_subprocess_exec(
        "rclone",
        "--config",
        str(settings.drive_document_config),
        "copyto",
        source,
        destination,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        await asyncio.wait_for(proc.wait(), timeout=settings.drive_transfer_timeout_seconds)
    except TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise HTTPException(status_code=504, detail="Drive no respondió a tiempo") from exc
    if proc.returncode:
        raise HTTPException(
            status_code=502,
            detail="Drive rechazó la transferencia; compruebe el remoto operativo",
        )


async def upload_path(key: str, local_path: Path) -> None:
    _, remote_path = drive_location(key)
    await _copyto(str(local_path), remote_path)


async def download_to_path(key: str, local_path: Path) -> None:
    _, remote_path = drive_location(key)
    await _copyto(remote_path, str(local_path))
