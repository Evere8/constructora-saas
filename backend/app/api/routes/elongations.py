"""Additive V2 API for traceable elongation-documentation jobs.

The legacy ``/documents`` routes remain mounted separately.  New clients use this resource so
they can distinguish theory, physical S measurements, approvals and immutable exports.
"""

from __future__ import annotations

import subprocess
import tempfile
from datetime import UTC, datetime
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageOps
from sqlalchemy import select

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
)
from app.api.schemas.elongations import (
    ElongationBulkClassification,
    ElongationClassificationZoneCreate,
    ElongationClassificationZoneResponse,
    ElongationFileResponse,
    ElongationItemV2Patch,
    ElongationItemV2Response,
    ElongationJobV2Response,
    ElongationMeasurementPatch,
    ElongationMeasurementResponse,
    ElongationProgressResponse,
)
from app.core.config import get_settings
from app.db.models import (
    ElongationClassificationZone,
    ElongationItem,
    ElongationJob,
    ElongationJobFile,
    ElongationMeasurement,
    PlanDocument,
    PlanVersion,
)
from app.services.elongations.classification import zone_contains
from app.services.elongations.measurements import tolerance_status
from app.services.elongations.pipeline import (
    DOCUMENT_APPROVER_ROLES,
    create_export,
    ensure_measurement_slots,
    invalidate_approvals,
    invalidate_final_approval,
    invalidate_measurement_reviews,
    process_measurement_files,
    process_theory_job,
    progress_for,
)
from app.services.elongations.template import TemplateValidationError, analyse_template
from app.services.elongations.theory import normalise_label
from app.services.file_storage import (
    DOCUMENT_MIME_TYPES,
    XLSX_MIME_TYPES,
    remove_stored_file,
    storage_path,
    store_upload,
)

router = APIRouter()


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def json_safe(value: Any) -> Any:
    """Retain Decimal values precisely when they are written to ActivityLog JSON."""

    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): json_safe(child) for key, child in value.items()}
    if isinstance(value, list | tuple):
        return [json_safe(child) for child in value]
    return value


def require_document_approver(access: CurrentCompanyAccess) -> None:
    require_role(access, DOCUMENT_APPROVER_ROLES)


def _preview_png(path: Path, mime_type: str, page: int) -> bytes:
    """Create an authenticated, downscaled preview without storing a derivative.

    The review UI fetches this private blob with its bearer token, then draws normalized OCR
    boxes over it.  Originals are neither overwritten nor made publicly addressable.
    """

    if mime_type == "application/pdf":
        with tempfile.TemporaryDirectory(prefix="obrixapy-preview-") as directory:
            output = Path(directory) / "page"
            try:
                subprocess.run(
                    [
                        "pdftoppm",
                        "-f",
                        str(page),
                        "-l",
                        str(page),
                        "-singlefile",
                        "-png",
                        "-r",
                        "150",
                        str(path),
                        str(output),
                    ],
                    check=True,
                    capture_output=True,
                    timeout=45,
                )
            except (OSError, subprocess.SubprocessError) as exc:
                raise ValueError("No fue posible preparar la vista previa del PDF") from exc
            rendered = output.with_suffix(".png")
            if not rendered.is_file():
                raise ValueError("No fue posible preparar la vista previa del PDF")
            return rendered.read_bytes()
    try:
        with Image.open(path) as image:
            preview = ImageOps.exif_transpose(image).convert("RGB")
            preview.thumbnail((2400, 2400))
            output = BytesIO()
            preview.save(output, format="PNG", optimize=True)
            return output.getvalue()
    except (OSError, ValueError) as exc:
        raise ValueError("No fue posible preparar la vista previa de la imagen") from exc


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
        raise HTTPException(status_code=404, detail="Trabajo de elongaciones no encontrado")
    return job


async def load_job_data(
    db: DbSession, job: ElongationJob
) -> tuple[
    list[ElongationItem],
    list[ElongationMeasurement],
    list[ElongationJobFile],
    list[ElongationClassificationZone],
]:
    items = list(
        (
            await db.execute(
                select(ElongationItem)
                .where(ElongationItem.job_id == job.id)
                .order_by(ElongationItem.label_number, ElongationItem.label)
            )
        ).scalars()
    )
    measurements = list(
        (
            await db.execute(
                select(ElongationMeasurement)
                .where(ElongationMeasurement.job_id == job.id)
                .order_by(ElongationMeasurement.item_id, ElongationMeasurement.ordinal)
            )
        ).scalars()
    )
    files = list(
        (
            await db.execute(
                select(ElongationJobFile)
                .where(ElongationJobFile.job_id == job.id)
                .order_by(ElongationJobFile.kind, ElongationJobFile.version_number)
            )
        ).scalars()
    )
    zones = list(
        (
            await db.execute(
                select(ElongationClassificationZone)
                .where(ElongationClassificationZone.job_id == job.id)
                .order_by(ElongationClassificationZone.created_at, ElongationClassificationZone.id)
            )
        ).scalars()
    )
    return items, measurements, files, zones


def _job_response(
    job: ElongationJob,
    items: list[ElongationItem],
    measurements: list[ElongationMeasurement],
    files: list[ElongationJobFile],
    zones: list[ElongationClassificationZone],
) -> ElongationJobV2Response:
    by_item: dict[str, list[ElongationMeasurement]] = {}
    for measurement in measurements:
        by_item.setdefault(measurement.item_id, []).append(measurement)
    item_responses = []
    for item in items:
        payload = ElongationItemV2Response.model_validate(item).model_dump()
        payload["measurements"] = [
            _measurement_response(job, item, measurement)
            for measurement in by_item.get(item.id, [])
        ]
        item_responses.append(ElongationItemV2Response.model_validate(payload))
    response = ElongationJobV2Response.model_validate(job).model_copy(
        update={
            "progress": ElongationProgressResponse.model_validate(
                progress_for(job, items, measurements, files)
            ),
            "files": [ElongationFileResponse.model_validate(file) for file in files],
            "zones": [ElongationClassificationZoneResponse.model_validate(zone) for zone in zones],
            "items": item_responses,
        }
    )
    return response


def _measurement_response(
    job: ElongationJob,
    item: ElongationItem,
    measurement: ElongationMeasurement,
) -> ElongationMeasurementResponse:
    """Expose tolerance from Decimal arithmetic; the browser never owns approval math."""

    percent = job.tolerance_percent / Decimal("100")
    payload = ElongationMeasurementResponse.model_validate(measurement).model_dump()
    payload.update(
        {
            "maximum_elongation": item.calculated_elongation * (Decimal("1") + percent),
            "minimum_elongation": item.calculated_elongation * (Decimal("1") - percent),
            "tolerance_status": tolerance_status(
                item.calculated_elongation,
                measurement.measured_elongation,
                job.tolerance_percent,
                unresolved=measurement.review_status == "conflict",
            ),
        }
    )
    return ElongationMeasurementResponse.model_validate(payload)


async def response_for_job(db: DbSession, job: ElongationJob) -> ElongationJobV2Response:
    items, measurements, files, zones = await load_job_data(db, job)
    return _job_response(job, items, measurements, files, zones)


def _resume_queued_theory_job(background_tasks: BackgroundTasks, job: ElongationJob) -> None:
    """Recover a persisted job when an earlier HTTP response was interrupted.

    FastAPI runs BackgroundTasks only after a successful response.  If a job
    was committed but that first response failed, the idempotent re-submit must
    resume its queued theory work instead of leaving it permanently queued.
    """

    if job.workflow_status == "queued_theory":
        background_tasks.add_task(process_theory_job, job.id)


async def _next_file_version(db: DbSession, job_id: str, kind: str) -> int:
    latest = await db.scalar(
        select(ElongationJobFile.version_number)
        .where(ElongationJobFile.job_id == job_id, ElongationJobFile.kind == kind)
        .order_by(ElongationJobFile.version_number.desc())
        .limit(1)
    )
    return (latest or 0) + 1


async def _create_source_file(
    db: DbSession,
    job: ElongationJob,
    *,
    kind: str,
    storage_key: str,
    original_filename: str,
    mime_type: str,
    size_bytes: int,
    sha256: str,
    uploaded_by_user_id: str,
) -> ElongationJobFile:
    file = ElongationJobFile(
        job_id=job.id,
        kind=kind,
        version_number=await _next_file_version(db, job.id, kind),
        storage_key=storage_key,
        original_filename=original_filename,
        mime_type=mime_type,
        size_bytes=size_bytes,
        sha256=sha256,
        uploaded_by_user_id=uploaded_by_user_id,
    )
    db.add(file)
    await db.flush()
    return file


async def _latest_source_file(
    db: DbSession, job_id: str, kind: str
) -> ElongationJobFile | None:
    return await db.scalar(
        select(ElongationJobFile)
        .where(ElongationJobFile.job_id == job_id, ElongationJobFile.kind == kind)
        .order_by(ElongationJobFile.version_number.desc())
        .limit(1)
    )


async def _source_file_is_available(source: ElongationJobFile | None) -> bool:
    if source is None:
        return False
    try:
        return await run_in_threadpool(storage_path(source.storage_key).is_file)
    except HTTPException:
        return False


async def _restore_missing_source_file(
    db: DbSession,
    job: ElongationJob,
    *,
    kind: str,
    source_values: dict[str, Any],
    uploaded_by_user_id: str,
) -> bool:
    """Repair an idempotent job only when its original source is unavailable.

    A request that committed before an old container was replaced can retain
    metadata while its pre-volume upload is gone.  The same SHA input is safe
    to use as a recovery source; healthy immutable sources are never replaced.
    """

    source = await _latest_source_file(db, job.id, kind)
    if await _source_file_is_available(source):
        return False
    if source is None:
        await _create_source_file(
            db,
            job,
            kind=kind,
            uploaded_by_user_id=uploaded_by_user_id,
            **source_values,
        )
        return True
    source.storage_key = source_values["storage_key"]
    source.original_filename = source_values["original_filename"]
    source.mime_type = source_values["mime_type"]
    source.size_bytes = source_values["size_bytes"]
    source.sha256 = source_values["sha256"]
    source.page_count = None
    source.processing_status = "uploaded"
    source.processing_summary_json = None
    source.error_message = None
    await db.flush()
    return True


@router.get("/projects/{project_id}/elongation-jobs", response_model=list[ElongationJobV2Response])
async def list_elongation_jobs(
    project_id: str, access: CurrentCompanyAccess, db: DbSession
) -> list[ElongationJobV2Response]:
    await require_project(db, access.company_id, project_id)
    jobs = list(
        (
            await db.execute(
                select(ElongationJob)
                .where(
                    ElongationJob.company_id == access.company_id,
                    ElongationJob.project_id == project_id,
                )
                .order_by(ElongationJob.created_at.desc())
            )
        ).scalars()
    )
    return [await response_for_job(db, job) for job in jobs]


@router.post(
    "/projects/{project_id}/elongation-jobs",
    response_model=ElongationJobV2Response,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_elongation_job(
    project_id: str,
    background_tasks: BackgroundTasks,
    access: CurrentCompanyAccess,
    db: DbSession,
    title: Annotated[str, Form(min_length=2, max_length=220)],
    template_file: Annotated[UploadFile, File()],
    plan_file: Annotated[UploadFile | None, File()] = None,
    plan_version_id: Annotated[str | None, Form()] = None,
    level_id: Annotated[str | None, Form()] = None,
    responsible_user_id: Annotated[str | None, Form()] = None,
    tolerance_percent: Annotated[Decimal | None, Form(ge=0, le=100)] = None,
) -> ElongationJobV2Response:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    await require_level(db, project_id, level_id)
    await require_assignee(db, access.company_id, responsible_user_id)
    if bool(plan_file) == bool(plan_version_id):
        raise HTTPException(
            status_code=422,
            detail="Debe indicar exactamente un plano existente o un archivo PDF de plano",
        )
    uploaded_keys: list[str] = []
    persisted_upload_keys: set[str] = set()
    try:
        template_upload = await store_upload(
            template_file,
            "companies",
            access.company_id,
            "projects",
            project_id,
            "elongation-jobs",
            "templates",
            allowed_mime_types=XLSX_MIME_TYPES,
            max_bytes=get_settings().document_max_bytes,
        )
        uploaded_keys.append(template_upload.storage_key)
        try:
            template_bytes = await run_in_threadpool(
                storage_path(template_upload.storage_key).read_bytes
            )
            mapping = await run_in_threadpool(
                analyse_template, template_bytes, template_upload.original_filename
            )
        except TemplateValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if tolerance_percent is not None and tolerance_percent != mapping.tolerance_percent:
            raise HTTPException(
                status_code=422,
                detail=(
                    "La tolerancia indicada contradice la fórmula de la plantilla "
                    f"({mapping.tolerance_percent}%)"
                ),
            )
        if plan_file is not None:
            plan_upload = await store_upload(
                plan_file,
                "companies",
                access.company_id,
                "projects",
                project_id,
                "elongation-jobs",
                "plans",
                allowed_mime_types=DOCUMENT_MIME_TYPES,
                max_bytes=get_settings().document_max_bytes,
            )
            uploaded_keys.append(plan_upload.storage_key)
            plan_values: dict[str, Any] = {
                "storage_key": plan_upload.storage_key,
                "original_filename": plan_upload.original_filename,
                "mime_type": plan_upload.mime_type,
                "size_bytes": plan_upload.size_bytes,
                "sha256": plan_upload.sha256,
                "plan_version_id": None,
            }
        else:
            plan = await db.scalar(
                select(PlanVersion)
                .join(PlanDocument, PlanDocument.id == PlanVersion.document_id)
                .where(PlanVersion.id == plan_version_id, PlanDocument.project_id == project_id)
            )
            if plan is None:
                raise HTTPException(
                    status_code=422,
                    detail="El plano seleccionado no pertenece a esta obra",
                )
            plan_values = {
                "storage_key": plan.storage_key,
                "original_filename": plan.original_filename,
                "mime_type": plan.mime_type,
                "size_bytes": plan.size_bytes,
                "sha256": plan.sha256,
                "plan_version_id": plan.id,
            }
        idempotency_key = f"{plan_values['sha256']}:{template_upload.sha256}"
        existing = await db.scalar(
            select(ElongationJob)
            .where(
                ElongationJob.company_id == access.company_id,
                ElongationJob.project_id == project_id,
                ElongationJob.idempotency_key == idempotency_key,
            )
            .order_by(ElongationJob.created_at.desc())
        )
        if existing is not None:
            plan_file_missing = not await _source_file_is_available(
                await _latest_source_file(db, existing.id, "plan")
            )
            template_file_missing = not await _source_file_is_available(
                await _latest_source_file(db, existing.id, "template")
            )
            if plan_file_missing and plan_file is None:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "El plano fuente del trabajo anterior no está disponible. "
                        "Cárguelo nuevamente como archivo para restaurarlo."
                    ),
                )
            restored_kinds: list[str] = []
            if plan_file_missing:
                restored = await _restore_missing_source_file(
                    db,
                    existing,
                    kind="plan",
                    source_values={
                        key: plan_values[key]
                        for key in (
                            "storage_key",
                            "original_filename",
                            "mime_type",
                            "size_bytes",
                            "sha256",
                        )
                    },
                    uploaded_by_user_id=access.user.id,
                )
                if restored:
                    persisted_upload_keys.add(plan_values["storage_key"])
                    restored_kinds.append("plan")
                    existing.plan_version_id = plan_values["plan_version_id"]
                    existing.source_kind = (
                        "pdf" if plan_values["mime_type"] == "application/pdf" else "scan"
                    )
                    existing.source_storage_key = plan_values["storage_key"]
                    existing.original_filename = plan_values["original_filename"]
                    existing.mime_type = plan_values["mime_type"]
                    existing.size_bytes = plan_values["size_bytes"]
                    existing.sha256 = plan_values["sha256"]
            if template_file_missing:
                restored = await _restore_missing_source_file(
                    db,
                    existing,
                    kind="template",
                    source_values={
                        "storage_key": template_upload.storage_key,
                        "original_filename": template_upload.original_filename,
                        "mime_type": template_upload.mime_type,
                        "size_bytes": template_upload.size_bytes,
                        "sha256": template_upload.sha256,
                    },
                    uploaded_by_user_id=access.user.id,
                )
                if restored:
                    persisted_upload_keys.add(template_upload.storage_key)
                    restored_kinds.append("template")
                    existing.template_mapping_json = mapping.to_dict()
            if restored_kinds:
                existing.workflow_status = "queued_theory"
                existing.status = "queued_theory"
                existing.error_message = None
                existing.completed_at = None
                add_activity(
                    db,
                    access,
                    "elongation.job.sources.restored",
                    "elongation_job",
                    existing.id,
                    {"sources": restored_kinds},
                )
                await commit_or_conflict(db, "No fue posible restaurar las fuentes del trabajo")
                background_tasks.add_task(process_theory_job, existing.id)
            for storage_key in set(uploaded_keys) - persisted_upload_keys:
                await remove_stored_file(storage_key)
            if not restored_kinds:
                _resume_queued_theory_job(background_tasks, existing)
            return await response_for_job(db, existing)
        job = ElongationJob(
            company_id=access.company_id,
            project_id=project_id,
            level_id=level_id,
            responsible_user_id=responsible_user_id,
            plan_version_id=plan_values["plan_version_id"],
            title=title.strip(),
            source_kind="pdf" if plan_values["mime_type"] == "application/pdf" else "scan",
            source_storage_key=plan_values["storage_key"],
            original_filename=plan_values["original_filename"],
            mime_type=plan_values["mime_type"],
            size_bytes=plan_values["size_bytes"],
            sha256=plan_values["sha256"],
            idempotency_key=idempotency_key,
            status="queued_theory",
            workflow_status="queued_theory",
            tolerance_percent=mapping.tolerance_percent,
            template_mapping_json=mapping.to_dict(),
            processing_summary_json={
                "idempotency": f"{plan_values['sha256']}:{template_upload.sha256}"
            },
            created_by_user_id=access.user.id,
        )
        db.add(job)
        await flush_or_conflict(db, "No fue posible crear el trabajo de elongaciones")
        await _create_source_file(
            db,
            job,
            kind="plan",
            uploaded_by_user_id=access.user.id,
            storage_key=plan_values["storage_key"],
            original_filename=plan_values["original_filename"],
            mime_type=plan_values["mime_type"],
            size_bytes=plan_values["size_bytes"],
            sha256=plan_values["sha256"],
        )
        await _create_source_file(
            db,
            job,
            kind="template",
            storage_key=template_upload.storage_key,
            original_filename=template_upload.original_filename,
            mime_type=template_upload.mime_type,
            size_bytes=template_upload.size_bytes,
            sha256=template_upload.sha256,
            uploaded_by_user_id=access.user.id,
        )
        add_activity(
            db,
            access,
            "elongation.job.created",
            "elongation_job",
            job.id,
            {"workflow_status": job.workflow_status, "template": template_upload.sha256},
        )
        await commit_or_conflict(db, "No fue posible guardar el trabajo de elongaciones")
        persisted_upload_keys.update(uploaded_keys)
        # MySQL assigns created_at on the server.  Refresh before serializing so
        # Pydantic never triggers an implicit async lazy-load after the commit.
        await db.refresh(job)
        background_tasks.add_task(process_theory_job, job.id)
        return await response_for_job(db, job)
    except Exception:
        for storage_key in uploaded_keys:
            if storage_key not in persisted_upload_keys:
                await remove_stored_file(storage_key)
        raise


@router.get(
    "/projects/{project_id}/elongation-jobs/{job_id}", response_model=ElongationJobV2Response
)
async def get_elongation_job(
    project_id: str, job_id: str, access: CurrentCompanyAccess, db: DbSession
) -> ElongationJobV2Response:
    job = await require_job(db, access.company_id, project_id, job_id)
    return await response_for_job(db, job)


@router.post(
    "/projects/{project_id}/elongation-jobs/{job_id}/retry",
    response_model=ElongationJobV2Response,
    status_code=status.HTTP_202_ACCEPTED,
)
async def retry_elongation_job(
    project_id: str,
    job_id: str,
    background_tasks: BackgroundTasks,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ElongationJobV2Response:
    require_role(access, WORK_EDITOR_ROLES)
    job = await require_job(db, access.company_id, project_id, job_id)
    items, _, files, _ = await load_job_data(db, job)
    measurement_files = [file.id for file in files if file.kind == "measurement_scan"]
    if job.workflow_status in {
        "failed_measurements",
        "processing_measurements",
        "measurement_review",
    }:
        if not measurement_files:
            raise HTTPException(
                status_code=422,
                detail="No hay archivos de mediciones para reintentar",
            )
        job.workflow_status = "queued_measurements"
        job.status = "queued_measurements"
        add_activity(db, access, "elongation.measurements.retry", "elongation_job", job.id)
        await commit_or_conflict(db, "No fue posible reintentar las mediciones")
        background_tasks.add_task(process_measurement_files, job.id, measurement_files)
    else:
        if job.workflow_status not in {
            "failed_theory",
            "queued_theory",
            "processing_theory",
        }:
            raise HTTPException(
                status_code=422,
                detail="Solo se puede releer una teoría fallida o interrumpida",
            )
        if job.theory_approved_at is not None:
            raise HTTPException(status_code=422, detail="No se puede releer teoría ya aprobada")
        job.workflow_status = "queued_theory"
        job.status = "queued_theory"
        job.error_message = None
        add_activity(
            db, access, "elongation.theory.retry", "elongation_job", job.id, {"items": len(items)}
        )
        await commit_or_conflict(db, "No fue posible reintentar la teoría")
        background_tasks.add_task(process_theory_job, job.id)
    return await response_for_job(db, job)


@router.patch(
    "/projects/{project_id}/elongation-jobs/{job_id}/items/{item_id}",
    response_model=ElongationItemV2Response,
)
async def update_elongation_item(
    project_id: str,
    job_id: str,
    item_id: str,
    payload: ElongationItemV2Patch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ElongationItemV2Response:
    require_role(access, WORK_EDITOR_ROLES)
    job = await require_job(db, access.company_id, project_id, job_id)
    item = await db.scalar(
        select(ElongationItem).where(ElongationItem.id == item_id, ElongationItem.job_id == job.id)
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Grupo teórico no encontrado")
    changes = payload.model_dump(exclude_unset=True)
    previous_values = {
        field: getattr(item, field)
        for field in changes
        if field != "source_location_json" and hasattr(item, field)
    }
    if "source_location_json" in changes:
        previous_values["source_location_json"] = item.source_location_json
    theory_changed = bool(
        {
            "label",
            "classification",
            "length_m",
            "strand_count",
            "calculated_elongation",
            "source_location_json",
        }
        & set(changes)
    )
    activity_changes = json_safe(dict(changes))
    if changes.get("theory_review_status") in {"approved", "rejected"}:
        require_document_approver(access)
        item.reviewed_by_user_id = access.user.id
        item.reviewed_at = utcnow()
    if "label" in changes and changes["label"] is not None:
        normalized, number = normalise_label(changes["label"])
        changes["label"] = normalized
        item.label_number = number
    if "strand_count" in changes and changes["strand_count"] is not None:
        previous_strand_count = item.strand_count
        updated_strand_count = changes.pop("strand_count")
        item.strand_count = updated_strand_count
        activity_changes["strand_count"] = updated_strand_count
        try:
            await ensure_measurement_slots(db, item, job_id=job.id)
        except ValueError as exc:
            item.strand_count = previous_strand_count
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    for field, value in changes.items():
        setattr(item, field, value)
    if theory_changed and changes.get("theory_review_status") != "approved":
        item.theory_review_status = "pending"
    if theory_changed:
        await invalidate_measurement_reviews(db, job.id)
    if job.theory_approved_at is not None or job.approved_at is not None:
        invalidate_approvals(job)
        add_activity(db, access, "elongation.approvals.invalidated", "elongation_job", job.id)
    else:
        job.workflow_status = "theory_review"
        job.status = "review_required"
    add_activity(
        db,
        access,
        "elongation.item.updated",
        "elongation_item",
        item.id,
        {"previous": json_safe(previous_values), "next": activity_changes},
    )
    await commit_or_conflict(db, "No fue posible actualizar el grupo teórico")
    measurements = list(
        (
            await db.execute(
                select(ElongationMeasurement)
                .where(ElongationMeasurement.item_id == item.id)
                .order_by(ElongationMeasurement.ordinal)
            )
        ).scalars()
    )
    response = ElongationItemV2Response.model_validate(item).model_dump()
    response["measurements"] = [
        _measurement_response(job, item, measurement) for measurement in measurements
    ]
    return ElongationItemV2Response.model_validate(response)


@router.post(
    "/projects/{project_id}/elongation-jobs/{job_id}/classify",
    response_model=ElongationJobV2Response,
)
async def classify_elongation_items(
    project_id: str,
    job_id: str,
    payload: ElongationBulkClassification,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ElongationJobV2Response:
    require_role(access, WORK_EDITOR_ROLES)
    job = await require_job(db, access.company_id, project_id, job_id)
    items = list(
        (
            await db.execute(
                select(ElongationItem).where(
                    ElongationItem.job_id == job.id, ElongationItem.id.in_(payload.item_ids)
                )
            )
        ).scalars()
    )
    if len(items) != len(set(payload.item_ids)):
        raise HTTPException(status_code=404, detail="Uno o más grupos no pertenecen al trabajo")
    previous_classification = {
        item.id: item.classification
        for item in items
        if item.classification != payload.classification
    }
    for item in items:
        item.classification = payload.classification
        item.theory_review_status = "pending"
    if previous_classification:
        await invalidate_measurement_reviews(db, job.id)
    if previous_classification and (
        job.theory_approved_at is not None or job.approved_at is not None
    ):
        invalidate_approvals(job)
        add_activity(db, access, "elongation.approvals.invalidated", "elongation_job", job.id)
    add_activity(
        db,
        access,
        "elongation.items.classified",
        "elongation_job",
        job.id,
        {
            "previous": previous_classification,
            "next": {"item_ids": payload.item_ids, "classification": payload.classification},
        },
    )
    await commit_or_conflict(db, "No fue posible clasificar los grupos")
    return await response_for_job(db, job)


@router.post(
    "/projects/{project_id}/elongation-jobs/{job_id}/classification-zones",
    response_model=ElongationJobV2Response,
)
async def create_classification_zone(
    project_id: str,
    job_id: str,
    payload: ElongationClassificationZoneCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ElongationJobV2Response:
    """Store a reviewer-drawn normalized zone and apply it only to candidate centers inside it."""

    require_role(access, WORK_EDITOR_ROLES)
    job = await require_job(db, access.company_id, project_id, job_id)
    geometry = payload.geometry.model_dump(mode="json")
    zone = ElongationClassificationZone(
        job_id=job.id,
        classification=payload.classification,
        name=payload.name.strip() if payload.name else None,
        geometry_json=geometry,
        created_by_user_id=access.user.id,
    )
    db.add(zone)
    items = list(
        (
            await db.execute(
                select(ElongationItem).where(ElongationItem.job_id == job.id)
            )
        ).scalars()
    )
    previous_classification: dict[str, str] = {}
    for item in items:
        if not zone_contains(geometry, item.source_location_json):
            continue
        if item.classification != payload.classification:
            previous_classification[item.id] = item.classification
            item.classification = payload.classification
            item.theory_review_status = "pending"
    if previous_classification:
        await invalidate_measurement_reviews(db, job.id)
        if job.theory_approved_at is not None or job.approved_at is not None:
            invalidate_approvals(job)
            add_activity(db, access, "elongation.approvals.invalidated", "elongation_job", job.id)
    add_activity(
        db,
        access,
        "elongation.zone.created",
        "elongation_job",
        job.id,
        {
            "zone": {"classification": payload.classification, "geometry": geometry},
            "changed_items": previous_classification,
        },
    )
    await commit_or_conflict(db, "No fue posible aplicar la zona de clasificación")
    return await response_for_job(db, job)


@router.delete(
    "/projects/{project_id}/elongation-jobs/{job_id}/classification-zones/{zone_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_classification_zone(
    project_id: str,
    job_id: str,
    zone_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    """Remove only the drawing; prior reviewer classifications remain auditable and explicit."""

    require_role(access, WORK_EDITOR_ROLES)
    job = await require_job(db, access.company_id, project_id, job_id)
    zone = await db.scalar(
        select(ElongationClassificationZone).where(
            ElongationClassificationZone.id == zone_id,
            ElongationClassificationZone.job_id == job.id,
        )
    )
    if zone is None:
        raise HTTPException(status_code=404, detail="Zona de clasificación no encontrada")
    await db.delete(zone)
    add_activity(
        db,
        access,
        "elongation.zone.deleted",
        "elongation_job",
        job.id,
        {"zone_id": zone_id},
    )
    await commit_or_conflict(db, "No fue posible eliminar la zona de clasificación")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/projects/{project_id}/elongation-jobs/{job_id}/approve-theory",
    response_model=ElongationJobV2Response,
)
async def approve_elongation_theory(
    project_id: str, job_id: str, access: CurrentCompanyAccess, db: DbSession
) -> ElongationJobV2Response:
    require_document_approver(access)
    job = await require_job(db, access.company_id, project_id, job_id)
    items, measurements, files, _ = await load_job_data(db, job)
    progress = progress_for(job, items, measurements, files)
    if not progress["can_approve_theory"]:
        raise HTTPException(status_code=422, detail={"blockers": progress["approval_blockers"]})
    job.theory_approved_by_user_id = access.user.id
    job.theory_approved_at = utcnow()
    job.workflow_status = "measurements_pending"
    job.status = "review_required"
    add_activity(db, access, "elongation.theory.approved", "elongation_job", job.id)
    await commit_or_conflict(db, "No fue posible aprobar la teoría")
    return await response_for_job(db, job)


@router.post(
    "/projects/{project_id}/elongation-jobs/{job_id}/measurement-files",
    response_model=ElongationJobV2Response,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_measurement_files(
    project_id: str,
    job_id: str,
    background_tasks: BackgroundTasks,
    access: CurrentCompanyAccess,
    db: DbSession,
    files: Annotated[list[UploadFile], File(min_length=1, max_length=25)],
) -> ElongationJobV2Response:
    require_role(access, WORK_EDITOR_ROLES)
    job = await require_job(db, access.company_id, project_id, job_id)
    if job.theory_approved_at is None:
        raise HTTPException(status_code=422, detail="Primero debe aprobarse la teoría")
    if job.approved_at is not None:
        invalidate_final_approval(job)
        add_activity(db, access, "elongation.final.invalidated", "elongation_job", job.id)
    stored_keys: list[str] = []
    created_ids: list[str] = []
    try:
        for upload in files:
            stored = await store_upload(
                upload,
                "companies",
                access.company_id,
                "projects",
                project_id,
                "elongation-jobs",
                job.id,
                "measurement-scans",
                allowed_mime_types=DOCUMENT_MIME_TYPES,
                max_bytes=get_settings().document_max_bytes,
            )
            stored_keys.append(stored.storage_key)
            file = await _create_source_file(
                db,
                job,
                kind="measurement_scan",
                storage_key=stored.storage_key,
                original_filename=stored.original_filename,
                mime_type=stored.mime_type,
                size_bytes=stored.size_bytes,
                sha256=stored.sha256,
                uploaded_by_user_id=access.user.id,
            )
            created_ids.append(file.id)
        job.workflow_status = "queued_measurements"
        job.status = "queued_measurements"
        add_activity(
            db,
            access,
            "elongation.measurements.uploaded",
            "elongation_job",
            job.id,
            {"file_ids": created_ids},
        )
        await commit_or_conflict(db, "No fue posible guardar las mediciones")
        background_tasks.add_task(process_measurement_files, job.id, created_ids)
        return await response_for_job(db, job)
    except Exception:
        for storage_key in stored_keys:
            await remove_stored_file(storage_key)
        raise


@router.patch(
    "/projects/{project_id}/elongation-jobs/{job_id}/measurements/{measurement_id}",
    response_model=ElongationMeasurementResponse,
)
async def update_elongation_measurement(
    project_id: str,
    job_id: str,
    measurement_id: str,
    payload: ElongationMeasurementPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ElongationMeasurementResponse:
    require_role(access, WORK_EDITOR_ROLES)
    job = await require_job(db, access.company_id, project_id, job_id)
    measurement = await db.scalar(
        select(ElongationMeasurement).where(
            ElongationMeasurement.id == measurement_id, ElongationMeasurement.job_id == job.id
        )
    )
    if measurement is None:
        raise HTTPException(status_code=404, detail="Medición no encontrada")
    item = await db.get(ElongationItem, measurement.item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Grupo de medición no encontrado")
    changes = payload.model_dump(exclude_unset=True)
    previous_values = {field: getattr(measurement, field) for field in changes}
    if "ordinal" in changes and changes["ordinal"] is not None:
        ordinal = changes["ordinal"]
        if ordinal > item.strand_count:
            raise HTTPException(status_code=422, detail="El ordinal no puede superar S")
        conflict = await db.scalar(
            select(ElongationMeasurement.id).where(
                ElongationMeasurement.item_id == item.id,
                ElongationMeasurement.ordinal == ordinal,
                ElongationMeasurement.id != measurement.id,
            )
        )
        if conflict is not None:
            raise HTTPException(status_code=409, detail="Ese ordinal ya está ocupado")
    # A supervisor must be able to correct a previously approved value.  Such a correction is
    # never an implicit approval: it goes back to pending before authorization is evaluated.
    if "measured_elongation" in changes and "review_status" not in changes:
        changes["review_status"] = "pending"
    proposed_value = changes.get("measured_elongation", measurement.measured_elongation)
    proposed_status = changes.get("review_status", measurement.review_status)
    proposed_reason = changes.get("override_reason", measurement.override_reason)
    if proposed_status == "approved":
        require_document_approver(access)
        if proposed_value is None:
            raise HTTPException(
                status_code=422,
                detail="Una medición debe tener valor antes de aprobarse",
            )
        current_tolerance = tolerance_status(
            item.calculated_elongation, proposed_value, job.tolerance_percent
        )
        if current_tolerance == "outside" and not proposed_reason:
            raise HTTPException(
                status_code=422,
                detail="Una medición fuera de tolerancia requiere una observación para aprobarse",
            )
        measurement.reviewed_by_user_id = access.user.id
        measurement.reviewed_at = utcnow()
    for field, value in changes.items():
        setattr(measurement, field, value)
    if job.approved_at is not None:
        invalidate_final_approval(job)
        add_activity(db, access, "elongation.final.invalidated", "elongation_job", job.id)
    elif job.theory_approved_at is not None:
        job.workflow_status = "measurement_review"
        job.status = "review_required"
    add_activity(
        db,
        access,
        "elongation.measurement.updated",
        "elongation_measurement",
        measurement.id,
        {"previous": json_safe(previous_values), "next": json_safe(changes)},
    )
    await commit_or_conflict(db, "No fue posible actualizar la medición")
    await db.refresh(measurement)
    return _measurement_response(job, item, measurement)


@router.post(
    "/projects/{project_id}/elongation-jobs/{job_id}/approve-final",
    response_model=ElongationJobV2Response,
)
async def approve_elongation_final(
    project_id: str, job_id: str, access: CurrentCompanyAccess, db: DbSession
) -> ElongationJobV2Response:
    require_document_approver(access)
    job = await require_job(db, access.company_id, project_id, job_id)
    items, measurements, files, _ = await load_job_data(db, job)
    progress = progress_for(job, items, measurements, files)
    if not progress["can_approve_final"]:
        raise HTTPException(status_code=422, detail={"blockers": progress["approval_blockers"]})
    job.approved_by_user_id = access.user.id
    job.approved_at = utcnow()
    job.workflow_status = "approved"
    job.status = "approved"
    add_activity(db, access, "elongation.final.approved", "elongation_job", job.id)
    await commit_or_conflict(db, "No fue posible aprobar el resultado final")
    return await response_for_job(db, job)


@router.get("/projects/{project_id}/elongation-jobs/{job_id}/files/{file_id}")
async def download_elongation_file(
    project_id: str,
    job_id: str,
    file_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> FileResponse:
    job = await require_job(db, access.company_id, project_id, job_id)
    file = await db.scalar(
        select(ElongationJobFile).where(
            ElongationJobFile.id == file_id, ElongationJobFile.job_id == job.id
        )
    )
    if file is None:
        raise HTTPException(status_code=404, detail="Archivo del trabajo no encontrado")
    path = storage_path(file.storage_key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="El archivo ya no está disponible")
    return FileResponse(path, media_type=file.mime_type, filename=file.original_filename)


@router.get("/projects/{project_id}/elongation-jobs/{job_id}/files/{file_id}/preview")
async def preview_elongation_file(
    project_id: str,
    job_id: str,
    file_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    page: int = 1,
) -> Response:
    """Return an authenticated image preview for geometry review, never a public URL."""

    if page < 1 or page > 25:
        raise HTTPException(status_code=422, detail="La página de vista previa no es válida")
    job = await require_job(db, access.company_id, project_id, job_id)
    file = await db.scalar(
        select(ElongationJobFile).where(
            ElongationJobFile.id == file_id,
            ElongationJobFile.job_id == job.id,
        )
    )
    if file is None:
        raise HTTPException(status_code=404, detail="Archivo del trabajo no encontrado")
    if file.mime_type not in DOCUMENT_MIME_TYPES:
        raise HTTPException(status_code=422, detail="El archivo no admite vista previa de plano")
    path = storage_path(file.storage_key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="El archivo ya no está disponible")
    try:
        content = await run_in_threadpool(_preview_png, path, file.mime_type, page)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=60"},
    )


async def _export_response(
    db: DbSession,
    job: ElongationJob,
    *,
    kind: str,
    user_id: str,
) -> FileResponse:
    export, file = await create_export(db, job, kind=kind, created_by_user_id=user_id)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    path = storage_path(file.storage_key)
    if not path.is_file():
        raise HTTPException(status_code=500, detail="El Excel exportado no quedó disponible")
    return FileResponse(path, media_type=file.mime_type, filename=file.original_filename)


@router.get("/projects/{project_id}/elongation-jobs/{job_id}/exports/theoretical")
async def download_theoretical_export(
    project_id: str, job_id: str, access: CurrentCompanyAccess, db: DbSession
) -> FileResponse:
    job = await require_job(db, access.company_id, project_id, job_id)
    if job.theory_approved_at is None:
        raise HTTPException(status_code=422, detail="La teoría debe aprobarse antes de exportar")
    return await _export_response(db, job, kind="theoretical", user_id=access.user.id)


@router.get("/projects/{project_id}/elongation-jobs/{job_id}/exports/final")
async def download_final_export(
    project_id: str, job_id: str, access: CurrentCompanyAccess, db: DbSession
) -> FileResponse:
    job = await require_job(db, access.company_id, project_id, job_id)
    if job.approved_at is None:
        raise HTTPException(
            status_code=422,
            detail="El resultado final debe aprobarse antes de exportar",
        )
    return await _export_response(db, job, kind="final", user_id=access.user.id)
