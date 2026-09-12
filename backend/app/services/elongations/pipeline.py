"""Retryable in-process pipeline for V2 elongation jobs.

The queue boundary is deliberately small: FastAPI BackgroundTasks invokes these functions today;
later a durable worker can call the same ``process_*`` entrypoints with no route changes.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    ActivityLog,
    ElongationExport,
    ElongationItem,
    ElongationJob,
    ElongationJobFile,
    ElongationMeasurement,
    Project,
)
from app.db.session import SessionLocal
from app.services.elongations.classification import propose_classifications
from app.services.elongations.measurements import (
    expand_measurement_slots,
    tolerance_status,
)
from app.services.elongations.template import TemplateMapping, build_export_xlsx
from app.services.elongations.theory import extract_theory, natural_label_key
from app.services.file_storage import XLSX_MIME_TYPES, storage_path, store_bytes

PROCESSING_LIMIT = asyncio.Semaphore(2)
DOCUMENT_APPROVER_ROLES = {"owner", "admin", "engineer"}
THEORY_RECOVERY_STATUSES = {"queued_theory", "processing_theory"}
# Bump only when the XLSX rendering contract changes.  Legacy exports are regenerated once while
# retaining their source-data version and the prior file record for audit history.
EXPORT_RENDER_REVISION = 4


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def json_safe(value: Any) -> Any:
    """Convert persisted JSON snapshots without losing Decimal precision.

    SQLAlchemy's JSON encoder deliberately does not guess how a ``Decimal`` should be encoded.
    Keeping decimal values as strings preserves the source measurement exactly and makes a
    snapshot portable independently of the database driver.
    """

    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): json_safe(child) for key, child in value.items()}
    if isinstance(value, list | tuple):
        return [json_safe(child) for child in value]
    return value


def _export_needs_render_refresh(export: ElongationExport) -> bool:
    """Return whether a stored export predates the current XLSX rendering contract."""

    try:
        revision = int((export.snapshot_json or {}).get("render_revision", 1))
    except (TypeError, ValueError):
        revision = 1
    return revision < EXPORT_RENDER_REVISION


def _activity(
    session: AsyncSession, job: ElongationJob, action: str, metadata: dict[str, Any]
) -> None:
    session.add(
        ActivityLog(
            company_id=job.company_id,
            user_id=job.created_by_user_id,
            action=action,
            entity_type="elongation_job",
            entity_id=job.id,
            metadata_json=metadata,
        )
    )


async def _job_file(
    session: AsyncSession, job_id: str, kind: str, file_id: str | None = None
) -> ElongationJobFile | None:
    query = select(ElongationJobFile).where(
        ElongationJobFile.job_id == job_id, ElongationJobFile.kind == kind
    )
    if file_id:
        query = query.where(ElongationJobFile.id == file_id)
    return await session.scalar(query.order_by(ElongationJobFile.version_number.desc()))


async def ensure_measurement_slots(
    session: AsyncSession, item: ElongationItem, *, job_id: str | None = None
) -> list[ElongationMeasurement]:
    existing = list(
        (
            await session.execute(
                select(ElongationMeasurement)
                .where(ElongationMeasurement.item_id == item.id)
                .order_by(ElongationMeasurement.ordinal)
            )
        ).scalars()
    )
    existing_by_ordinal = {measurement.ordinal: measurement for measurement in existing}
    tail = [
        measurement
        for ordinal, measurement in existing_by_ordinal.items()
        if ordinal > item.strand_count
    ]
    if any(measurement.measured_elongation is not None for measurement in tail):
        raise ValueError("No se puede reducir S porque existen mediciones físicas adicionales")
    for measurement in tail:
        await session.delete(measurement)
        existing.remove(measurement)
        existing_by_ordinal.pop(measurement.ordinal, None)
    created: list[ElongationMeasurement] = []
    for ordinal in range(1, item.strand_count + 1):
        if ordinal not in existing_by_ordinal:
            measurement = ElongationMeasurement(
                job_id=job_id or item.job_id,
                item_id=item.id,
                ordinal=ordinal,
                review_status="pending",
            )
            session.add(measurement)
            created.append(measurement)
    await session.flush()
    return sorted([*existing, *created], key=lambda measurement: measurement.ordinal)


def _mapping_from_json(data: dict[str, Any]) -> TemplateMapping:
    from app.services.elongations.template import TemplateSection

    return TemplateMapping(
        sheet_name=data["sheet_name"],
        sections={key: TemplateSection(**value) for key, value in data["sections"].items()},
        columns={key: int(value) for key, value in data["columns"].items()},
        formula_seeds=dict(data["formula_seeds"]),
        tolerance_percent=Decimal(str(data["tolerance_percent"])),
        warnings=tuple(data.get("warnings") or []),
    )


async def resume_interrupted_theory_jobs() -> list[asyncio.Task[None]]:
    """Resume persisted theory jobs after an API restart.

    ``BackgroundTasks`` is intentionally lightweight, so a process restart can
    happen after the job is committed but before its OCR coroutine runs.  The
    job record is the durable queue: interrupted ``processing_theory`` jobs are
    returned to ``queued_theory`` and every queued job is scheduled again.
    ``process_theory_job`` claims a queued job atomically, so this recovery
    cannot make duplicate readers work on the same job.
    """

    async with SessionLocal() as session:
        job_ids = list(
            (
                await session.scalars(
                    select(ElongationJob.id)
                    .where(ElongationJob.workflow_status.in_(THEORY_RECOVERY_STATUSES))
                    .order_by(ElongationJob.created_at)
                )
            ).all()
        )
        if not job_ids:
            return []
        await session.execute(
            update(ElongationJob)
            .where(
                ElongationJob.id.in_(job_ids),
                ElongationJob.workflow_status == "processing_theory",
            )
            .values(workflow_status="queued_theory", status="queued_theory")
        )
        await session.commit()
    return [asyncio.create_task(process_theory_job(job_id)) for job_id in job_ids]


async def process_theory_job(job_id: str) -> None:
    """Extract semantic theory in a new session so the HTTP request never waits for OCR."""

    async with PROCESSING_LIMIT:
        async with SessionLocal() as session:
            claim = await session.execute(
                update(ElongationJob)
                .where(
                    ElongationJob.id == job_id,
                    ElongationJob.workflow_status == "queued_theory",
                )
                .values(
                    workflow_status="processing_theory",
                    status="processing",
                    error_message=None,
                )
            )
            if claim.rowcount != 1:
                return
            job = await session.get(ElongationJob, job_id)
            if job is None:
                return
            source = await _job_file(session, job.id, "plan")
            if source is None:
                job.workflow_status = "failed_theory"
                job.status = "failed"
                job.error_message = "No se encontró el plano fuente para procesar"
                await session.commit()
                return
            _activity(session, job, "elongation.theory.started", {"file_id": source.id})
            await session.commit()
            try:
                extraction = await run_in_threadpool(
                    extract_theory,
                    storage_path(source.storage_key),
                    source.mime_type,
                )
                existing_items = {
                    item.label: item
                    for item in (
                        await session.scalars(
                            select(ElongationItem).where(ElongationItem.job_id == job.id)
                        )
                    ).all()
                }
                ordered_candidates = sorted(
                    extraction.candidates, key=lambda value: natural_label_key(value.label)
                )
                geometry_proposals = propose_classifications(ordered_candidates)
                for sort_order, candidate in enumerate(ordered_candidates, start=1):
                    existing = existing_items.get(candidate.label)
                    if existing is not None:
                        # Re-reading enriches a job; never deletes measurements, manual edits,
                        # review evidence or classification zones from an earlier version.
                        changed = (
                            existing.strand_count,
                            existing.length_m,
                            existing.calculated_elongation,
                        ) != candidate.values_key()
                        if changed or candidate.conflict:
                            existing.theory_review_status = "conflict"
                            existing.field_confidence_json = {
                                **(existing.field_confidence_json or {}),
                                "reread_candidate": {
                                    "strand_count": candidate.strand_count,
                                    "length_m": str(candidate.length_m),
                                    "calculated_elongation_cm": str(
                                        candidate.calculated_elongation_cm
                                    ),
                                    "source": candidate.source_location(),
                                },
                            }
                        continue
                    proposal = geometry_proposals[candidate.label]
                    item = ElongationItem(
                        job_id=job.id,
                        label=candidate.label,
                        label_number=candidate.label_number,
                        raw_label=candidate.raw_label,
                        raw_text=candidate.raw_text,
                        sort_order=sort_order,
                        classification=proposal.classification,
                        length_m=candidate.length_m,
                        strand_count=candidate.strand_count,
                        calculated_elongation=candidate.calculated_elongation_cm,
                        confidence=candidate.confidence,
                        review_status="pending",
                        theory_review_status="conflict" if candidate.conflict else "pending",
                        field_confidence_json={
                            **candidate.field_confidence_json(),
                            "alternatives": list(candidate.alternatives),
                            "classification_proposal": proposal.to_dict(),
                        },
                        source_file_id=source.id,
                        source_page=candidate.page,
                        source_location_json=candidate.source_location(),
                    )
                    session.add(item)
                    await session.flush()
                    await ensure_measurement_slots(session, item, job_id=job.id)
                source.page_count = extraction.page_count or source.page_count
                source.processing_status = "processed"
                source.processing_summary_json = {
                    "engine": extraction.engine,
                    "candidates": len(extraction.candidates),
                    "warnings": list(extraction.warnings),
                }
                job.extracted_text = extraction.extracted_text
                job.workflow_status = "theory_review"
                job.status = "review_required"
                job.completed_at = utcnow()
                job.processing_summary_json = {
                    "theory_engine": extraction.engine,
                    "groups_detected": len(extraction.candidates),
                    "warnings": list(extraction.warnings),
                }
                if not extraction.candidates:
                    job.error_message = (
                        "No se detectaron bloques completos Tendon/S/L/Elong; "
                        "revise o cargue datos."
                    )
                _activity(
                    session,
                    job,
                    "elongation.theory.completed",
                    {"groups_detected": len(extraction.candidates), "engine": extraction.engine},
                )
                await session.commit()
            except Exception as exc:  # noqa: BLE001 - job must preserve an actionable failure
                await session.rollback()
                job = await session.get(ElongationJob, job_id)
                if job is not None:
                    job.workflow_status = "failed_theory"
                    job.status = "failed"
                    job.error_message = str(exc)[:500]
                    job.completed_at = utcnow()
                    _activity(session, job, "elongation.theory.failed", {"error": str(exc)[:500]})
                    await session.commit()


async def resume_interrupted_measurement_jobs() -> list[asyncio.Task[None]]:
    async with SessionLocal() as session:
        job_ids = list(
            (
                await session.scalars(
                    select(ElongationJob.id).where(
                        ElongationJob.workflow_status.in_(
                            {"queued_measurements", "processing_measurements"}
                        )
                    )
                )
            ).all()
        )
        tasks = []
        for job_id in job_ids:
            file_ids = list(
                (
                    await session.scalars(
                        select(ElongationJobFile.id).where(
                            ElongationJobFile.job_id == job_id,
                            ElongationJobFile.kind == "measurement_scan",
                            ElongationJobFile.processing_status != "processed",
                        )
                    )
                ).all()
            )
            if not file_ids:
                await session.execute(
                    update(ElongationJob)
                    .where(ElongationJob.id == job_id)
                    .values(workflow_status="measurement_review", status="review_required")
                )
                continue
            await session.execute(
                update(ElongationJob)
                .where(ElongationJob.id == job_id)
                .values(workflow_status="queued_measurements", status="queued_measurements")
            )
            tasks.append((job_id, file_ids))
        await session.commit()
    return [
        asyncio.create_task(process_measurement_files(job_id, file_ids))
        for job_id, file_ids in tasks
    ]


async def process_measurement_files(job_id: str, file_ids: list[str]) -> None:
    """Read each uploaded scan and keep missing/excess values reviewable."""

    async with PROCESSING_LIMIT:
        async with SessionLocal() as session:
            claim = await session.execute(
                update(ElongationJob)
                .where(
                    ElongationJob.id == job_id,
                    ElongationJob.workflow_status == "queued_measurements",
                )
                .values(workflow_status="processing_measurements", status="processing")
            )
            if claim.rowcount != 1:
                return
            job = await session.get(ElongationJob, job_id)
            if job is None:
                return
            files = list(
                (
                    await session.execute(
                        select(ElongationJobFile).where(
                            ElongationJobFile.job_id == job.id,
                            ElongationJobFile.id.in_(file_ids),
                            ElongationJobFile.kind == "measurement_scan",
                        )
                    )
                ).scalars()
            )
            if not files:
                return
            job.workflow_status = "processing_measurements"
            job.status = "processing"
            _activity(session, job, "elongation.measurements.started", {"file_ids": file_ids})
            await session.commit()
            items = list(
                (
                    await session.execute(
                        select(ElongationItem)
                        .where(ElongationItem.job_id == job.id)
                        .order_by(ElongationItem.label_number)
                    )
                ).scalars()
            )
            by_label = {item.label: item for item in items}
            all_warnings: list[str] = []
            try:
                for source in files:
                    from app.services.elongations.readings import extract_measurements

                    extraction = await run_in_threadpool(
                        extract_measurements,
                        storage_path(source.storage_key),
                        source.mime_type,
                    )
                    summary: dict[str, Any] = {
                        "engine": extraction.engine,
                        "anchors": 0,
                        "unmatched_labels": [],
                        "extras": {},
                        "conflicts": [],
                        "unassigned": [],
                        "warnings": list(extraction.warnings),
                    }
                    warning_start = len(all_warnings)
                    all_warnings.extend(extraction.warnings)
                    for group in extraction.groups:
                        label, raw_text, values = group.label, group.raw_text, list(group.values)
                        summary["anchors"] += 1
                        if label is None:
                            summary["unassigned"].append(
                                {
                                    "raw_text": raw_text,
                                    "page": group.page,
                                    "bbox": group.bbox,
                                    "values": [str(v) if v is not None else None for v in values],
                                }
                            )
                            continue
                        item = by_label.get(label)
                        if item is None:
                            summary["unmatched_labels"].append(label)
                            summary["unassigned"].append(
                                {
                                    "label": label,
                                    "raw_text": raw_text,
                                    "page": group.page,
                                    "bbox": group.bbox,
                                    "values": [str(v) if v is not None else None for v in values],
                                }
                            )
                            continue
                        slots, extras = expand_measurement_slots(item.strand_count, values)
                        if extras:
                            summary["extras"][label] = [
                                str(value) if value is not None else None for value in extras
                            ]
                            all_warnings.append(f"{label} tiene {len(extras)} valores sobrantes")
                        item_measurements = await ensure_measurement_slots(
                            session, item, job_id=job.id
                        )
                        existing = {
                            measurement.ordinal: measurement for measurement in item_measurements
                        }
                        if len(values) != item.strand_count:
                            all_warnings.append(
                                f"{label} detectó {len(values)} lecturas para S={item.strand_count}"
                            )
                        for slot in slots:
                            if slot.measured_elongation_cm is None:
                                continue
                            measurement = existing[slot.ordinal]
                            if (
                                measurement.match_method == "manual"
                                or measurement.review_status == "approved"
                            ):
                                # Preserve signed/manual values; a different read is shown as an
                                # alternative rather than silently replacing the technician.
                                if measurement.measured_elongation != slot.measured_elongation_cm:
                                    summary["conflicts"].append(
                                        {
                                            "label": label,
                                            "ordinal": slot.ordinal,
                                            "candidate": str(slot.measured_elongation_cm),
                                        }
                                    )
                                continue
                            if (
                                measurement.measured_elongation is not None
                                and measurement.measured_elongation != slot.measured_elongation_cm
                            ):
                                measurement.review_status = "conflict"
                                summary["conflicts"].append(
                                    {
                                        "label": label,
                                        "ordinal": slot.ordinal,
                                        "existing": str(measurement.measured_elongation),
                                        "candidate": str(slot.measured_elongation_cm),
                                    }
                                )
                                continue
                            measurement.measured_elongation = slot.measured_elongation_cm
                            measurement.raw_text = raw_text
                            measurement.confidence = (
                                Decimal("0.5000") if group.uncertain else Decimal("0.8500")
                            )
                            measurement.match_method = (
                                "spatial"
                                if extraction.engine.startswith("openai")
                                else "label_anchor"
                            )
                            measurement.review_status = "conflict" if group.uncertain else "pending"
                            measurement.source_file_id = source.id
                            measurement.source_page = group.page
                            measurement.source_location_json = {
                                "file": source.original_filename,
                                "bbox": group.bbox,
                            }
                    if not extraction.groups:
                        all_warnings.append(
                            "No se detectaron mediciones; revise el motor de lectura y el escaneo"
                        )
                    summary["warnings"] = list(dict.fromkeys(all_warnings[warning_start:]))
                    source.processing_status = "processed"
                    source.processing_summary_json = summary
                    source.error_message = None
                    source.page_count = extraction.page_count
                job.workflow_status = "measurement_review"
                job.status = "review_required"
                job.error_message = None
                job.processing_summary_json = {
                    **(job.processing_summary_json or {}),
                    "measurement_warnings": all_warnings,
                }
                _activity(
                    session,
                    job,
                    "elongation.measurements.completed",
                    {"warnings": all_warnings},
                )
                await session.commit()
            except Exception as exc:  # noqa: BLE001
                await session.rollback()
                job = await session.get(ElongationJob, job_id)
                if job is not None:
                    job.workflow_status = "failed_measurements"
                    job.status = "failed"
                    job.error_message = str(exc)[:500]
                    _activity(
                        session,
                        job,
                        "elongation.measurements.failed",
                        {"error": str(exc)[:500]},
                    )
                    await session.commit()


def invalidate_approvals(job: ElongationJob) -> None:
    """Leave immutable past exports intact while new changes require a new version approval."""

    job.theory_approved_by_user_id = None
    job.theory_approved_at = None
    job.approved_by_user_id = None
    job.approved_at = None
    job.version_number += 1
    job.workflow_status = "theory_review"
    job.status = "review_required"


def invalidate_final_approval(job: ElongationJob) -> None:
    """Invalidate only the final result after a physical measurement correction.

    The validated theoretical source stays valid; the next export receives a new logical version
    and must pass final approval again.
    """

    job.approved_by_user_id = None
    job.approved_at = None
    job.version_number += 1
    job.workflow_status = "measurement_review"
    job.status = "review_required"


async def invalidate_measurement_reviews(session: AsyncSession, job_id: str) -> None:
    """Keep readings traceable but require technical review after theory changes."""

    await session.execute(
        update(ElongationMeasurement)
        .where(ElongationMeasurement.job_id == job_id)
        .values(
            review_status="pending",
            reviewed_by_user_id=None,
            reviewed_at=None,
        )
    )


def progress_for(
    job: ElongationJob,
    items: list[ElongationItem],
    measurements: list[ElongationMeasurement],
    files: list[ElongationJobFile],
) -> dict[str, Any]:
    """Compute all approval gates with Decimal-derived tolerance and readable reasons."""

    by_item: dict[str, list[ElongationMeasurement]] = {}
    for measurement in measurements:
        by_item.setdefault(measurement.item_id, []).append(measurement)
    groups_pending = sum(
        item.classification == "unknown" or item.theory_review_status != "approved"
        for item in items
    )
    expected = sum(item.strand_count for item in items)
    detected = sum(measurement.measured_elongation is not None for measurement in measurements)
    measurement_pending = 0
    outside = 0
    conflicts = 0
    for item in items:
        item_measurements = by_item.get(item.id, [])
        if len(item_measurements) != item.strand_count:
            conflicts += 1
        for measurement in item_measurements:
            unresolved = measurement.review_status == "conflict"
            state = tolerance_status(
                item.calculated_elongation,
                measurement.measured_elongation,
                job.tolerance_percent,
                unresolved=unresolved,
            )
            requires_review = (
                state in {"missing", "unresolved"} or measurement.review_status != "approved"
            )
            if state == "outside":
                outside += 1
                if not measurement.override_reason:
                    requires_review = True
            if requires_review:
                measurement_pending += 1
            if unresolved:
                conflicts += 1
    for source in files:
        summary = source.processing_summary_json or {}
        if summary.get("review_resolved"):
            continue
        conflicts += len(summary.get("unmatched_labels") or [])
        conflicts += sum(len(values) for values in (summary.get("extras") or {}).values())
        conflicts += len(summary.get("conflicts") or [])
        conflicts += len(summary.get("unassigned") or [])
    theory_blockers: list[str] = []
    if not items:
        theory_blockers.append("No hay grupos teóricos completos")
    if any(item.classification == "unknown" for item in items):
        theory_blockers.append("Hay grupos sin clasificar")
    if any(item.theory_review_status != "approved" for item in items):
        theory_blockers.append("Hay teoría pendiente de revisión")
    if any(item.theory_review_status == "conflict" for item in items):
        theory_blockers.append("Hay conflictos teóricos")
    final_blockers = list(theory_blockers)
    if job.theory_approved_at is None:
        final_blockers.append("Primero debe aprobarse la teoría")
    if expected != detected:
        final_blockers.append(f"Faltan o sobran mediciones: {detected}/{expected}")
    if measurement_pending:
        final_blockers.append("Hay mediciones pendientes de revisión o justificación")
    if conflicts:
        final_blockers.append("Hay conflictos o lecturas sobrantes sin resolver")
    return {
        "groups_total": len(items),
        "groups_pending": groups_pending,
        "measurements_expected": expected,
        "measurements_detected": detected,
        "measurements_pending": measurement_pending,
        "outside_tolerance": outside,
        "unresolved_conflicts": conflicts,
        "can_approve_theory": not theory_blockers,
        "can_approve_final": not final_blockers,
        "approval_blockers": final_blockers if job.theory_approved_at else theory_blockers,
    }


async def groups_for_export(
    session: AsyncSession, job: ElongationJob
) -> tuple[list[dict[str, Any]], list[ElongationItem], list[ElongationMeasurement]]:
    items = list(
        (
            await session.execute(
                select(ElongationItem)
                .where(ElongationItem.job_id == job.id)
                .order_by(ElongationItem.label_number, ElongationItem.label)
            )
        ).scalars()
    )
    measurements = list(
        (
            await session.execute(
                select(ElongationMeasurement)
                .where(ElongationMeasurement.job_id == job.id)
                .order_by(ElongationMeasurement.item_id, ElongationMeasurement.ordinal)
            )
        ).scalars()
    )
    by_item: dict[str, list[ElongationMeasurement]] = {}
    for measurement in measurements:
        by_item.setdefault(measurement.item_id, []).append(measurement)
    groups: list[dict[str, Any]] = []
    for item in items:
        group_measurements: list[dict[str, Any]] = []
        for measurement in by_item.get(item.id, []):
            group_measurements.append(
                {
                    "ordinal": measurement.ordinal,
                    "measured_elongation": measurement.measured_elongation,
                    "confidence": measurement.confidence,
                    "match_method": measurement.match_method,
                    "review_status": measurement.review_status,
                    "override_reason": measurement.override_reason,
                    "source_location_json": measurement.source_location_json,
                    "tolerance_status": tolerance_status(
                        item.calculated_elongation,
                        measurement.measured_elongation,
                        job.tolerance_percent,
                        unresolved=measurement.review_status == "conflict",
                    ),
                }
            )
        groups.append(
            {
                "label": item.label,
                "label_number": item.label_number,
                "classification": item.classification,
                "length_m": item.length_m,
                "strand_count": item.strand_count,
                "calculated_elongation": item.calculated_elongation,
                "measurements": group_measurements,
            }
        )
    return groups, items, measurements


async def create_export(
    session: AsyncSession,
    job: ElongationJob,
    *,
    kind: str,
    created_by_user_id: str,
) -> tuple[ElongationExport, ElongationJobFile]:
    """Create one immutable XLSX version and persist its real SHA-256 alongside the snapshot."""

    existing = await session.scalar(
        select(ElongationExport)
        .where(
            ElongationExport.job_id == job.id,
            ElongationExport.kind == kind,
            ElongationExport.version_number == job.version_number,
        )
        .order_by(ElongationExport.created_at.desc())
    )
    previous_file_id: str | None = None
    if existing is not None:
        file = await session.get(ElongationJobFile, existing.file_id)
        if file is not None and not _export_needs_render_refresh(existing):
            return existing, file
        previous_file_id = existing.file_id
    template = await _job_file(session, job.id, "template")
    if template is None or not job.template_mapping_json:
        raise ValueError("El trabajo no tiene una plantilla V2 válida")
    project = await session.get(Project, job.project_id)
    groups, _, _ = await groups_for_export(session, job)
    mapping = _mapping_from_json(job.template_mapping_json)
    source_hashes = [
        file.sha256
        for file in list(
            (
                await session.execute(
                    select(ElongationJobFile)
                    .where(ElongationJobFile.job_id == job.id)
                    .order_by(ElongationJobFile.created_at, ElongationJobFile.id)
                )
            ).scalars()
        )
        if file.kind in {"plan", "template", "measurement_scan"}
    ]
    template_content = await run_in_threadpool(storage_path(template.storage_key).read_bytes)
    content = await run_in_threadpool(
        build_export_xlsx,
        template_content,
        mapping,
        groups,
        final=kind == "final",
        project_name=project.name if project is not None else None,
        history={
            "job_title": job.title,
            "version_number": job.version_number,
            "kind": kind,
            "created_at": utcnow().isoformat(),
            "created_by": created_by_user_id,
            "source_hashes": ", ".join(source_hashes),
            "output_sha256": "Registrado en Obrixapy",
        },
    )
    filename = f"elongaciones-{kind}-v{job.version_number}-{job.id[:8]}.xlsx"
    stored = await store_bytes(
        content,
        filename,
        next(iter(XLSX_MIME_TYPES)),
        "companies",
        job.company_id,
        "projects",
        job.project_id,
        "elongation-jobs",
        job.id,
        "exports",
    )
    version_number = (
        await session.scalar(
            select(func.coalesce(func.max(ElongationJobFile.version_number), 0)).where(
                ElongationJobFile.job_id == job.id,
                ElongationJobFile.kind == f"{kind}_export",
            )
        )
        or 0
    ) + 1
    file = ElongationJobFile(
        job_id=job.id,
        kind=f"{kind}_export",
        version_number=version_number,
        storage_key=stored.storage_key,
        original_filename=stored.original_filename,
        mime_type=stored.mime_type,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        processing_status="completed",
        uploaded_by_user_id=created_by_user_id,
    )
    session.add(file)
    await session.flush()
    snapshot = {
        "job_version": job.version_number,
        "kind": kind,
        "render_revision": EXPORT_RENDER_REVISION,
        "source_hashes": source_hashes,
        "output_sha256": stored.sha256,
        "groups": json_safe(groups),
    }
    if previous_file_id is not None:
        snapshot["superseded_file_id"] = previous_file_id
    if existing is None:
        export = ElongationExport(
            job_id=job.id,
            file_id=file.id,
            kind=kind,
            version_number=job.version_number,
            snapshot_json=snapshot,
            created_by_user_id=created_by_user_id,
        )
        session.add(export)
    else:
        export = existing
        export.file_id = file.id
        export.snapshot_json = snapshot
    if kind == "final":
        job.workflow_status = "exported"
    export_activity = "elongation.export.created"
    if previous_file_id is not None:
        export_activity = "elongation.export.refreshed"
    _activity(
        session,
        job,
        export_activity,
        {
            "kind": kind,
            "version": job.version_number,
            "render_revision": EXPORT_RENDER_REVISION,
            "sha256": stored.sha256,
        },
    )
    return export, file
