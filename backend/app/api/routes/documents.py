from datetime import UTC, datetime
from decimal import Decimal
from io import BytesIO
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, select

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.routes.operations import (
    WORK_EDITOR_ROLES,
    add_activity,
    commit_or_conflict,
    flush_or_conflict,
    require_project,
    require_role,
)
from app.api.schemas.modules import (
    ElongationItemCreate,
    ElongationItemPatch,
    ElongationItemResponse,
    ElongationJobResponse,
)
from app.core.config import get_settings
from app.db.models import ElongationItem, ElongationJob
from app.services.document_processing import build_xlsx, extract_text, parse_elongation_rows
from app.services.file_storage import remove_stored_file, storage_path, store_upload

router = APIRouter()


async def require_job(
    db: DbSession, company_id: str, project_id: str, job_id: str
) -> ElongationJob:
    job = await db.scalar(
        select(ElongationJob).where(
            ElongationJob.id == job_id,
            ElongationJob.company_id == company_id,
            ElongationJob.project_id == project_id,
        )
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Documento procesado no encontrado")
    return job


async def require_job_item(db: DbSession, job_id: str, item_id: str) -> ElongationItem:
    item = await db.scalar(
        select(ElongationItem).where(ElongationItem.id == item_id, ElongationItem.job_id == job_id)
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fila del documento no encontrada")
    return item


def job_response(
    job: ElongationJob, items: list[ElongationItem] | None = None, count: int = 0
) -> ElongationJobResponse:
    response = ElongationJobResponse.model_validate(job)
    response.item_count = len(items) if items is not None else count
    response.items = [ElongationItemResponse.model_validate(item) for item in items or []]
    return response


@router.get(
    "/projects/{project_id}/documents",
    response_model=list[ElongationJobResponse],
)
async def list_documents(
    project_id: str, access: CurrentCompanyAccess, db: DbSession
) -> list[ElongationJobResponse]:
    await require_project(db, access.company_id, project_id)
    rows = (
        await db.execute(
            select(ElongationJob, func.count(ElongationItem.id))
            .outerjoin(ElongationItem, ElongationItem.job_id == ElongationJob.id)
            .where(
                ElongationJob.company_id == access.company_id,
                ElongationJob.project_id == project_id,
            )
            .group_by(ElongationJob.id)
            .order_by(ElongationJob.created_at.desc())
        )
    ).all()
    return [job_response(job, count=count) for job, count in rows]


@router.post(
    "/projects/{project_id}/documents",
    response_model=ElongationJobResponse,
    status_code=status.HTTP_201_CREATED,
)
async def process_document(
    project_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    title: Annotated[str, Form(min_length=2, max_length=220)],
    file: Annotated[UploadFile, File()],
    tolerance_percent: Annotated[Decimal, Form(ge=0, le=100)] = Decimal("7.00"),
) -> ElongationJobResponse:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    stored = await store_upload(
        file,
        "companies",
        access.company_id,
        "projects",
        project_id,
        "documents",
        max_bytes=get_settings().document_max_bytes,
    )
    job = ElongationJob(
        company_id=access.company_id,
        project_id=project_id,
        title=title.strip(),
        source_kind="pdf" if stored.mime_type == "application/pdf" else "scan",
        source_storage_key=stored.storage_key,
        original_filename=stored.original_filename,
        mime_type=stored.mime_type,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        status="processing",
        tolerance_percent=tolerance_percent,
        created_by_user_id=access.user.id,
    )
    db.add(job)
    try:
        await flush_or_conflict(db, "No fue posible registrar el documento")
        try:
            text = await run_in_threadpool(
                extract_text,
                storage_path(stored.storage_key),
                stored.mime_type,
                get_settings().ocr_max_pdf_pages,
            )
            job.extracted_text = text
            parsed = parse_elongation_rows(text)
            items = [ElongationItem(job_id=job.id, **row) for row in parsed]
            db.add_all(items)
            job.status = "review_required"
            if not items:
                job.error_message = (
                    "No se detectaron filas automáticamente; puede cargarlas manualmente."
                )
        except RuntimeError as exc:
            items = []
            job.status = "failed"
            job.error_message = str(exc)[:500]
        job.completed_at = datetime.now(UTC).replace(tzinfo=None)
        add_activity(
            db,
            access,
            "document.processed",
            "elongation_job",
            job.id,
            {"detected_rows": len(items), "status": job.status},
        )
        await commit_or_conflict(db, "No fue posible guardar el resultado del documento")
    except Exception:
        await remove_stored_file(stored.storage_key)
        raise
    await db.refresh(job)
    for item in items:
        await db.refresh(item)
    return job_response(job, items)


@router.get(
    "/projects/{project_id}/documents/{job_id}",
    response_model=ElongationJobResponse,
)
async def get_document(
    project_id: str,
    job_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ElongationJobResponse:
    job = await require_job(db, access.company_id, project_id, job_id)
    items = list(
        (
            await db.execute(
                select(ElongationItem)
                .where(ElongationItem.job_id == job.id)
                .order_by(ElongationItem.label)
            )
        ).scalars()
    )
    return job_response(job, items)


@router.post(
    "/projects/{project_id}/documents/{job_id}/items",
    response_model=ElongationItemResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_document_item(
    project_id: str,
    job_id: str,
    payload: ElongationItemCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ElongationItem:
    require_role(access, WORK_EDITOR_ROLES)
    job = await require_job(db, access.company_id, project_id, job_id)
    item = ElongationItem(job_id=job.id, **payload.model_dump())
    db.add(item)
    await flush_or_conflict(db, "Ya existe una fila con esa etiqueta")
    add_activity(db, access, "document.item.created", "elongation_item", item.id)
    await commit_or_conflict(db, "Ya existe una fila con esa etiqueta")
    await db.refresh(item)
    return item


@router.patch(
    "/projects/{project_id}/documents/{job_id}/items/{item_id}",
    response_model=ElongationItemResponse,
)
async def update_document_item(
    project_id: str,
    job_id: str,
    item_id: str,
    payload: ElongationItemPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ElongationItem:
    require_role(access, WORK_EDITOR_ROLES)
    await require_job(db, access.company_id, project_id, job_id)
    item = await require_job_item(db, job_id, item_id)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(item, field, value)
    add_activity(db, access, "document.item.updated", "elongation_item", item.id, changes)
    await commit_or_conflict(db, "No fue posible actualizar la fila")
    await db.refresh(item)
    return item


@router.get("/projects/{project_id}/documents/{job_id}/source")
async def download_document_source(
    project_id: str,
    job_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> FileResponse:
    job = await require_job(db, access.company_id, project_id, job_id)
    if not job.source_storage_key or not job.mime_type:
        raise HTTPException(status_code=404, detail="El archivo fuente no está disponible")
    path = storage_path(job.source_storage_key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="El archivo fuente no está disponible")
    return FileResponse(path, media_type=job.mime_type, filename=job.original_filename)


@router.get("/projects/{project_id}/documents/{job_id}/excel")
async def download_document_excel(
    project_id: str,
    job_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> StreamingResponse:
    job = await require_job(db, access.company_id, project_id, job_id)
    items = list(
        (
            await db.execute(
                select(ElongationItem)
                .where(ElongationItem.job_id == job.id)
                .order_by(ElongationItem.label)
            )
        ).scalars()
    )
    rows = [
        {
            "label": item.label,
            "classification": item.classification,
            "length_m": item.length_m,
            "strand_count": item.strand_count,
            "calculated_elongation": item.calculated_elongation,
            "measured_elongation": item.measured_elongation,
            "review_status": item.review_status,
        }
        for item in items
    ]
    content = await run_in_threadpool(build_xlsx, rows)
    filename = f"elongaciones-{job.id[:8]}.xlsx"
    return StreamingResponse(
        BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
