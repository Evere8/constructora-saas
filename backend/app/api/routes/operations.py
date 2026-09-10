from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import Response
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.schemas.checklists import ChecklistResponse
from app.api.schemas.operations import (
    LevelCreate,
    LevelPatch,
    LevelResponse,
    ProjectCreate,
    ProjectListResponse,
    ProjectPatch,
    ProjectResponse,
    SectorCreate,
    SectorPatch,
    SectorResponse,
    TaskCreate,
    TaskListResponse,
    TaskPatch,
    TaskResponse,
)
from app.db.models import (
    ActivityLog,
    AppUser,
    ChecklistEvidence,
    ChecklistItem,
    CompanyMembership,
    InventoryItem,
    InventoryRelocationRequest,
    PlanDocument,
    PlanVersion,
    Project,
    ProjectLevel,
    ProjectSector,
    Task,
    TaskMaterialRequirement,
    TaskTemplate,
    TaskTemplateChecklistItem,
    TaskTemplateRequirement,
)
from app.services.file_storage import remove_stored_file

router = APIRouter()

PROJECT_EDITOR_ROLES = {"platform_admin", "owner", "admin", "engineer"}
WORK_EDITOR_ROLES = PROJECT_EDITOR_ROLES | {"supervisor"}
SELF_TASK_ROLES = {"worker", "transport"}
SELF_TASK_STATUSES = {"in_progress", "review", "completed"}

# The editable field checklist illustrated in the operational plan workflow.
# These records are created independently for every project level.
DEFAULT_LEVEL_CHECKLIST: tuple[tuple[str, str], ...] = (
    ("Cortados", "cortados"),
    ("En obra", "en_obra"),
    ("Anclajes colocados", "anclajes_colocados"),
    ("Colocación de cabos", "colocacion_de_cabos"),
    ("Ataduras", "ataduras"),
    ("Revisado", "revisado"),
)


def require_role(access: CurrentCompanyAccess, allowed: set[str]) -> None:
    if access.role not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tiene permisos para realizar esta operación",
        )


async def commit_or_conflict(db: DbSession, detail: str) -> None:
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc


async def flush_or_conflict(db: DbSession, detail: str) -> None:
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc


def add_activity(
    db: DbSession,
    access: CurrentCompanyAccess,
    action: str,
    entity_type: str,
    entity_id: str,
    metadata: dict | None = None,
) -> None:
    db.add(
        ActivityLog(
            company_id=access.company_id,
            user_id=access.user.id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            # Pydantic turns date inputs from the checklist into ``date`` objects.
            # SQLAlchemy's JSON encoder cannot persist those directly, which used to
            # make a completed checklist item fail at commit time.
            metadata_json=jsonable_encoder(metadata) if metadata is not None else None,
        )
    )


async def require_project(db: DbSession, company_id: str, project_id: str) -> Project:
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.company_id == company_id)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Obra no encontrada")
    return project


async def require_task(
    db: DbSession,
    company_id: str,
    project_id: str,
    task_id: str,
) -> Task:
    result = await db.execute(
        select(Task).where(
            Task.id == task_id,
            Task.company_id == company_id,
            Task.project_id == project_id,
        )
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tarea no encontrada")
    return task


async def require_task_template(
    db: DbSession, company_id: str, template_id: str | None
) -> TaskTemplate | None:
    if template_id is None:
        return None
    template = await db.scalar(
        select(TaskTemplate).where(
            TaskTemplate.id == template_id,
            TaskTemplate.company_id == company_id,
            TaskTemplate.is_active.is_(True),
        )
    )
    if template is None:
        raise HTTPException(status_code=422, detail="La tarea predeterminada no está disponible")
    return template


async def require_level(db: DbSession, project_id: str, level_id: str | None) -> None:
    if level_id is None:
        return
    result = await db.execute(
        select(ProjectLevel.id).where(
            ProjectLevel.id == level_id, ProjectLevel.project_id == project_id
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El nivel no pertenece a esta obra",
        )


async def require_sector(db: DbSession, project_id: str, sector_id: str) -> ProjectSector:
    sector = await db.scalar(
        select(ProjectSector).where(
            ProjectSector.id == sector_id,
            ProjectSector.project_id == project_id,
        )
    )
    if sector is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El sector no pertenece a esta obra",
        )
    return sector


async def find_or_create_sector(
    db: DbSession,
    project_id: str,
    name: str | None,
) -> ProjectSector:
    """Keep legacy ``building_name`` clients working while sectors are explicit."""

    normalized_name = (name or "Obra general").strip() or "Obra general"
    existing = await db.scalar(
        select(ProjectSector).where(
            ProjectSector.project_id == project_id,
            ProjectSector.name == normalized_name,
        )
    )
    if existing is not None:
        return existing
    last_order = await db.scalar(
        select(func.max(ProjectSector.sort_order)).where(ProjectSector.project_id == project_id)
    )
    sector = ProjectSector(
        project_id=project_id,
        name=normalized_name,
        sort_order=(last_order or 0) + 1,
    )
    db.add(sector)
    await flush_or_conflict(db, "Ya existe un sector con ese nombre en la obra")
    return sector


async def require_plan_version(
    db: DbSession, company_id: str, project_id: str, version_id: str | None
) -> None:
    if version_id is None:
        return
    version = await db.scalar(
        select(PlanVersion.id)
        .join(PlanDocument, PlanDocument.id == PlanVersion.document_id)
        .where(
            PlanVersion.id == version_id,
            PlanDocument.company_id == company_id,
            PlanDocument.project_id == project_id,
        )
    )
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La versión de plano no pertenece a esta obra",
        )


async def require_assignee(db: DbSession, company_id: str, user_id: str | None) -> None:
    if user_id is None:
        return
    result = await db.execute(
        select(CompanyMembership.id)
        .join(AppUser, AppUser.id == CompanyMembership.user_id)
        .where(
            CompanyMembership.company_id == company_id,
            CompanyMembership.user_id == user_id,
            CompanyMembership.status == "active",
            AppUser.status == "active",
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El responsable no es un miembro activo de la constructora",
        )


@router.get("/projects", response_model=ProjectListResponse)
async def list_projects(
    access: CurrentCompanyAccess,
    db: DbSession,
    project_status: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> ProjectListResponse:
    filters = [Project.company_id == access.company_id]
    if project_status:
        filters.append(Project.status == project_status)
    if search and search.strip():
        term = f"%{search.strip()}%"
        filters.append(or_(Project.name.like(term), Project.code.like(term)))

    total = await db.scalar(select(func.count()).select_from(Project).where(*filters))
    result = await db.execute(
        select(Project)
        .where(*filters)
        .order_by(Project.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return ProjectListResponse(
        items=[ProjectResponse.model_validate(project) for project in result.scalars()],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate, access: CurrentCompanyAccess, db: DbSession
) -> Project:
    require_role(access, PROJECT_EDITOR_ROLES)
    project = Project(company_id=access.company_id, **payload.model_dump())
    db.add(project)
    await flush_or_conflict(db, "Ya existe una obra con ese código")
    add_activity(db, access, "project.created", "project", project.id)
    await commit_or_conflict(db, "Ya existe una obra con ese código")
    await db.refresh(project)
    return project


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, access: CurrentCompanyAccess, db: DbSession) -> Project:
    return await require_project(db, access.company_id, project_id)


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    payload: ProjectPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Project:
    require_role(access, PROJECT_EDITOR_ROLES)
    project = await require_project(db, access.company_id, project_id)
    changes = payload.model_dump(exclude_unset=True)
    final_start = changes.get("start_date", project.start_date)
    final_end = changes.get("planned_end_date", project.planned_end_date)
    if final_start and final_end and final_end < final_start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La fecha final prevista no puede ser anterior al inicio",
        )
    for field, value in changes.items():
        setattr(project, field, value)
    add_activity(db, access, "project.updated", "project", project.id, changes)
    await commit_or_conflict(db, "No fue posible actualizar la obra")
    await db.refresh(project)
    return project


@router.get("/projects/{project_id}/levels", response_model=list[LevelResponse])
async def list_levels(
    project_id: str, access: CurrentCompanyAccess, db: DbSession
) -> list[ProjectLevel]:
    await require_project(db, access.company_id, project_id)
    result = await db.execute(
        select(ProjectLevel)
        .where(ProjectLevel.project_id == project_id)
        .order_by(ProjectLevel.sector_id, ProjectLevel.sort_order, ProjectLevel.name)
    )
    return list(result.scalars())


@router.get("/projects/{project_id}/sectors", response_model=list[SectorResponse])
async def list_sectors(
    project_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> list[ProjectSector]:
    await require_project(db, access.company_id, project_id)
    result = await db.execute(
        select(ProjectSector)
        .where(ProjectSector.project_id == project_id)
        .order_by(ProjectSector.sort_order, ProjectSector.name)
    )
    return list(result.scalars())


@router.post(
    "/projects/{project_id}/sectors",
    response_model=SectorResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_sector(
    project_id: str,
    payload: SectorCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ProjectSector:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    data = payload.model_dump()
    data["name"] = data["name"].strip()
    if data["sort_order"] is None:
        last_order = await db.scalar(
            select(func.max(ProjectSector.sort_order)).where(ProjectSector.project_id == project_id)
        )
        data["sort_order"] = (last_order or 0) + 1
    sector = ProjectSector(project_id=project_id, **data)
    db.add(sector)
    await flush_or_conflict(db, "Ya existe un sector con ese nombre en la obra")
    add_activity(db, access, "project_sector.created", "project_sector", sector.id)
    await commit_or_conflict(db, "Ya existe un sector con ese nombre en la obra")
    await db.refresh(sector)
    return sector


@router.patch("/projects/{project_id}/sectors/{sector_id}", response_model=SectorResponse)
async def update_sector(
    project_id: str,
    sector_id: str,
    payload: SectorPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ProjectSector:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    sector = await require_sector(db, project_id, sector_id)
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        changes["name"] = changes["name"].strip()
    for field, value in changes.items():
        setattr(sector, field, value)
    # ``building_name`` remains a readable legacy label for PDF detection.
    if "name" in changes:
        levels = list(
            (
                await db.execute(
                    select(ProjectLevel).where(ProjectLevel.sector_id == sector.id)
                )
            ).scalars()
        )
        for level in levels:
            level.building_name = sector.name
    await flush_or_conflict(db, "Ya existe un sector con ese nombre en la obra")
    add_activity(db, access, "project_sector.updated", "project_sector", sector.id, changes)
    await commit_or_conflict(db, "No fue posible actualizar el sector")
    await db.refresh(sector)
    return sector


@router.delete("/projects/{project_id}/sectors/{sector_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sector(
    project_id: str,
    sector_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    sector = await require_sector(db, project_id, sector_id)
    level_count = await db.scalar(
        select(func.count()).select_from(ProjectLevel).where(ProjectLevel.sector_id == sector.id)
    )
    if level_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Elimina o mueve primero los niveles de este sector",
        )
    add_activity(
        db,
        access,
        "project_sector.deleted",
        "project_sector",
        sector.id,
        {"name": sector.name},
    )
    await db.delete(sector)
    await commit_or_conflict(db, "No fue posible eliminar el sector")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/projects/{project_id}/levels",
    response_model=LevelResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_level(
    project_id: str,
    payload: LevelCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ProjectLevel:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    data = payload.model_dump()
    if data["sector_id"]:
        sector = await require_sector(db, project_id, data["sector_id"])
    else:
        sector = await find_or_create_sector(db, project_id, data["building_name"])
    data["sector_id"] = sector.id
    data["building_name"] = sector.name
    if data["sort_order"] is None:
        last_order = await db.scalar(
            select(func.max(ProjectLevel.sort_order)).where(
                ProjectLevel.project_id == project_id,
                ProjectLevel.sector_id == sector.id,
            )
        )
        data["sort_order"] = (last_order or 0) + 1
    await require_plan_version(db, access.company_id, project_id, data["plan_version_id"])
    if data["work_status"] == "concreted" and data["concreted_at"] is None:
        data["concreted_at"] = date.today()
    level = ProjectLevel(project_id=project_id, **data)
    db.add(level)
    await flush_or_conflict(db, "Ya existe ese nivel dentro del sector seleccionado")
    db.add_all(
        [
            ChecklistItem(
                company_id=access.company_id,
                project_id=project_id,
                level_id=level.id,
                title=title,
                process_stage=stage,
                status="pending",
            )
            for title, stage in DEFAULT_LEVEL_CHECKLIST
        ]
    )
    add_activity(db, access, "project_level.created", "project_level", level.id)
    await commit_or_conflict(db, "Ya existe ese nivel dentro del sector seleccionado")
    await db.refresh(level)
    return level


@router.patch("/projects/{project_id}/levels/{level_id}", response_model=LevelResponse)
async def update_level(
    project_id: str,
    level_id: str,
    payload: LevelPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> ProjectLevel:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    result = await db.execute(
        select(ProjectLevel).where(
            ProjectLevel.id == level_id, ProjectLevel.project_id == project_id
        )
    )
    level = result.scalar_one_or_none()
    if level is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nivel no encontrado")
    changes = payload.model_dump(exclude_unset=True)
    if "sector_id" in changes:
        if changes["sector_id"] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Seleccione un sector válido",
            )
        sector = await require_sector(db, project_id, changes["sector_id"])
        changes["building_name"] = sector.name
    elif "building_name" in changes:
        sector = await find_or_create_sector(db, project_id, changes["building_name"])
        changes["sector_id"] = sector.id
        changes["building_name"] = sector.name
    final_plan_version_id = changes.get("plan_version_id", level.plan_version_id)
    await require_plan_version(db, access.company_id, project_id, final_plan_version_id)
    if changes.get("plan_geometry_json") is not None and final_plan_version_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Seleccione una versión de plano antes de ubicar el nivel",
        )
    if changes.get("work_status") == "concreted" and (
        "concreted_at" not in changes and level.concreted_at is None
    ):
        changes["concreted_at"] = date.today()
    if changes.get("work_status") in {"pending", "in_progress"} and "concreted_at" not in changes:
        changes["concreted_at"] = None
    for field, value in changes.items():
        setattr(level, field, value)
    add_activity(db, access, "project_level.updated", "project_level", level.id, changes)
    await commit_or_conflict(db, "Ya existe ese nivel dentro del sector seleccionado")
    await db.refresh(level)
    return level


@router.delete("/projects/{project_id}/levels/{level_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_level(
    project_id: str,
    level_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    level = await db.scalar(
        select(ProjectLevel).where(
            ProjectLevel.id == level_id,
            ProjectLevel.project_id == project_id,
        )
    )
    if level is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nivel no encontrado")
    # Default controls belong to the level and are removed with it.  Controls
    # owned by a task remain intact; their level reference is set to null by
    # the database so deleting a marker never erases unrelated task work.
    await db.execute(
        delete(ChecklistItem).where(
            ChecklistItem.company_id == access.company_id,
            ChecklistItem.project_id == project_id,
            ChecklistItem.level_id == level.id,
            ChecklistItem.task_id.is_(None),
        )
    )
    add_activity(
        db,
        access,
        "project_level.deleted",
        "project_level",
        level.id,
        {"name": level.name, "sector": level.building_name},
    )
    await db.delete(level)
    await commit_or_conflict(db, "No fue posible eliminar el nivel")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/projects/{project_id}/levels/{level_id}/checklist-template",
    response_model=list[ChecklistResponse],
)
async def initialize_level_checklist(
    project_id: str,
    level_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> list[ChecklistItem]:
    """Add only missing default controls for an older level, without duplicates."""

    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    level = await db.scalar(
        select(ProjectLevel).where(
            ProjectLevel.id == level_id,
            ProjectLevel.project_id == project_id,
        )
    )
    if level is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nivel no encontrado")
    existing_stages = set(
        (
            await db.scalars(
                select(ChecklistItem.process_stage).where(
                    ChecklistItem.company_id == access.company_id,
                    ChecklistItem.project_id == project_id,
                    ChecklistItem.level_id == level_id,
                )
            )
        ).all()
    )
    created = [
        ChecklistItem(
            company_id=access.company_id,
            project_id=project_id,
            level_id=level_id,
            title=title,
            process_stage=stage,
            status="pending",
        )
        for title, stage in DEFAULT_LEVEL_CHECKLIST
        if stage not in existing_stages
    ]
    if created:
        db.add_all(created)
        add_activity(
            db,
            access,
            "project_level.checklist_initialized",
            "project_level",
            level_id,
            {"created": len(created)},
        )
        await commit_or_conflict(db, "No fue posible crear el checklist del nivel")
    result = await db.execute(
        select(ChecklistItem)
        .where(
            ChecklistItem.company_id == access.company_id,
            ChecklistItem.project_id == project_id,
            ChecklistItem.level_id == level_id,
        )
        .order_by(ChecklistItem.created_at, ChecklistItem.title)
    )
    return list(result.scalars())


@router.get("/projects/{project_id}/tasks", response_model=TaskListResponse)
async def list_tasks(
    project_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    task_status: str | None = Query(default=None, alias="status"),
    task_type: str | None = Query(default=None),
    assigned_user_id: str | None = Query(default=None),
    level_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> TaskListResponse:
    await require_project(db, access.company_id, project_id)
    filters = [Task.company_id == access.company_id, Task.project_id == project_id]
    if task_status:
        filters.append(Task.status == task_status)
    if task_type:
        filters.append(Task.task_type == task_type)
    if assigned_user_id:
        filters.append(Task.assigned_user_id == assigned_user_id)
    if level_id:
        filters.append(Task.level_id == level_id)

    total = await db.scalar(select(func.count()).select_from(Task).where(*filters))
    result = await db.execute(
        select(Task)
        .where(*filters)
        .order_by(
            Task.planned_start_at.is_(None),
            Task.planned_start_at,
            Task.due_at.is_(None),
            Task.due_at,
            Task.created_at.desc(),
        )
        .limit(limit)
        .offset(offset)
    )
    return TaskListResponse(
        items=[TaskResponse.model_validate(task) for task in result.scalars()],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/projects/{project_id}/tasks",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_task(
    project_id: str,
    payload: TaskCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Task:
    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    await require_level(db, project_id, payload.level_id)
    await require_assignee(db, access.company_id, payload.assigned_user_id)
    template = await require_task_template(db, access.company_id, payload.template_id)
    values = payload.model_dump(exclude={"template_id", "inventory_item_ids"})
    task = Task(
        company_id=access.company_id,
        project_id=project_id,
        created_by_user_id=access.user.id,
        template_id=template.id if template else None,
        **values,
    )
    if task.status == "completed":
        task.completed_at = datetime.now(UTC).replace(tzinfo=None)
    db.add(task)
    await flush_or_conflict(db, "No fue posible crear la tarea")
    # A task can require several tools/machines.  The resources are created in
    # the same database transaction as the task, including any relocations, so
    # a transport request never loses the identity of the equipment involved.
    from app.api.routes.alerts import (
        create_relocation_if_needed,
        derive_availability,
        needs_relocation,
        require_inventory_item,
    )

    template_requirements: list[TaskTemplateRequirement] = []
    template_checklist: list[TaskTemplateChecklistItem] = []
    if template is not None:
        template_requirements = list(
            (
                await db.execute(
                    select(TaskTemplateRequirement)
                    .where(TaskTemplateRequirement.template_id == template.id)
                    .order_by(
                        TaskTemplateRequirement.sort_order,
                        TaskTemplateRequirement.description,
                    )
                )
            ).scalars()
        )
        template_checklist = list(
            (
                await db.execute(
                    select(TaskTemplateChecklistItem)
                    .where(TaskTemplateChecklistItem.template_id == template.id)
                    .order_by(TaskTemplateChecklistItem.sort_order, TaskTemplateChecklistItem.title)
                )
            ).scalars()
        )

    seen_inventory_ids = {
        requirement.inventory_item_id
        for requirement in template_requirements
        if requirement.inventory_item_id
    }
    resource_specs: list[tuple[str | None, str, Decimal, str]] = [
        (
            requirement.inventory_item_id,
            requirement.description,
            requirement.required_quantity,
            requirement.unit,
        )
        for requirement in template_requirements
    ]
    for item_id in dict.fromkeys(payload.inventory_item_ids):
        if item_id in seen_inventory_ids:
            continue
        item = await require_inventory_item(db, access.company_id, item_id)
        assert item is not None
        resource_specs.append((item.id, item.name, Decimal("1"), item.unit))
        seen_inventory_ids.add(item.id)

    resolved_resources = []
    relocation_required = False
    for item_id, description, quantity, unit in resource_specs:
        item = await require_inventory_item(db, access.company_id, item_id)
        resolved_resources.append((item, description, quantity, unit))
        relocation_required = relocation_required or needs_relocation(item, project_id)
    if relocation_required:
        await require_assignee(db, access.company_id, task.assigned_user_id)

    requirements: list[TaskMaterialRequirement] = []
    for item, description, quantity, unit in resolved_resources:
        requirement = TaskMaterialRequirement(
            task_id=task.id,
            inventory_item_id=item.id if item else None,
            description=description,
            required_quantity=quantity,
            unit=unit,
            availability_status=(
                derive_availability(item, project_id, quantity) if item else "unchecked"
            ),
        )
        db.add(requirement)
        requirements.append(requirement)
        await create_relocation_if_needed(
            db,
            company_id=access.company_id,
            project_id=project_id,
            task_id=task.id,
            item=item,
            assignee_id=task.assigned_user_id,
            requested_by_user_id=access.user.id,
        )

    for item in template_checklist:
        db.add(
            ChecklistItem(
                company_id=access.company_id,
                project_id=project_id,
                task_id=task.id,
                title=item.title,
                description=item.description,
                status="pending",
            )
        )
    add_activity(
        db,
        access,
        "task.created",
        "task",
        task.id,
        {
            "template_id": template.id if template else None,
            "resources": len(requirements),
            "checklist_items": len(template_checklist),
        },
    )
    await commit_or_conflict(db, "No fue posible crear la tarea")
    await db.refresh(task)
    return task


@router.patch("/projects/{project_id}/tasks/{task_id}", response_model=TaskResponse)
async def update_task(
    project_id: str,
    task_id: str,
    payload: TaskPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Task:
    await require_project(db, access.company_id, project_id)
    task = await require_task(db, access.company_id, project_id, task_id)

    changes = payload.model_dump(exclude_unset=True)
    if access.role not in WORK_EDITOR_ROLES:
        is_assignee = task.assigned_user_id == access.user.id
        allowed_self_update = (
            access.role in SELF_TASK_ROLES
            and is_assignee
            and set(changes) == {"status"}
            and changes["status"] in SELF_TASK_STATUSES
        )
        if not allowed_self_update:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo puede actualizar el estado de una tarea asignada a usted",
            )

    if "level_id" in changes:
        await require_level(db, project_id, changes["level_id"])
    if "assigned_user_id" in changes:
        await require_assignee(db, access.company_id, changes["assigned_user_id"])
    final_start = changes.get("planned_start_at", task.planned_start_at)
    final_due = changes.get("due_at", task.due_at)
    if final_start and final_due and final_due < final_start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La fecha límite no puede ser anterior al inicio planificado",
        )
    if changes.get("status") == "completed" and task.status != "completed":
        task.completed_at = datetime.now(UTC).replace(tzinfo=None)
    elif "status" in changes and changes["status"] != "completed":
        task.completed_at = None
    for field, value in changes.items():
        setattr(task, field, value)
    add_activity(db, access, "task.updated", "task", task.id, changes)
    await commit_or_conflict(db, "No fue posible actualizar la tarea")
    await db.refresh(task)
    return task


@router.delete(
    "/projects/{project_id}/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_task(
    project_id: str,
    task_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    """Delete a task and its dependent controls, keeping no uploaded evidence behind."""

    require_role(access, WORK_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    task = await require_task(db, access.company_id, project_id, task_id)
    active_relocations = (
        await db.execute(
            select(InventoryRelocationRequest, InventoryItem)
            .join(
                InventoryItem,
                InventoryItem.id == InventoryRelocationRequest.inventory_item_id,
            )
            .where(
                InventoryRelocationRequest.company_id == access.company_id,
                InventoryRelocationRequest.task_id == task.id,
                InventoryRelocationRequest.status.in_(("pending", "in_transit")),
            )
        )
    ).all()
    if any(relocation.status == "in_transit" for relocation, _ in active_relocations):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No se puede eliminar la tarea mientras un equipo está en traslado",
        )
    current = datetime.now(UTC).replace(tzinfo=None)
    for relocation, item in active_relocations:
        relocation.status = "cancelled"
        relocation.cancelled_at = current
        item.current_project_id = relocation.from_project_id
        if item.status == "relocation_pending":
            item.status = "assigned" if relocation.from_project_id else "available"
    evidence_keys = list(
        (
            await db.execute(
                select(ChecklistEvidence.storage_key).where(
                    ChecklistEvidence.company_id == access.company_id,
                    ChecklistEvidence.project_id == project_id,
                    ChecklistEvidence.task_id == task.id,
                    ChecklistEvidence.storage_key.is_not(None),
                )
            )
        ).scalars()
    )
    add_activity(
        db,
        access,
        "task.deleted",
        "task",
        task.id,
        {
            "title": task.title,
            "evidence_count": len(evidence_keys),
            "cancelled_relocations": len(active_relocations),
        },
    )
    await db.delete(task)
    await commit_or_conflict(db, "No fue posible eliminar la tarea")
    for storage_key in set(evidence_keys):
        await remove_stored_file(storage_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
