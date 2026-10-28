import hashlib
import mimetypes
from pathlib import PurePath
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.routes.operations import (
    add_activity,
    commit_or_conflict,
    flush_or_conflict,
    require_project,
    require_role,
)
from app.core.config import get_settings
from app.db.models import ProjectFile, ProjectFolder
from app.services import project_drive, project_file_codec

router = APIRouter()
EDITOR_ROLES = {"owner", "admin", "engineer", "supervisor"}


class FolderInput(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    parent_id: str | None = None


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
async def list_files(project_id: str, access: CurrentCompanyAccess, db: DbSession):
    await require_project(db, access.company_id, project_id)
    return (
        (
            await db.execute(
                select(ProjectFile)
                .where(
                    ProjectFile.company_id == access.company_id,
                    ProjectFile.project_id == project_id,
                )
                .order_by(ProjectFile.created_at.desc())
                .limit(500)
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
    # Reject before buffering: no quota-sized attachment is retained on the VPS.
    key = f"{access.company_id.replace('-', '')}/{project_id.replace('-', '')}/{uuid4().hex}"
    project_drive.drive_location(key)
    limit = min(get_settings().evidence_max_bytes, 10 * 1024 * 1024)
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="El archivo supera el máximo de 10 MB",
        )
    if not content:
        raise HTTPException(status_code=422, detail="El archivo está vacío")
    original = PurePath((file.filename or "archivo").replace("\\", "/")).name[:255]
    mime = (mimetypes.guess_type(original)[0] or "application/octet-stream")[:120]
    stored, encoding = project_file_codec.encode(content)
    await project_drive.upload(key, stored)
    record = ProjectFile(
        company_id=access.company_id,
        project_id=project_id,
        folder_id=folder_id,
        original_filename=original,
        mime_type=mime,
        size_bytes=len(content),
        stored_size_bytes=len(stored),
        storage_encoding=encoding,
        sha256=hashlib.sha256(content).hexdigest(),
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
    return record


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
    stored = await project_drive.download(record.drive_key)
    if len(stored) != record.stored_size_bytes:
        raise HTTPException(status_code=502, detail="Tamaño en Drive distinto al registrado")
    try:
        content = project_file_codec.decode(stored, record.storage_encoding, record.size_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="El archivo almacenado está dañado") from exc
    if hashlib.sha256(content).hexdigest() != record.sha256:
        raise HTTPException(
            status_code=502,
            detail="La integridad del archivo en Drive no coincide con la registrada",
        )
    # Content-Disposition attachment and octet-stream prevent HTML/script execution.
    from urllib.parse import quote

    name = record.original_filename.replace('"', "").replace("\r", "").replace("\n", "")
    return Response(
        content,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"archivo\"; filename*=UTF-8''{quote(name)}"
            ),
            "X-Content-Type-Options": "nosniff",
        },
    )
