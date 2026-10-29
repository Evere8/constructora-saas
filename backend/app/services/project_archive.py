"""Resumable, one-object-at-a-time, lossless in-place-provider archival.

Existing local uploads remain local; existing Drive objects remain in Drive.
Database records, links, annotations and folder structure are not removed.
"""

import hashlib
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from app.db.models import (
    ChecklistEvidence,
    ElongationJob,
    ElongationJobFile,
    PerforationDocument,
    PerforationPoint,
    PlanDocument,
    PlanVersion,
    ProjectFile,
)
from app.services import file_storage, project_drive, project_file_codec


async def references(db, company_id, project_id, *, lock=False):
    result = []
    statements = [
        (
            select(PlanVersion)
            .join(PlanDocument, PlanDocument.id == PlanVersion.document_id)
            .where(PlanDocument.company_id == company_id, PlanDocument.project_id == project_id),
            "storage_key",
        ),
        (
            select(ElongationJobFile)
            .join(ElongationJob, ElongationJob.id == ElongationJobFile.job_id)
            .where(ElongationJob.company_id == company_id, ElongationJob.project_id == project_id),
            "storage_key",
        ),
        (
            select(ElongationJob).where(
                ElongationJob.company_id == company_id, ElongationJob.project_id == project_id
            ),
            "source_storage_key",
        ),
        (
            select(ChecklistEvidence).where(
                ChecklistEvidence.company_id == company_id,
                ChecklistEvidence.project_id == project_id,
            ),
            "storage_key",
        ),
        (
            select(PerforationDocument).where(
                PerforationDocument.company_id == company_id,
                PerforationDocument.project_id == project_id,
            ),
            "storage_key",
        ),
        (
            select(PerforationPoint).where(
                PerforationPoint.company_id == company_id, PerforationPoint.project_id == project_id
            ),
            "note_storage_key",
        ),
    ]
    for statement, field in statements:
        rows = (await db.execute(statement.with_for_update() if lock else statement)).scalars()
        result.extend((row, field) for row in rows if getattr(row, field))
    return result


async def status(db, company_id, project_id):
    refs = await references(db, company_id, project_id)
    keys = {getattr(row, field) for row, field in refs}
    files = list(
        (
            await db.execute(
                select(ProjectFile).where(
                    ProjectFile.company_id == company_id, ProjectFile.project_id == project_id
                )
            )
        ).scalars()
    )
    packed = [
        file_storage.archived_metadata(key) for key in keys if file_storage.archived_metadata(key)
    ]
    pending = sum(not file_storage.archived_metadata(key) for key in keys) + sum(
        not f.compression_checked for f in files
    )
    original = sum(m["n"] for m in packed) + sum(f.size_bytes for f in files)
    stored = sum(m["s"] for m in packed) + sum(f.stored_size_bytes for f in files)
    return {
        "pending": pending,
        "total": len(keys) + len(files),
        "complete": pending == 0,
        "saved_bytes": max(0, original - stored),
    }


async def archive_one(db, company_id, project_id):
    refs = await references(db, company_id, project_id, lock=True)
    key = next(
        (
            getattr(row, field)
            for row, field in refs
            if not file_storage.archived_metadata(getattr(row, field))
        ),
        None,
    )
    if key:
        content = await file_storage.read_stored_bytes(key)
        matching = [(row, field) for row, field in refs if getattr(row, field) == key]
        for row, field in matching:
            expected = getattr(row, "sha256", None) if field != "note_storage_key" else None
            if expected and hashlib.sha256(content).hexdigest() != expected:
                raise HTTPException(
                    status_code=409,
                    detail="El original no coincide con su hash. No se modificó el archivo.",
                )
        stored, encoding = await run_in_threadpool(project_file_codec.encode, content)
        target_key = (
            key if encoding == "identity" else str(Path(key).parent / (uuid4().hex + ".gz"))
        )
        if encoding == "gzip":
            await run_in_threadpool(file_storage.storage_path(target_key).write_bytes, stored)
        reference = file_storage.archive_reference(
            target_key, content, len(stored), encoding, local=True
        )
        if len(reference) > 500:
            raise HTTPException(
                status_code=409, detail="La ruta antigua es demasiado larga para archivar"
            )
        if await file_storage.read_stored_bytes(reference) != content:
            raise HTTPException(status_code=502, detail="No pasó la verificación de restauración")
        for row, field in matching:
            setattr(row, field, reference)
        await db.commit()
        if encoding == "gzip":
            # Alias before removal: stale in-flight readers still recover the
            # exact original. The compressed bytes were read back and verified.
            alias = file_storage.storage_path(key + ".archive-ref")
            temp = alias.with_name(alias.name + "." + uuid4().hex)
            await run_in_threadpool(temp.write_text, reference)
            await run_in_threadpool(temp.replace, alias)
            await file_storage.remove_stored_file(key)
        return
    record = await db.scalar(
        select(ProjectFile)
        .where(
            ProjectFile.company_id == company_id,
            ProjectFile.project_id == project_id,
            ProjectFile.compression_checked.is_(False),
        )
        .order_by(ProjectFile.id)
        .limit(1)
        .with_for_update()
    )
    if record is None:
        return
    original_stored = await project_drive.download(record.drive_key)
    content = project_file_codec.decode(original_stored, record.storage_encoding, record.size_bytes)
    if hashlib.sha256(content).hexdigest() != record.sha256:
        raise HTTPException(
            status_code=502, detail="Falló la integridad del archivo original en Drive"
        )
    stored, encoding = await run_in_threadpool(project_file_codec.encode, content)
    previous_key = record.drive_key
    replacement = None
    if len(stored) < len(original_stored):
        replacement = f"{company_id.replace('-', '')}/{project_id.replace('-', '')}/{uuid4().hex}"
        await project_drive.upload(replacement, stored)
        verified = await project_drive.download(replacement)
        if (
            verified != stored
            or project_file_codec.decode(verified, encoding, len(content)) != content
        ):
            raise HTTPException(
                status_code=502, detail="La copia comprimida no pasó la verificación"
            )
        record.drive_key, record.storage_encoding, record.stored_size_bytes = (
            replacement,
            encoding,
            len(stored),
        )
    record.compression_checked = True
    await db.commit()
    if replacement:
        # Record points to verified replacement before retiring the old object.
        # A cleanup failure cannot invalidate the readable replacement.
        try:
            await project_drive.delete(previous_key)
        except HTTPException:
            pass
