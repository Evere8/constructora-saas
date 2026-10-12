"""Project rubros and the interactive Perforaciones canvas.

The routes intentionally keep point coordinates normalized.  A point therefore
remains in the same place when a tablet changes orientation or a PDF is viewed
at a different zoom level.
"""

from __future__ import annotations

import re
import subprocess
import unicodedata
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
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
from app.api.routes.plans import preview_png
from app.api.schemas.rubros import (
    PerforationChecklistPatch,
    PerforationColorCreate,
    PerforationColorPatch,
    PerforationColorResponse,
    PerforationDocumentResponse,
    PerforationPointCreate,
    PerforationPointPatch,
    PerforationPointResponse,
    PerforationWorkspaceResponse,
    ProjectRubroCreate,
    ProjectRubroFeatureResponse,
    ProjectRubroFeatureSet,
    ProjectRubroObservationCreate,
    ProjectRubroObservationResponse,
    ProjectRubroPatch,
    ProjectRubroResponse,
    ProjectRubroSummary,
)
from app.core.config import get_settings
from app.db.models import (
    PerforationColor,
    PerforationDocument,
    PerforationPoint,
    ProjectRubro,
    ProjectRubroFeature,
    ProjectRubroObservation,
    Task,
)
from app.services.file_storage import remove_stored_file, storage_path, store_upload

router = APIRouter()

FEATURE_ORDER = {
    "postensado_documentation": 1,
    "interactive_pdf": 2,
    "tasks": 3,
    "checklists": 4,
    "observations": 5,
}

DEFAULT_RUBROS: tuple[tuple[str, str, str, tuple[str, ...]], ...] = (
    (
        "postensado",
        "Postensado",
        "Control técnico de elongaciones, lecturas y conciliación.",
        ("postensado_documentation", "tasks", "observations"),
    ),
    (
        "gerenciamiento",
        "Gerenciamiento",
        "Seguimiento de hitos, responsables y observaciones de obra.",
        ("tasks", "checklists", "observations"),
    ),
    (
        "reparaciones-refuerzos",
        "Reparaciones/Refuerzos",
        "Control de intervenciones, checklist y evidencias.",
        ("interactive_pdf", "tasks", "checklists", "observations"),
    ),
    (
        "diseno-estructural",
        "Diseño estructural",
        "Planos, decisiones de diseño y tareas técnicas.",
        ("interactive_pdf", "tasks", "observations"),
    ),
    (
        "perforaciones",
        "Perforaciones",
        "Puntos de perforación, checklist y notas directamente sobre el plano.",
        ("interactive_pdf", "tasks", "checklists", "observations"),
    ),
)

DEFAULT_PERFORATION_COLORS = (
    (
        "Perforado sin cortar cabos",
        "#4ade80",
        (
            ("perforado", "Perforado"),
            ("verificado", "Verificar punto"),
        ),
    ),
    (
        "Perforado y corte de cabos",
        "#ef4444",
        (
            ("perforado", "Perforado"),
            ("corte", "Corte de cabos"),
            ("verificado", "Verificar punto"),
        ),
    ),
    (
        "Reparado",
        "#60a5fa",
        (
            ("reparacion", "Reparación realizada"),
            ("verificado", "Verificar terminación"),
        ),
    ),
)


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", normalized.lower()).strip("-")
    return normalized[:65] or "rubro"


def checklist_snapshot(entries: list | tuple) -> list[dict]:
    """Copy configurable entries and make every point own its check state."""

    result: list[dict] = []
    for index, entry in enumerate(entries):
        if isinstance(entry, dict):
            title = str(entry.get("title") or "").strip()
            key = str(entry.get("id") or "").strip()
        elif hasattr(entry, "title"):
            title = str(entry.title).strip()
            key = str(getattr(entry, "id", "")).strip()
        else:
            title = str(entry).strip()
            key = ""
        if not title:
            continue
        result.append(
            {"id": key or f"step-{index + 1}-{uuid4().hex[:8]}", "title": title, "checked": False}
        )
    return result


def point_status(checklist: list) -> str:
    if not checklist:
        return "pending"
    return (
        "completed"
        if all(bool(item.get("checked")) for item in checklist if isinstance(item, dict))
        else "pending"
    )


async def ensure_default_rubros(
    db: DbSession,
    company_id: str,
    project_id: str,
) -> None:
    """Seed only missing built-ins, preserving every user-created rubro."""

    existing = set(
        (
            await db.scalars(select(ProjectRubro.slug).where(ProjectRubro.project_id == project_id))
        ).all()
    )
    created: list[ProjectRubro] = []
    for order, (slug, name, description, _features) in enumerate(DEFAULT_RUBROS, start=1):
        if slug in existing:
            continue
        rubro = ProjectRubro(
            company_id=company_id,
            project_id=project_id,
            slug=slug,
            name=name,
            description=description,
            is_system=True,
            sort_order=order,
        )
        db.add(rubro)
        created.append(rubro)
    if not created:
        return
    await db.flush()
    for rubro, (_, _, _, features) in zip(
        created, (item for item in DEFAULT_RUBROS if item[0] not in existing), strict=False
    ):
        db.add_all(
            ProjectRubroFeature(
                rubro_id=rubro.id,
                feature_key=feature,
                sort_order=FEATURE_ORDER[feature],
            )
            for feature in features
        )
    await db.commit()


async def require_rubro(
    db: DbSession,
    company_id: str,
    project_id: str,
    rubro_id: str,
) -> ProjectRubro:
    rubro = await db.scalar(
        select(ProjectRubro).where(
            ProjectRubro.id == rubro_id,
            ProjectRubro.company_id == company_id,
            ProjectRubro.project_id == project_id,
        )
    )
    if rubro is None:
        raise HTTPException(status_code=404, detail="Rubro no encontrado")
    return rubro


async def rubro_features(db: DbSession, rubro_id: str) -> list[ProjectRubroFeature]:
    return list(
        (
            await db.execute(
                select(ProjectRubroFeature)
                .where(ProjectRubroFeature.rubro_id == rubro_id)
                .order_by(ProjectRubroFeature.sort_order, ProjectRubroFeature.feature_key)
            )
        ).scalars()
    )


async def rubro_response(db: DbSession, rubro: ProjectRubro) -> ProjectRubroResponse:
    features = await rubro_features(db, rubro.id)
    tasks_total = (
        await db.scalar(select(func.count()).select_from(Task).where(Task.rubro_id == rubro.id))
        or 0
    )
    tasks_completed = (
        await db.scalar(
            select(func.count())
            .select_from(Task)
            .where(Task.rubro_id == rubro.id, Task.status == "completed")
        )
        or 0
    )
    documents_total = (
        await db.scalar(
            select(func.count())
            .select_from(PerforationDocument)
            .where(PerforationDocument.rubro_id == rubro.id)
        )
        or 0
    )
    points_total = (
        await db.scalar(
            select(func.count())
            .select_from(PerforationPoint)
            .where(PerforationPoint.rubro_id == rubro.id)
        )
        or 0
    )
    points_completed = (
        await db.scalar(
            select(func.count())
            .select_from(PerforationPoint)
            .where(
                PerforationPoint.rubro_id == rubro.id,
                PerforationPoint.status == "completed",
            )
        )
        or 0
    )
    payload = ProjectRubroResponse.model_validate(rubro)
    payload.features = [ProjectRubroFeatureResponse.model_validate(feature) for feature in features]
    payload.summary = ProjectRubroSummary(
        tasks_total=tasks_total,
        tasks_completed=tasks_completed,
        documents_total=documents_total,
        points_total=points_total,
        points_completed=points_completed,
    )
    return payload


async def require_interactive_pdf_feature(db: DbSession, rubro: ProjectRubro) -> None:
    enabled = await db.scalar(
        select(ProjectRubroFeature.id).where(
            ProjectRubroFeature.rubro_id == rubro.id,
            ProjectRubroFeature.feature_key == "interactive_pdf",
        )
    )
    if enabled is None:
        raise HTTPException(
            status_code=409,
            detail="Activa la función PDF interactivo en este rubro antes de cargar perforaciones",
        )


async def ensure_default_perforation_colors(db: DbSession, rubro: ProjectRubro) -> None:
    exists = await db.scalar(
        select(PerforationColor.id).where(PerforationColor.rubro_id == rubro.id).limit(1)
    )
    if exists is not None:
        return
    for order, (name, color_hex, steps) in enumerate(DEFAULT_PERFORATION_COLORS, start=1):
        db.add(
            PerforationColor(
                rubro_id=rubro.id,
                name=name,
                color_hex=color_hex,
                checklist_json=checklist_snapshot(
                    [{"id": step_id, "title": title} for step_id, title in steps]
                ),
                sort_order=order,
            )
        )
    await db.commit()


async def require_color(db: DbSession, rubro_id: str, color_id: str) -> PerforationColor:
    color = await db.scalar(
        select(PerforationColor).where(
            PerforationColor.id == color_id,
            PerforationColor.rubro_id == rubro_id,
        )
    )
    if color is None:
        raise HTTPException(status_code=422, detail="El color no pertenece a este rubro")
    return color


async def require_document(
    db: DbSession,
    company_id: str,
    project_id: str,
    rubro_id: str,
    document_id: str,
) -> PerforationDocument:
    document = await db.scalar(
        select(PerforationDocument).where(
            PerforationDocument.id == document_id,
            PerforationDocument.company_id == company_id,
            PerforationDocument.project_id == project_id,
            PerforationDocument.rubro_id == rubro_id,
        )
    )
    if document is None:
        raise HTTPException(status_code=404, detail="Plano de perforaciones no encontrado")
    return document


async def require_point(
    db: DbSession,
    company_id: str,
    project_id: str,
    rubro_id: str,
    point_id: str,
) -> PerforationPoint:
    point = await db.scalar(
        select(PerforationPoint).where(
            PerforationPoint.id == point_id,
            PerforationPoint.company_id == company_id,
            PerforationPoint.project_id == project_id,
            PerforationPoint.rubro_id == rubro_id,
        )
    )
    if point is None:
        raise HTTPException(status_code=404, detail="Punto de perforación no encontrado")
    return point


def page_count(path: Path, mime_type: str) -> int | None:
    if mime_type != "application/pdf":
        return 1
    try:
        result = subprocess.run(
            ["pdfinfo", str(path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    match = re.search(r"^Pages:\s+(\d+)$", result.stdout, flags=re.MULTILINE)
    return int(match.group(1)) if match else None


async def document_response(
    db: DbSession, document: PerforationDocument
) -> PerforationDocumentResponse:
    total = (
        await db.scalar(
            select(func.count())
            .select_from(PerforationPoint)
            .where(PerforationPoint.document_id == document.id)
        )
        or 0
    )
    complete = (
        await db.scalar(
            select(func.count())
            .select_from(PerforationPoint)
            .where(
                PerforationPoint.document_id == document.id,
                PerforationPoint.status == "completed",
            )
        )
        or 0
    )
    payload = PerforationDocumentResponse.model_validate(document)
    payload.points_total = total
    payload.points_completed = complete
    return payload


def color_response(color: PerforationColor) -> PerforationColorResponse:
    return PerforationColorResponse.model_validate(color)


def point_response(point: PerforationPoint) -> PerforationPointResponse:
    return PerforationPointResponse.model_validate(point)


@router.get("/projects/{project_id}/rubros", response_model=list[ProjectRubroResponse])
async def list_rubros(
    project_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> list[ProjectRubroResponse]:
    await require_project(db, access.company_id, project_id)
    await ensure_default_rubros(db, access.company_id, project_id)
    rubros = list(
        (
            await db.execute(
                select(ProjectRubro)
                .where(ProjectRubro.project_id == project_id)
                .order_by(ProjectRubro.sort_order, ProjectRubro.name)
            )
        ).scalars()
    )
    return [await rubro_response(db, rubro) for rubro in rubros]


@router.post(
    "/projects/{project_id}/rubros",
    response_model=ProjectRubroResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_rubro(
    project_id: str,
    payload: ProjectRubroCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ProjectRubroResponse:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    existing = set(
        (
            await db.scalars(select(ProjectRubro.slug).where(ProjectRubro.project_id == project_id))
        ).all()
    )
    base = slugify(payload.name)
    slug = base
    suffix = 2
    while slug in existing:
        slug = f"{base[: max(1, 75 - len(str(suffix)))]}-{suffix}"
        suffix += 1
    if "postensado_documentation" in payload.feature_keys:
        raise HTTPException(
            status_code=422,
            detail="La documentación de Postensado solo puede vivir dentro del rubro Postensado",
        )
    last_order = await db.scalar(
        select(func.max(ProjectRubro.sort_order)).where(ProjectRubro.project_id == project_id)
    )
    rubro = ProjectRubro(
        company_id=access.company_id,
        project_id=project_id,
        slug=slug,
        name=payload.name,
        description=payload.description,
        is_system=False,
        sort_order=(last_order or 0) + 1,
        created_by_user_id=access.user.id,
    )
    db.add(rubro)
    await flush_or_conflict(db, "Ya existe un rubro con ese nombre")
    for feature in sorted(set(payload.feature_keys), key=lambda key: FEATURE_ORDER[key]):
        db.add(
            ProjectRubroFeature(
                rubro_id=rubro.id,
                feature_key=feature,
                sort_order=FEATURE_ORDER[feature],
            )
        )
    add_activity(
        db, access, "project_rubro.created", "project_rubro", rubro.id, {"name": rubro.name}
    )
    await commit_or_conflict(db, "No fue posible crear el rubro")
    await db.refresh(rubro)
    return await rubro_response(db, rubro)


@router.patch("/projects/{project_id}/rubros/{rubro_id}", response_model=ProjectRubroResponse)
async def update_rubro(
    project_id: str,
    rubro_id: str,
    payload: ProjectRubroPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ProjectRubroResponse:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    rubro = await require_rubro(db, access.company_id, project_id, rubro_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(rubro, field, value)
    add_activity(db, access, "project_rubro.updated", "project_rubro", rubro.id)
    await commit_or_conflict(db, "No fue posible actualizar el rubro")
    await db.refresh(rubro)
    return await rubro_response(db, rubro)


@router.put(
    "/projects/{project_id}/rubros/{rubro_id}/features", response_model=ProjectRubroResponse
)
async def set_rubro_features(
    project_id: str,
    rubro_id: str,
    payload: ProjectRubroFeatureSet,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ProjectRubroResponse:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    rubro = await require_rubro(db, access.company_id, project_id, rubro_id)
    if (
        any(item.feature_key == "postensado_documentation" for item in payload.features)
        and rubro.slug != "postensado"
    ):
        raise HTTPException(
            status_code=422,
            detail="La documentación de Postensado es exclusiva del rubro Postensado",
        )
    existing = await rubro_features(db, rubro.id)
    for feature in existing:
        await db.delete(feature)
    seen: set[str] = set()
    for item in sorted(payload.features, key=lambda value: FEATURE_ORDER[value.feature_key]):
        if item.feature_key in seen:
            continue
        seen.add(item.feature_key)
        db.add(
            ProjectRubroFeature(
                rubro_id=rubro.id,
                feature_key=item.feature_key,
                settings_json=item.settings_json,
                sort_order=FEATURE_ORDER[item.feature_key],
            )
        )
    add_activity(db, access, "project_rubro.features_updated", "project_rubro", rubro.id)
    await commit_or_conflict(db, "No fue posible actualizar las funciones del rubro")
    await db.refresh(rubro)
    return await rubro_response(db, rubro)


@router.delete("/projects/{project_id}/rubros/{rubro_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rubro(
    project_id: str,
    rubro_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    rubro = await require_rubro(db, access.company_id, project_id, rubro_id)
    if rubro.is_system:
        raise HTTPException(
            status_code=409,
            detail="Los rubros predeterminados no se eliminan; puedes ajustar sus funciones",
        )
    documents = list(
        (
            await db.execute(
                select(PerforationDocument).where(PerforationDocument.rubro_id == rubro.id)
            )
        ).scalars()
    )
    notes = list(
        (
            await db.execute(
                select(PerforationPoint.note_storage_key).where(
                    PerforationPoint.rubro_id == rubro.id
                )
            )
        ).scalars()
    )
    await db.delete(rubro)
    await commit_or_conflict(db, "No fue posible eliminar el rubro")
    for document in documents:
        await remove_stored_file(document.storage_key)
    for key in notes:
        await remove_stored_file(key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/projects/{project_id}/rubros/{rubro_id}/observations",
    response_model=list[ProjectRubroObservationResponse],
)
async def list_rubro_observations(
    project_id: str,
    rubro_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> list[ProjectRubroObservation]:
    await require_project(db, access.company_id, project_id)
    rubro = await require_rubro(db, access.company_id, project_id, rubro_id)
    return list(
        (
            await db.execute(
                select(ProjectRubroObservation)
                .where(ProjectRubroObservation.rubro_id == rubro.id)
                .order_by(ProjectRubroObservation.created_at.desc())
            )
        ).scalars()
    )


@router.post(
    "/projects/{project_id}/rubros/{rubro_id}/observations",
    response_model=ProjectRubroObservationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_rubro_observation(
    project_id: str,
    rubro_id: str,
    payload: ProjectRubroObservationCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ProjectRubroObservation:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    rubro = await require_rubro(db, access.company_id, project_id, rubro_id)
    observation = ProjectRubroObservation(
        company_id=access.company_id,
        project_id=project_id,
        rubro_id=rubro.id,
        body=payload.body,
        created_by_user_id=access.user.id,
    )
    db.add(observation)
    await flush_or_conflict(db, "No fue posible registrar la observación")
    add_activity(db, access, "project_rubro.observation_created", "project_rubro", rubro.id)
    await commit_or_conflict(db, "No fue posible registrar la observación")
    await db.refresh(observation)
    return observation


@router.delete(
    "/projects/{project_id}/rubros/{rubro_id}/observations/{observation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_rubro_observation(
    project_id: str,
    rubro_id: str,
    observation_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    await require_rubro(db, access.company_id, project_id, rubro_id)
    observation = await db.scalar(
        select(ProjectRubroObservation).where(
            ProjectRubroObservation.id == observation_id,
            ProjectRubroObservation.rubro_id == rubro_id,
            ProjectRubroObservation.company_id == access.company_id,
        )
    )
    if observation is None:
        raise HTTPException(status_code=404, detail="Observación no encontrada")
    await db.delete(observation)
    await commit_or_conflict(db, "No fue posible eliminar la observación")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/projects/{project_id}/rubros/{rubro_id}/perforations",
    response_model=PerforationWorkspaceResponse,
)
async def perforation_workspace(
    project_id: str,
    rubro_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> PerforationWorkspaceResponse:
    await require_project(db, access.company_id, project_id)
    rubro = await require_rubro(db, access.company_id, project_id, rubro_id)
    await require_interactive_pdf_feature(db, rubro)
    await ensure_default_perforation_colors(db, rubro)
    colors = list(
        (
            await db.execute(
                select(PerforationColor)
                .where(PerforationColor.rubro_id == rubro.id)
                .order_by(PerforationColor.sort_order, PerforationColor.name)
            )
        ).scalars()
    )
    documents = list(
        (
            await db.execute(
                select(PerforationDocument)
                .where(PerforationDocument.rubro_id == rubro.id)
                .order_by(PerforationDocument.created_at.desc())
            )
        ).scalars()
    )
    points = list(
        (
            await db.execute(
                select(PerforationPoint)
                .where(PerforationPoint.rubro_id == rubro.id)
                .order_by(
                    PerforationPoint.document_id, PerforationPoint.page_number, PerforationPoint.id
                )
            )
        ).scalars()
    )
    return PerforationWorkspaceResponse(
        rubro=await rubro_response(db, rubro),
        colors=[color_response(color) for color in colors],
        documents=[await document_response(db, document) for document in documents],
        points=[point_response(point) for point in points],
    )


@router.post(
    "/projects/{project_id}/rubros/{rubro_id}/perforation-documents",
    response_model=PerforationDocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_perforation_document(
    project_id: str,
    rubro_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    title: Annotated[str, Form(min_length=2, max_length=220)],
    file: Annotated[UploadFile, File()],
) -> PerforationDocumentResponse:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    rubro = await require_rubro(db, access.company_id, project_id, rubro_id)
    await require_interactive_pdf_feature(db, rubro)
    stored = await store_upload(
        file,
        "companies",
        access.company_id,
        "projects",
        project_id,
        "rubros",
        rubro.id,
        "perforations",
        max_bytes=get_settings().document_max_bytes,
    )
    document = PerforationDocument(
        company_id=access.company_id,
        project_id=project_id,
        rubro_id=rubro.id,
        title=title.strip(),
        created_by_user_id=access.user.id,
        page_count=await run_in_threadpool(
            page_count, storage_path(stored.storage_key), stored.mime_type
        ),
        **stored.__dict__,
    )
    db.add(document)
    try:
        await flush_or_conflict(db, "No fue posible registrar el plano de perforaciones")
        add_activity(
            db, access, "perforation_document.created", "perforation_document", document.id
        )
        await commit_or_conflict(db, "No fue posible guardar el plano de perforaciones")
    except Exception:
        await remove_stored_file(stored.storage_key)
        raise
    await db.refresh(document)
    return await document_response(db, document)


@router.delete(
    "/projects/{project_id}/rubros/{rubro_id}/perforation-documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_perforation_document(
    project_id: str,
    rubro_id: str,
    document_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    document = await require_document(db, access.company_id, project_id, rubro_id, document_id)
    note_keys = list(
        (
            await db.execute(
                select(PerforationPoint.note_storage_key).where(
                    PerforationPoint.document_id == document.id
                )
            )
        ).scalars()
    )
    storage_key = document.storage_key
    await db.delete(document)
    await commit_or_conflict(db, "No fue posible eliminar el plano de perforaciones")
    await remove_stored_file(storage_key)
    for key in note_keys:
        await remove_stored_file(key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/projects/{project_id}/rubros/{rubro_id}/perforation-documents/{document_id}/preview")
async def preview_perforation_document(
    project_id: str,
    rubro_id: str,
    document_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    page: int = 1,
) -> Response:
    if page < 1 or page > 10000:
        raise HTTPException(status_code=422, detail="La página solicitada no es válida")
    await require_project(db, access.company_id, project_id)
    document = await require_document(db, access.company_id, project_id, rubro_id, document_id)
    path = storage_path(document.storage_key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="El archivo del plano no está disponible")
    try:
        content = await run_in_threadpool(preview_png, path, document.mime_type, page)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=content, media_type="image/png", headers={"Cache-Control": "private, max-age=60"}
    )


@router.get("/projects/{project_id}/rubros/{rubro_id}/perforation-documents/{document_id}/download")
async def download_perforation_document(
    project_id: str,
    rubro_id: str,
    document_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> FileResponse:
    await require_project(db, access.company_id, project_id)
    document = await require_document(db, access.company_id, project_id, rubro_id, document_id)
    path = storage_path(document.storage_key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="El archivo del plano no está disponible")
    return FileResponse(path, media_type=document.mime_type, filename=document.original_filename)


@router.post(
    "/projects/{project_id}/rubros/{rubro_id}/perforation-colors",
    response_model=PerforationColorResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_perforation_color(
    project_id: str,
    rubro_id: str,
    payload: PerforationColorCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> PerforationColorResponse:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    rubro = await require_rubro(db, access.company_id, project_id, rubro_id)
    await require_interactive_pdf_feature(db, rubro)
    last_order = await db.scalar(
        select(func.max(PerforationColor.sort_order)).where(PerforationColor.rubro_id == rubro.id)
    )
    color = PerforationColor(
        rubro_id=rubro.id,
        name=payload.name.strip(),
        color_hex=payload.color_hex.upper(),
        checklist_json=checklist_snapshot(payload.checklist),
        sort_order=payload.sort_order if payload.sort_order is not None else (last_order or 0) + 1,
    )
    db.add(color)
    await flush_or_conflict(db, "No fue posible crear el color")
    add_activity(db, access, "perforation_color.created", "perforation_color", color.id)
    await commit_or_conflict(db, "No fue posible crear el color")
    await db.refresh(color)
    return color_response(color)


@router.patch(
    "/projects/{project_id}/rubros/{rubro_id}/perforation-colors/{color_id}",
    response_model=PerforationColorResponse,
)
async def update_perforation_color(
    project_id: str,
    rubro_id: str,
    color_id: str,
    payload: PerforationColorPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> PerforationColorResponse:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    rubro = await require_rubro(db, access.company_id, project_id, rubro_id)
    await require_interactive_pdf_feature(db, rubro)
    color = await require_color(db, rubro.id, color_id)
    changes = payload.model_dump(exclude_unset=True)
    if "checklist" in changes:
        color.checklist_json = checklist_snapshot(changes.pop("checklist"))
    if "color_hex" in changes:
        changes["color_hex"] = changes["color_hex"].upper()
    for field, value in changes.items():
        setattr(color, field, value)
    add_activity(db, access, "perforation_color.updated", "perforation_color", color.id)
    await commit_or_conflict(db, "No fue posible actualizar el color")
    await db.refresh(color)
    return color_response(color)


@router.delete(
    "/projects/{project_id}/rubros/{rubro_id}/perforation-colors/{color_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_perforation_color(
    project_id: str,
    rubro_id: str,
    color_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    rubro = await require_rubro(db, access.company_id, project_id, rubro_id)
    color = await require_color(db, rubro.id, color_id)
    assigned = await db.scalar(
        select(func.count())
        .select_from(PerforationPoint)
        .where(PerforationPoint.color_id == color.id)
    )
    if assigned:
        raise HTTPException(
            status_code=409, detail="No se puede eliminar un color que ya usan puntos"
        )
    await db.delete(color)
    await commit_or_conflict(db, "No fue posible eliminar el color")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/projects/{project_id}/rubros/{rubro_id}/perforation-points",
    response_model=PerforationPointResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_perforation_point(
    project_id: str,
    rubro_id: str,
    payload: PerforationPointCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> PerforationPointResponse:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    rubro = await require_rubro(db, access.company_id, project_id, rubro_id)
    await require_interactive_pdf_feature(db, rubro)
    await require_document(db, access.company_id, project_id, rubro.id, payload.document_id)
    color = await require_color(db, rubro.id, payload.color_id)
    point = PerforationPoint(
        company_id=access.company_id,
        project_id=project_id,
        rubro_id=rubro.id,
        document_id=payload.document_id,
        color_id=color.id,
        page_number=payload.page_number,
        x=payload.x,
        y=payload.y,
        diameter=payload.diameter,
        label=payload.label.strip() if payload.label else None,
        color_hex=color.color_hex,
        checklist_json=checklist_snapshot(color.checklist_json),
        status="pending",
        created_by_user_id=access.user.id,
    )
    db.add(point)
    await flush_or_conflict(db, "No fue posible crear el punto")
    add_activity(db, access, "perforation_point.created", "perforation_point", point.id)
    await commit_or_conflict(db, "No fue posible crear el punto")
    await db.refresh(point)
    return point_response(point)


@router.patch(
    "/projects/{project_id}/rubros/{rubro_id}/perforation-points/{point_id}",
    response_model=PerforationPointResponse,
)
async def update_perforation_point(
    project_id: str,
    rubro_id: str,
    point_id: str,
    payload: PerforationPointPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> PerforationPointResponse:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    rubro = await require_rubro(db, access.company_id, project_id, rubro_id)
    point = await require_point(db, access.company_id, project_id, rubro.id, point_id)
    changes = payload.model_dump(exclude_unset=True)
    if "color_id" in changes:
        color = await require_color(db, rubro.id, changes["color_id"])
        point.color_id = color.id
        point.color_hex = color.color_hex
        point.checklist_json = checklist_snapshot(color.checklist_json)
        point.status = point_status(point.checklist_json)
        changes.pop("color_id")
    if "label" in changes and changes["label"] is not None:
        changes["label"] = changes["label"].strip() or None
    for field, value in changes.items():
        setattr(point, field, value)
    add_activity(db, access, "perforation_point.updated", "perforation_point", point.id)
    await commit_or_conflict(db, "No fue posible actualizar el punto")
    await db.refresh(point)
    return point_response(point)


@router.put(
    "/projects/{project_id}/rubros/{rubro_id}/perforation-points/{point_id}/checklist",
    response_model=PerforationPointResponse,
)
async def update_perforation_point_checklist(
    project_id: str,
    rubro_id: str,
    point_id: str,
    payload: PerforationChecklistPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> PerforationPointResponse:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    point = await require_point(db, access.company_id, project_id, rubro_id, point_id)
    point.checklist_json = [entry.model_dump() for entry in payload.checklist]
    point.status = point_status(point.checklist_json)
    add_activity(
        db,
        access,
        "perforation_point.checklist_updated",
        "perforation_point",
        point.id,
        {"completed": point.status == "completed"},
    )
    await commit_or_conflict(db, "No fue posible guardar el checklist")
    await db.refresh(point)
    return point_response(point)


@router.post(
    "/projects/{project_id}/rubros/{rubro_id}/perforation-points/{point_id}/attachment",
    response_model=PerforationPointResponse,
)
async def upload_perforation_note_attachment(
    project_id: str,
    rubro_id: str,
    point_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    file: Annotated[UploadFile, File()],
) -> PerforationPointResponse:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    point = await require_point(db, access.company_id, project_id, rubro_id, point_id)
    stored = await store_upload(
        file,
        "companies",
        access.company_id,
        "projects",
        project_id,
        "rubros",
        rubro_id,
        "perforation-notes",
        point.id,
        max_bytes=get_settings().document_max_bytes,
    )
    previous = point.note_storage_key
    point.note_storage_key = stored.storage_key
    point.note_original_filename = stored.original_filename
    point.note_mime_type = stored.mime_type
    try:
        await commit_or_conflict(db, "No fue posible guardar el archivo de nota")
    except Exception:
        await remove_stored_file(stored.storage_key)
        raise
    await remove_stored_file(previous)
    await db.refresh(point)
    return point_response(point)


@router.get("/projects/{project_id}/rubros/{rubro_id}/perforation-points/{point_id}/attachment")
async def download_perforation_note_attachment(
    project_id: str,
    rubro_id: str,
    point_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> FileResponse:
    await require_project(db, access.company_id, project_id)
    point = await require_point(db, access.company_id, project_id, rubro_id, point_id)
    if not point.note_storage_key:
        raise HTTPException(status_code=404, detail="Este punto no tiene un archivo de nota")
    path = storage_path(point.note_storage_key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="El archivo de nota no está disponible")
    return FileResponse(
        path,
        media_type=point.note_mime_type or "application/octet-stream",
        filename=point.note_original_filename or "nota",
    )


@router.delete(
    "/projects/{project_id}/rubros/{rubro_id}/perforation-points/{point_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_perforation_point(
    project_id: str,
    rubro_id: str,
    point_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    point = await require_point(db, access.company_id, project_id, rubro_id, point_id)
    note_key = point.note_storage_key
    await db.delete(point)
    await commit_or_conflict(db, "No fue posible eliminar el punto")
    await remove_stored_file(note_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
