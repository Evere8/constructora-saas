import mimetypes
import shutil
import tempfile
from pathlib import Path, PurePath
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse as StreamingFileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from starlette.background import BackgroundTask

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.routes.operations import (
    add_activity,
    commit_or_conflict,
    flush_or_conflict,
    require_project,
    require_role,
)
from app.db.models import Project, ProjectFile, ProjectFolder
from app.services import project_archive, project_drive, project_file_codec

router = APIRouter()
EDITOR_ROLES = {"owner", "admin", "engineer", "supervisor"}


@router.get("/projects/{project_id}/archive-status")
async def archive_status(project_id: str, access: CurrentCompanyAccess, db: DbSession):
    await require_project(db, access.company_id, project_id)
    return await project_archive.status(db, access.company_id, project_id)


@router.post("/projects/{project_id}/archive-step")
async def archive_step(project_id: str, access: CurrentCompanyAccess, db: DbSession):
    require_role(access, {"owner", "admin"})
    project = await db.scalar(
        select(Project)
        .where(
            Project.id == project_id,
            Project.company_id == access.company_id,
        )
        .with_for_update()
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Obra no encontrada")
    if project.status != "inactive":
        raise HTTPException(
            status_code=409, detail="Solo se archivan archivos de una obra inactiva"
        )
    await project_archive.archive_one(db, access.company_id, project_id)
    result = await project_archive.status(db, access.company_id, project_id)
    add_activity(db, access, "project.files.archived", "project", project_id, result)
    await commit_or_conflict(db, "No se pudo registrar el archivado")
    return result


@router.get("/project-files/storage-status")
async def storage_status(access: CurrentCompanyAccess):
    try:
        project_drive.drive_location(f"{access.company_id.replace('-', '')}/{'0' * 32}/{'0' * 32}")
        return {"configured": True}
    except HTTPException as exc:
        if exc.status_code != 503:
            raise
        return {"configured": False, "message": exc.detail}


class FolderInput(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    parent_id: str | None = None

    @field_validator("name")
    @classmethod
    def nonempty_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El nombre de la carpeta no puede estar vacío")
        return value


class FolderResponse(BaseModel):
    id: str
    name: str
    parent_id: str | None


class FileResponse(BaseModel):
    id: str
    folder_id: str | None
    original_filename: str
    mime_type: str
    size_bytes: int
    stored_size_bytes: int
    storage_encoding: str
    sha256: str


async def require_folder(
    db: DbSession, company_id: str, project_id: str, folder_id: str
) -> ProjectFolder:
    folder = await db.scalar(
        select(ProjectFolder).where(
            ProjectFolder.id == folder_id,
            ProjectFolder.company_id == company_id,
            ProjectFolder.project_id == project_id,
        )
    )
    if folder is None:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada en esta obra")
    return folder


@router.get("/projects/{project_id}/folders", response_model=list[FolderResponse])
async def list_folders(project_id: str, access: CurrentCompanyAccess, db: DbSession):
    await require_project(db, access.company_id, project_id)
    return (
        (
            await db.execute(
                select(ProjectFolder)
                .where(
                    ProjectFolder.company_id == access.company_id,
                    ProjectFolder.project_id == project_id,
                )
                .order_by(ProjectFolder.name)
            )
        )
        .scalars()
        .all()
    )


@router.post("/projects/{project_id}/folders", response_model=FolderResponse, status_code=201)
async def create_folder(
    project_id: str, payload: FolderInput, access: CurrentCompanyAccess, db: DbSession
):
    require_role(access, EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    if payload.parent_id:
        await require_folder(db, access.company_id, project_id, payload.parent_id)
    folder = ProjectFolder(
        company_id=access.company_id,
        project_id=project_id,
        parent_id=payload.parent_id,
        name=payload.name.strip(),
        created_by_user_id=access.user.id,
    )
    db.add(folder)
    await flush_or_conflict(db, "No fue posible crear la carpeta")
    add_activity(db, access, "project.folder.created", "project_folder", folder.id)
    await commit_or_conflict(db, "No fue posible crear la carpeta")
    return folder


@router.get("/projects/{project_id}/files", response_model=list[FileResponse])
async def list_files(
    project_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    folder_id: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    await require_project(db, access.company_id, project_id)
    if folder_id:
        await require_folder(db, access.company_id, project_id, folder_id)
    return (
        (
            await db.execute(
                select(ProjectFile)
                .where(
                    ProjectFile.company_id == access.company_id,
                    ProjectFile.project_id == project_id,
                    ProjectFile.folder_id == folder_id,
                )
                .order_by(ProjectFile.created_at.desc(), ProjectFile.id)
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )


@router.post("/projects/{project_id}/files", response_model=FileResponse, status_code=201)
async def upload_file(
    project_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    file: Annotated[UploadFile, File()],
    folder_id: Annotated[str | None, Form()] = None,
):
    require_role(access, EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    if folder_id:
        await require_folder(db, access.company_id, project_id, folder_id)
    key = f"{access.company_id.replace('-', '')}/{project_id.replace('-', '')}/{uuid4().hex}"
    project_drive.drive_location(key)
    original = PurePath((file.filename or "archivo").replace("\\", "/")).name[:255]
    mime = (mimetypes.guess_type(original)[0] or "application/octet-stream")[:120]
    temp_dir = Path(tempfile.mkdtemp(prefix="obrixapy-project-upload-"))
    uploaded = False
    committed = False
    try:
        source = temp_dir / "original"
        with source.open("wb") as writer:
            while chunk := await file.read(1024 * 1024):
                writer.write(chunk)
        if source.stat().st_size == 0:
            raise HTTPException(status_code=422, detail="El archivo está vacío")
        stored_path, encoding, size_bytes, stored_size_bytes, sha256 = await run_in_threadpool(
            project_file_codec.encode_path,
            source,
            temp_dir / "compressed.gz",
        )
        await project_drive.upload_path(key, stored_path)
        uploaded = True
        remote_copy = temp_dir / "drive-copy"
        await project_drive.download_to_path(key, remote_copy)
        if remote_copy.stat().st_size != stored_size_bytes:
            raise HTTPException(
                status_code=502,
                detail="Drive confirmó un tamaño distinto. El archivo no se registró.",
            )
        try:
            await run_in_threadpool(
                project_file_codec.verify_path,
                remote_copy,
                encoding,
                size_bytes,
                sha256,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=502,
                detail="Drive no confirmó el archivo íntegro. El archivo no se registró.",
            ) from exc
        record = ProjectFile(
            company_id=access.company_id,
            project_id=project_id,
            folder_id=folder_id,
            original_filename=original,
            mime_type=mime,
            size_bytes=size_bytes,
            stored_size_bytes=stored_size_bytes,
            storage_encoding=encoding,
            compression_checked=True,
            sha256=sha256,
            drive_key=key,
            uploaded_by_user_id=access.user.id,
        )
        db.add(record)
        await flush_or_conflict(
            db, "El archivo subió a Drive pero falló el índice; avise al administrador"
        )
        add_activity(db, access, "project.file.uploaded", "project_file", record.id)
        await commit_or_conflict(
            db, "El archivo se subió a Drive pero no se pudo registrar; contacte al administrador"
        )
        committed = True
        return record
    except Exception:
        if uploaded and not committed:
            try:
                await project_drive.delete(key)
            except HTTPException:
                pass
        raise
    finally:
        await file.close()
        await run_in_threadpool(shutil.rmtree, temp_dir, True)


@router.get("/projects/{project_id}/files/{file_id}/download")
async def download_file(project_id: str, file_id: str, access: CurrentCompanyAccess, db: DbSession):
    record = await db.scalar(
        select(ProjectFile).where(
            ProjectFile.id == file_id,
            ProjectFile.project_id == project_id,
            ProjectFile.company_id == access.company_id,
        )
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    temp_dir = Path(tempfile.mkdtemp(prefix="obrixapy-project-download-"))
    stored = temp_dir / "stored"
    output = temp_dir / "download"
    try:
        await project_drive.download_to_path(record.drive_key, stored)
        if stored.stat().st_size != record.stored_size_bytes:
            raise HTTPException(status_code=502, detail="Tamaño en Drive distinto al registrado")
        await run_in_threadpool(
            project_file_codec.decode_path,
            stored,
            output,
            record.storage_encoding,
            record.size_bytes,
            record.sha256,
        )
    except ValueError as exc:
        await run_in_threadpool(shutil.rmtree, temp_dir, True)
        raise HTTPException(status_code=502, detail="El archivo almacenado está dañado") from exc
    except Exception:
        await run_in_threadpool(shutil.rmtree, temp_dir, True)
        raise
    from urllib.parse import quote

    name = record.original_filename.replace('"', "").replace("\r", "").replace("\n", "")
    return StreamingFileResponse(
        output,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"archivo\"; filename*=UTF-8''{quote(name)}"
            ),
            "X-Content-Type-Options": "nosniff",
        },
        background=BackgroundTask(shutil.rmtree, temp_dir, True),
    )
