import subprocess
import tempfile
import unicodedata
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageOps
from sqlalchemy import func, select

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.routes.operations import (
    WORK_EDITOR_ROLES,
    add_activity,
    commit_or_conflict,
    flush_or_conflict,
    require_level,
    require_project,
    require_role,
)
from app.api.schemas.modules import (
    AnnotationCreate,
    AnnotationPatch,
    AnnotationResponse,
    PlanDocumentResponse,
    PlanLevelDetectionResponse,
    PlanVersionResponse,
    ProjectOverviewPlanPatch,
    ProjectOverviewPlanResponse,
)
from app.core.config import get_settings
from app.db.models import Annotation, PlanDocument, PlanVersion, ProjectLevel
from app.services.file_storage import remove_stored_file, storage_path, store_upload

router = APIRouter()


async def require_document(
    db: DbSession, company_id: str, project_id: str, document_id: str
) -> PlanDocument:
    document = await db.scalar(
        select(PlanDocument).where(
            PlanDocument.id == document_id,
            PlanDocument.company_id == company_id,
            PlanDocument.project_id == project_id,
        )
    )
    if document is None:
        raise HTTPException(status_code=404, detail="Plano no encontrado")
    return document


async def require_version(
    db: DbSession, company_id: str, project_id: str, version_id: str
) -> tuple[PlanVersion, PlanDocument]:
    row = (
        await db.execute(
            select(PlanVersion, PlanDocument)
            .join(PlanDocument, PlanDocument.id == PlanVersion.document_id)
            .where(
                PlanVersion.id == version_id,
                PlanDocument.company_id == company_id,
                PlanDocument.project_id == project_id,
            )
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Versión del plano no encontrada")
    return row


def document_response(document: PlanDocument, versions: list[PlanVersion]) -> PlanDocumentResponse:
    payload = PlanDocumentResponse.model_validate(document)
    payload.versions = [PlanVersionResponse.model_validate(version) for version in versions]
    return payload


def preview_png(path: Path, mime_type: str, page: int) -> bytes:
    """Render a private plan file for the in-app canvas without exposing its URL."""

    if mime_type == "application/pdf":
        with tempfile.TemporaryDirectory(prefix="obrixapy-plan-preview-") as directory:
            output = Path(directory) / "page"
            try:
                subprocess.run(
                    [
                        "pdftoppm",
                        "-f",
                        str(page),
                        "-l",
                        str(page),
                        "-png",
                        "-r",
                        "160",
                        str(path),
                        str(output),
                    ],
                    check=True,
                    capture_output=True,
                    timeout=30,
                )
            except (
                FileNotFoundError,
                subprocess.CalledProcessError,
                subprocess.TimeoutExpired,
            ) as exc:
                raise ValueError("No fue posible preparar la vista previa del PDF") from exc
            rendered = Path(f"{output}-{page}.png")
            if not rendered.is_file():
                raise ValueError("La página solicitada no existe en el plano")
            return rendered.read_bytes()
    try:
        with Image.open(path) as image:
            preview = ImageOps.exif_transpose(image).convert("RGB")
            preview.thumbnail((2600, 2600))
            output = BytesIO()
            preview.save(output, format="PNG", optimize=True)
            return output.getvalue()
    except (OSError, ValueError) as exc:
        raise ValueError("No fue posible preparar la vista previa de la imagen") from exc


def normalized_plan_label(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(
        character.lower()
        for character in decomposed
        if character.isalnum() and not unicodedata.combining(character)
    )


def clamp_unit(value: float) -> float:
    return min(1.0, max(0.0, value))


def detect_level_labels_in_pdf(
    path: Path,
    levels: list[tuple[str, str, str | None]],
) -> list[dict]:
    """Find level labels in a PDF text layer and return safe, editable starter zones.

    Construction PDFs often contain a selectable label for each slab/level.  We
    deliberately return a modest rectangle around that label instead of trying
    to infer the whole slab boundary: users can still resize it, while the
    automatic result is predictable and never paints an invented structural area.
    """

    with tempfile.TemporaryDirectory(prefix="obrixapy-plan-detect-") as directory:
        output = Path(directory) / "page.html"
        try:
            subprocess.run(
                ["pdftotext", "-f", "1", "-l", "1", "-bbox-layout", str(path), str(output)],
                check=True,
                capture_output=True,
                timeout=30,
            )
            root = ET.parse(output).getroot()
        except (
            FileNotFoundError,
            subprocess.CalledProcessError,
            subprocess.TimeoutExpired,
            ET.ParseError,
        ):
            return []

    page = next(
        (
            element
            for element in root.iter()
            if element.tag.rsplit("}", 1)[-1] == "page"
        ),
        None,
    )
    if page is None:
        return []
    try:
        page_width = float(page.attrib["width"])
        page_height = float(page.attrib["height"])
    except (KeyError, TypeError, ValueError):
        return []
    if page_width <= 0 or page_height <= 0:
        return []

    words: list[tuple[str, float, float, float, float]] = []
    for element in page.iter():
        if element.tag.rsplit("}", 1)[-1] != "word" or not element.text:
            continue
        try:
            words.append(
                (
                    element.text.strip(),
                    float(element.attrib["xMin"]),
                    float(element.attrib["yMin"]),
                    float(element.attrib["xMax"]),
                    float(element.attrib["yMax"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue

    name_counts: dict[str, int] = {}
    for _, level_name, _ in levels:
        name = normalized_plan_label(level_name)
        name_counts[name] = name_counts.get(name, 0) + 1

    detections: list[dict] = []
    for level_id, level_name, sector_name in levels:
        normalized_name = normalized_plan_label(level_name)
        if len(normalized_name) < 2:
            continue
        # A repeated number is ambiguous across sectors.  In that case require
        # the PDF to expose both labels together rather than painting two slabs
        # on the same text occurrence.
        targets = [normalized_name]
        normalized_sector = normalized_plan_label(sector_name or "")
        if name_counts[normalized_name] > 1:
            if len(normalized_sector) < 2:
                continue
            targets = [
                f"{normalized_sector}{normalized_name}",
                f"{normalized_name}{normalized_sector}",
            ]
        best: tuple[float, int, int] | None = None
        for start in range(len(words)):
            for end in range(start + 1, min(len(words), start + 8) + 1):
                candidate = normalized_plan_label(" ".join(word[0] for word in words[start:end]))
                for target in targets:
                    if candidate == target:
                        best = (0.96, start, end)
                        break
                    if target in candidate and len(candidate) <= len(target) + 18:
                        score = 0.76 + min(0.16, len(target) / max(len(candidate), 1) * 0.16)
                        if best is None or score > best[0]:
                            best = (score, start, end)
                if best and best[0] >= 0.96:
                    break
            if best and best[0] >= 0.96:
                break
        if best is None:
            continue
        confidence, start, end = best
        label_words = words[start:end]
        x_min = min(word[1] for word in label_words) / page_width
        y_min = min(word[2] for word in label_words) / page_height
        x_max = max(word[3] for word in label_words) / page_width
        y_max = max(word[4] for word in label_words) / page_height
        width = max(0.14, x_max - x_min + 0.08)
        height = max(0.10, y_max - y_min + 0.06)
        x = clamp_unit(x_min - 0.04)
        y = clamp_unit(y_min - 0.03)
        width = min(width, 1 - x)
        height = min(height, 1 - y)
        detections.append(
            {
                "level_id": level_id,
                "level_name": level_name,
                "page_number": 1,
                "geometry_json": {"x": x, "y": y, "width": width, "height": height},
                "confidence": round(confidence, 2),
            }
        )
    return detections


@router.get(
    "/projects/{project_id}/plans",
    response_model=list[PlanDocumentResponse],
)
async def list_plans(
    project_id: str, access: CurrentCompanyAccess, db: DbSession
) -> list[PlanDocumentResponse]:
    await require_project(db, access.company_id, project_id)
    documents = list(
        (
            await db.execute(
                select(PlanDocument)
                .where(
                    PlanDocument.company_id == access.company_id,
                    PlanDocument.project_id == project_id,
                )
                .order_by(PlanDocument.created_at.desc())
            )
        ).scalars()
    )
    if not documents:
        return []
    versions = list(
        (
            await db.execute(
                select(PlanVersion)
                .where(PlanVersion.document_id.in_([item.id for item in documents]))
                .order_by(PlanVersion.document_id, PlanVersion.version_number.desc())
            )
        ).scalars()
    )
    by_document: dict[str, list[PlanVersion]] = {}
    for version in versions:
        by_document.setdefault(version.document_id, []).append(version)
    return [document_response(item, by_document.get(item.id, [])) for item in documents]


@router.post(
    "/projects/{project_id}/plans",
    response_model=PlanDocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_plan(
    project_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    title: Annotated[str, Form(min_length=2, max_length=220)],
    file: Annotated[UploadFile, File()],
    level_id: Annotated[str | None, Form()] = None,
) -> PlanDocumentResponse:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    await require_level(db, project_id, level_id)
    stored = await store_upload(
        file,
        "companies",
        access.company_id,
        "projects",
        project_id,
        "plans",
        max_bytes=get_settings().document_max_bytes,
    )
    document = PlanDocument(
        company_id=access.company_id,
        project_id=project_id,
        level_id=level_id,
        title=title.strip(),
        status="active",
        created_by_user_id=access.user.id,
    )
    db.add(document)
    try:
        await flush_or_conflict(db, "No fue posible registrar el plano")
        version = PlanVersion(
            document_id=document.id,
            version_number=1,
            created_by_user_id=access.user.id,
            **stored.__dict__,
        )
        db.add(version)
        await flush_or_conflict(db, "No fue posible registrar la versión del plano")
        add_activity(db, access, "plan.created", "plan_document", document.id)
        await commit_or_conflict(db, "No fue posible registrar el plano")
    except Exception:
        await remove_stored_file(stored.storage_key)
        raise
    await db.refresh(document)
    await db.refresh(version)
    return document_response(document, [version])


@router.post(
    "/projects/{project_id}/plans/{document_id}/versions",
    response_model=PlanVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_plan_version(
    project_id: str,
    document_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    file: Annotated[UploadFile, File()],
) -> PlanVersion:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    await require_document(db, access.company_id, project_id, document_id)
    next_version = (
        await db.scalar(
            select(func.max(PlanVersion.version_number)).where(
                PlanVersion.document_id == document_id
            )
        )
        or 0
    ) + 1
    stored = await store_upload(
        file,
        "companies",
        access.company_id,
        "projects",
        project_id,
        "plans",
        document_id,
        max_bytes=get_settings().document_max_bytes,
    )
    version = PlanVersion(
        document_id=document_id,
        version_number=next_version,
        created_by_user_id=access.user.id,
        **stored.__dict__,
    )
    db.add(version)
    try:
        await flush_or_conflict(db, "La versión del plano ya existe")
        add_activity(db, access, "plan.version.created", "plan_version", version.id)
        await commit_or_conflict(db, "No fue posible registrar la versión")
    except Exception:
        await remove_stored_file(stored.storage_key)
        raise
    await db.refresh(version)
    return version


@router.get("/projects/{project_id}/plans/versions/{version_id}/download")
async def download_plan_version(
    project_id: str,
    version_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> FileResponse:
    version, _ = await require_version(db, access.company_id, project_id, version_id)
    path = storage_path(version.storage_key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="El archivo del plano no está disponible")
    return FileResponse(path, media_type=version.mime_type, filename=version.original_filename)


@router.get("/projects/{project_id}/plans/versions/{version_id}/preview")
async def preview_plan_version(
    project_id: str,
    version_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    page: int = 1,
) -> Response:
    """Return an authenticated raster preview used by the zoomable project board."""

    if page < 1 or page > 100:
        raise HTTPException(status_code=422, detail="La página de vista previa no es válida")
    version, _ = await require_version(db, access.company_id, project_id, version_id)
    path = storage_path(version.storage_key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="El archivo del plano no está disponible")
    try:
        content = await run_in_threadpool(preview_png, path, version.mime_type, page)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.post(
    "/projects/{project_id}/plans/versions/{version_id}/detect-levels",
    response_model=PlanLevelDetectionResponse,
)
async def detect_plan_levels(
    project_id: str,
    version_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    overwrite: bool = False,
) -> PlanLevelDetectionResponse:
    """Suggest level locations from selectable labels in the overview PDF."""

    require_role(access, WORK_EDITOR_ROLES)
    version, _ = await require_version(db, access.company_id, project_id, version_id)
    levels = list(
        (
            await db.execute(
                select(ProjectLevel)
                .where(ProjectLevel.project_id == project_id)
                .order_by(ProjectLevel.sort_order, ProjectLevel.name)
            )
        ).scalars()
    )
    if version.mime_type != "application/pdf":
        return PlanLevelDetectionResponse(
            unmatched_level_ids=[level.id for level in levels],
            message=(
                "La detección automática funciona con PDFs que contienen etiquetas de texto. "
                "En imágenes, usa Ubicar nivel."
            ),
        )
    candidates = [
        level
        for level in levels
        if overwrite or not level.plan_geometry_json
    ]
    if not candidates:
        return PlanLevelDetectionResponse(
            message=(
                "Todos los niveles ya tienen una ubicación. "
                "Usa Ubicar nivel para ajustar cualquier zona."
            ),
        )
    path = storage_path(version.storage_key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="El archivo del plano no está disponible")
    detections = await run_in_threadpool(
        detect_level_labels_in_pdf,
        path,
        [(level.id, level.name, level.building_name) for level in candidates],
    )
    by_level = {level.id: level for level in candidates}
    for detected in detections:
        level = by_level[detected["level_id"]]
        level.plan_version_id = version.id
        level.plan_page_number = detected["page_number"]
        level.plan_geometry_json = detected["geometry_json"]
    if detections:
        add_activity(
            db,
            access,
            "plan.levels.detected",
            "plan_version",
            version.id,
            {"detected": len(detections)},
        )
        await commit_or_conflict(db, "No fue posible guardar las ubicaciones detectadas")
    detected_ids = {item["level_id"] for item in detections}
    message = (
        f"Se sugirieron {len(detections)} ubicaciones. Revisa y ajusta cada zona si es necesario."
        if detections
        else (
            "No se encontraron etiquetas de niveles en el PDF. "
            "Ubícalos manualmente sobre el plano."
        )
    )
    return PlanLevelDetectionResponse(
        detected=detections,
        unmatched_level_ids=[level.id for level in candidates if level.id not in detected_ids],
        message=message,
    )


@router.patch(
    "/projects/{project_id}/plans/overview",
    response_model=ProjectOverviewPlanResponse,
)
async def select_project_overview_plan(
    project_id: str,
    payload: ProjectOverviewPlanPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ProjectOverviewPlanResponse:
    """Select which immutable plan version is rendered in the project Resumen."""

    require_role(access, WORK_EDITOR_ROLES)
    project = await require_project(db, access.company_id, project_id)
    if payload.plan_version_id is not None:
        await require_version(db, access.company_id, project_id, payload.plan_version_id)
    project.overview_plan_version_id = payload.plan_version_id
    add_activity(
        db,
        access,
        "project.overview_plan.updated",
        "project",
        project.id,
        {"plan_version_id": payload.plan_version_id},
    )
    await commit_or_conflict(db, "No fue posible seleccionar el plano del resumen")
    return ProjectOverviewPlanResponse(plan_version_id=project.overview_plan_version_id)


@router.get(
    "/projects/{project_id}/plans/versions/{version_id}/annotations",
    response_model=list[AnnotationResponse],
)
async def list_annotations(
    project_id: str,
    version_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> list[Annotation]:
    await require_version(db, access.company_id, project_id, version_id)
    return list(
        (
            await db.execute(
                select(Annotation)
                .where(
                    Annotation.company_id == access.company_id,
                    Annotation.plan_version_id == version_id,
                )
                .order_by(Annotation.page_number, Annotation.created_at)
            )
        ).scalars()
    )


@router.post(
    "/projects/{project_id}/plans/versions/{version_id}/annotations",
    response_model=AnnotationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_annotation(
    project_id: str,
    version_id: str,
    payload: AnnotationCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Annotation:
    require_role(access, WORK_EDITOR_ROLES)
    await require_version(db, access.company_id, project_id, version_id)
    await require_level(db, project_id, payload.level_id)
    annotation = Annotation(
        company_id=access.company_id,
        plan_version_id=version_id,
        created_by_user_id=access.user.id,
        status="pending",
        **payload.model_dump(),
    )
    db.add(annotation)
    await flush_or_conflict(db, "No fue posible agregar la anotación")
    add_activity(db, access, "plan.annotation.created", "annotation", annotation.id)
    await commit_or_conflict(db, "No fue posible agregar la anotación")
    await db.refresh(annotation)
    return annotation


@router.patch(
    "/projects/{project_id}/plans/annotations/{annotation_id}",
    response_model=AnnotationResponse,
)
async def update_annotation(
    project_id: str,
    annotation_id: str,
    payload: AnnotationPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Annotation:
    require_role(access, WORK_EDITOR_ROLES)
    annotation = await db.scalar(
        select(Annotation)
        .join(PlanVersion, PlanVersion.id == Annotation.plan_version_id)
        .join(PlanDocument, PlanDocument.id == PlanVersion.document_id)
        .where(
            Annotation.id == annotation_id,
            Annotation.company_id == access.company_id,
            PlanDocument.project_id == project_id,
        )
    )
    if annotation is None:
        raise HTTPException(status_code=404, detail="Anotación no encontrada")
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(annotation, field, value)
    add_activity(db, access, "plan.annotation.updated", "annotation", annotation.id, changes)
    await commit_or_conflict(db, "No fue posible actualizar la anotación")
    await db.refresh(annotation)
    return annotation


@router.delete(
    "/projects/{project_id}/plans/annotations/{annotation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_annotation(
    project_id: str,
    annotation_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    require_role(access, WORK_EDITOR_ROLES)
    annotation = await db.scalar(
        select(Annotation)
        .join(PlanVersion, PlanVersion.id == Annotation.plan_version_id)
        .join(PlanDocument, PlanDocument.id == PlanVersion.document_id)
        .where(
            Annotation.id == annotation_id,
            Annotation.company_id == access.company_id,
            PlanDocument.project_id == project_id,
        )
    )
    if annotation is None:
        raise HTTPException(status_code=404, detail="Anotación no encontrada")
    add_activity(db, access, "plan.annotation.deleted", "annotation", annotation.id)
    await db.delete(annotation)
    await commit_or_conflict(db, "No fue posible eliminar la anotación")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
