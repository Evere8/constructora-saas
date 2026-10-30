"""Explicit deployment probe: writes/reads/removes ONE random test object only.

Run with the operational Drive override, never with the backup configuration.
No database connection, user files, tokens or configuration contents are used.
"""

import asyncio
import secrets
from uuid import uuid4

from app.services import project_drive


async def verify() -> None:
    key = "/".join(uuid4().hex for _ in range(3))
    project_drive.drive_location(key)
    content = b"Obrixapy operational storage verification\n" + secrets.token_bytes(4096)
    try:
        await project_drive.upload(key, content)
        if await project_drive.download(key) != content:
            raise RuntimeError("Drive devolvió bytes distintos a la prueba original")
    finally:
        # Exact UUID object created by this probe; never remove a directory.
        await project_drive.delete(key)
    print("DRIVE_OK escritura, lectura e integridad; objeto de prueba eliminado")


if __name__ == "__main__":
    asyncio.run(verify())
