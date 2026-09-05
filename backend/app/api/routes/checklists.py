import hashlib
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.routes.operations import (
    WORK_EDITOR_ROLES,
    add_activity,
    commit_or_conflict,
    flush_or_conflict,
    require_assignee,
    require_level,
    require_project,
    require_role,
    require_task,
)
from app.api.schemas.checklists import (
    ChecklistCreate,
    ChecklistEvidenceResponse,
    ChecklistListResponse,
    ChecklistPatch,
    ChecklistProgressResponse,
    ChecklistResponse,
)
from app.core.config import get_settings
from app.db.models import ChecklistEvidence, ChecklistItem

router = APIRouter()

SELF_CHECKLIST_ROLES = {"worker", "transport"}
SELF_CHECKLIST_STATUSES = {"in_progress", "blocked", "completed"}
ALLOWED_EVIDENCE_MIME_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}


async def require_checklist_item(
    db: DbSession,
    company_id: str,
    project_id: str,
    item_id: str,
) -> ChecklistItem:
    result = await db.execute(
        select(ChecklistItem).where(
            ChecklistItem.id == item_id,
            ChecklistItem.company_id == company_id,
            ChecklistItem.project_id == project_id,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Punto de control no encontrado",
        )
    return item


def require_evidence_access(access: CurrentCompanyAccess, item: ChecklistItem) -> None:
    if access.role in WORK_EDITOR_ROLES:
        return
    if access.role in SELF_CHECKLIST_ROLES and item.assigned_user_id == access.user.id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="No tiene permisos para agregar evidencias a este control",
    )


def evidence_path(storage_key: str) -> Path:
    root = get_settings().upload_root.resolve()
    candidate = (root / storage_key).resolve()
    if root not in candidate.parents:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="La evidencia tiene una ubicación inválida",
        )
    return candidate


@router.get("/projects/{project_id}/checklist", response_model=ChecklistListResponse)
async def list_checklist(
    project_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    checklist_status: str | None = Query(default=None, alias="status"),
    process_stage: str | None = Query(default=None, max_length=80),
    assigned_user_id: str | None = Query(default=None),
    task_id: str | None = Query(default=None),
    level_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> ChecklistListResponse:
    await require_project(db, access.company_id, project_id)
    filters = [
        ChecklistItem.company_id == access.company_id,
        ChecklistItem.project_id == project_id,
    ]
    if checklist_status:
        filters.append(ChecklistItem.status == checklist_status)
    if process_stage:
        filters.append(ChecklistItem.process_stage == process_stage)
    if assigned_user_id:
        filters.append(ChecklistItem.assigned_user_id == assigned_user_id)
    if task_id:
        await require_task(db, access.company_id, project_id, task_id)
        filters.append(ChecklistItem.task_id == task_id)
    if level_id:
        await require_level(db, project_id, level_id)
        filters.append(ChecklistItem.level_id == level_id)

    total = await db.scalar(select(func.count()).select_from(ChecklistItem).where(*filters))
    result = await db.execute(
        select(ChecklistItem)
        .where(*filters)
        .order_by(
            ChecklistItem.due_at.is_(None),
            ChecklistItem.due_at,
            ChecklistItem.created_at,
        )
        .limit(limit)
        .offset(offset)
    )
    return ChecklistListResponse(
        items=[ChecklistResponse.model_validate(item) for item in result.scalars()],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/projects/{project_id}/checklist/progress",
    response_model=ChecklistProgressResponse,
)
async def checklist_progress(
    project_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    task_id: str | None = Query(default=None),
    level_id: str | None = Query(default=None),
) -> ChecklistProgressResponse:
    await require_project(db, access.company_id, project_id)
    filters = [
        ChecklistItem.company_id == access.company_id,
        ChecklistItem.project_id == project_id,
    ]
    if task_id:
        await require_task(db, access.company_id, project_id, task_id)
        filters.append(ChecklistItem.task_id == task_id)
    if level_id:
        await require_level(db, project_id, level_id)
        filters.append(ChecklistItem.level_id == level_id)
    result = await db.execute(
        select(ChecklistItem.status, func.count(ChecklistItem.id))
        .where(*filters)
        .group_by(ChecklistItem.status)
    )
    counts = {item_status: count for item_status, count in result.all()}
    total = sum(counts.values())
    completed = counts.get("completed", 0)
    excluded = counts.get("not_applicable", 0)
    applicable = total - excluded
    completion_percent = round((completed / applicable * 100), 2) if applicable else 0.0
    return ChecklistProgressResponse(
        total=total,
        pending=counts.get("pending", 0),
        in_progress=counts.get("in_progress", 0),
        blocked=counts.get("blocked", 0),
        completed=completed,
        not_applicable=excluded,
        completion_percent=completion_percent,
    )


@router.post(
    "/projects/{project_id}/checklist",
    response_model=ChecklistResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_checklist_item(
    project_id: str,
    payload: ChecklistCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ChecklistItem:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    data = payload.model_dump()
    task = None
    if payload.task_id:
        task = await require_task(db, access.company_id, project_id, payload.task_id)
    if payload.level_id:
        await require_level(db, project_id, payload.level_id)
    if task and task.level_id:
        if payload.level_id and payload.level_id != task.level_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="La tarea y el checklist deben pertenecer al mismo nivel",
            )
        data["level_id"] = task.level_id
    await require_assignee(db, access.company_id, payload.assigned_user_id)
    item = ChecklistItem(
        company_id=access.company_id,
        project_id=project_id,
        **data,
    )
    if item.status == "completed":
        item.completed_at = datetime.now(UTC).replace(tzinfo=None)
        item.performed_on = item.performed_on or date.today()
    db.add(item)
    await flush_or_conflict(db, "No fue posible crear el punto de control")
    add_activity(db, access, "checklist.created", "checklist_item", item.id)
    await commit_or_conflict(db, "No fue posible crear el punto de control")
    await db.refresh(item)
    return item


@router.patch(
    "/projects/{project_id}/checklist/{item_id}",
    response_model=ChecklistResponse,
)
async def update_checklist_item(
    project_id: str,
    item_id: str,
    payload: ChecklistPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ChecklistItem:
    await require_project(db, access.company_id, project_id)
    item = await require_checklist_item(db, access.company_id, project_id, item_id)

    changes = payload.model_dump(exclude_unset=True)
    if access.role not in WORK_EDITOR_ROLES:
        allowed_self_update = (
            access.role in SELF_CHECKLIST_ROLES
            and item.assigned_user_id == access.user.id
            and set(changes) == {"status"}
            and changes["status"] in SELF_CHECKLIST_STATUSES
        )
        if not allowed_self_update:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo puede actualizar el estado de un control asignado a usted",
            )

    if "assigned_user_id" in changes:
        await require_assignee(db, access.company_id, changes["assigned_user_id"])
    task = None
    if changes.get("task_id"):
        task = await require_task(db, access.company_id, project_id, changes["task_id"])
    if changes.get("level_id"):
        await require_level(db, project_id, changes["level_id"])
    final_level_id = changes.get("level_id", item.level_id)
    if task and task.level_id:
        if final_level_id and final_level_id != task.level_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="La tarea y el checklist deben pertenecer al mismo nivel",
            )
        changes["level_id"] = task.level_id
    if changes.get("status") == "completed" and item.status != "completed":
        item.completed_at = datetime.now(UTC).replace(tzinfo=None)
        if "performed_on" not in changes:
            item.performed_on = date.today()
    elif "status" in changes and changes["status"] != "completed":
        item.completed_at = None
        if "performed_on" not in changes:
            item.performed_on = None
    for field, value in changes.items():
        setattr(item, field, value)
    add_activity(db, access, "checklist.updated", "checklist_item", item.id, changes)
    await commit_or_conflict(db, "No fue posible actualizar el punto de control")
    await db.refresh(item)
    return item


@router.get(
    "/projects/{project_id}/checklist/{item_id}/evidence",
    response_model=list[ChecklistEvidenceResponse],
)
async def list_checklist_evidence(
    project_id: str,
    item_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> list[ChecklistEvidence]:
    await require_project(db, access.company_id, project_id)
    await require_checklist_item(db, access.company_id, project_id, item_id)
    result = await db.execute(
        select(ChecklistEvidence)
        .where(
            ChecklistEvidence.company_id == access.company_id,
            ChecklistEvidence.project_id == project_id,
            ChecklistEvidence.checklist_item_id == item_id,
        )
        .order_by(ChecklistEvidence.created_at.desc())
    )
    return list(result.scalars())


@router.post(
    "/projects/{project_id}/checklist/{item_id}/evidence",
    response_model=ChecklistEvidenceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_checklist_evidence(
    project_id: str,
    item_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    note: Annotated[str | None, Form(max_length=2000)] = None,
    file: Annotated[UploadFile | None, File()] = None,
) -> ChecklistEvidence:
    await require_project(db, access.company_id, project_id)
    item = await require_checklist_item(db, access.company_id, project_id, item_id)
    require_evidence_access(access, item)
    if item.task_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El control debe estar vinculado a una tarea antes de agregar evidencias",
        )

    clean_note = note.strip() if note and note.strip() else None
    if file is None and clean_note is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Agregue una foto, un PDF o una observación",
        )

    storage_key: str | None = None
    original_filename: str | None = None
    mime_type: str | None = None
    size_bytes: int | None = None
    digest: str | None = None
    target: Path | None = None
    evidence_type = "note"

    if file is not None:
        mime_type = file.content_type or ""
        extension = ALLOWED_EVIDENCE_MIME_TYPES.get(mime_type)
        if extension is None:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Solo se permiten imágenes JPG, PNG, WEBP o documentos PDF",
            )
        settings = get_settings()
        content = await file.read(settings.evidence_max_bytes + 1)
        if len(content) > settings.evidence_max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="El archivo supera el máximo permitido de 10 MB",
            )
        if not content:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="El archivo está vacío",
            )
        original_filename = Path(file.filename or f"evidencia{extension}").name[:255]
        storage_key = "/".join(
            [
                access.company_id,
                project_id,
                item.task_id,
                item.id,
                f"{uuid4()}{extension}",
            ]
        )
        target = evidence_path(storage_key)
        await run_in_threadpool(target.parent.mkdir, parents=True, exist_ok=True)
        await run_in_threadpool(target.write_bytes, content)
        size_bytes = len(content)
        digest = hashlib.sha256(content).hexdigest()
        evidence_type = "photo" if mime_type.startswith("image/") else "document"

    evidence = ChecklistEvidence(
        company_id=access.company_id,
        project_id=project_id,
        task_id=item.task_id,
        checklist_item_id=item.id,
        evidence_type=evidence_type,
        note=clean_note,
        storage_key=storage_key,
        original_filename=original_filename,
        mime_type=mime_type,
        size_bytes=size_bytes,
        sha256=digest,
        uploaded_by_user_id=access.user.id,
    )
    db.add(evidence)
    try:
        await flush_or_conflict(db, "No fue posible registrar la evidencia")
        add_activity(db, access, "checklist.evidence_created", "checklist_evidence", evidence.id)
        await commit_or_conflict(db, "No fue posible registrar la evidencia")
    except Exception:
        if target and target.exists():
            await run_in_threadpool(target.unlink, missing_ok=True)
        raise
    await db.refresh(evidence)
    return evidence


@router.get(
    "/projects/{project_id}/checklist/{item_id}/evidence/{evidence_id}/file",
    response_class=FileResponse,
)
async def download_checklist_evidence(
    project_id: str,
    item_id: str,
    evidence_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> FileResponse:
    await require_project(db, access.company_id, project_id)
    await require_checklist_item(db, access.company_id, project_id, item_id)
    result = await db.execute(
        select(ChecklistEvidence).where(
            ChecklistEvidence.id == evidence_id,
            ChecklistEvidence.company_id == access.company_id,
            ChecklistEvidence.project_id == project_id,
            ChecklistEvidence.checklist_item_id == item_id,
        )
    )
    evidence = result.scalar_one_or_none()
    if evidence is None or evidence.storage_key is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Archivo de evidencia no encontrado",
        )
    path = evidence_path(evidence.storage_key)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El archivo de evidencia ya no está disponible",
        )
    return FileResponse(
        path,
        media_type=evidence.mime_type,
        filename=evidence.original_filename or path.name,
    )
