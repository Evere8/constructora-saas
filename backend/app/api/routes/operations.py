from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.schemas.operations import (
    LevelCreate,
    LevelPatch,
    LevelResponse,
    ProjectCreate,
    ProjectListResponse,
    ProjectPatch,
    ProjectResponse,
    TaskCreate,
    TaskListResponse,
    TaskPatch,
    TaskResponse,
)
from app.db.models import (
    ActivityLog,
    AppUser,
    CompanyMembership,
    Project,
    ProjectLevel,
    Task,
)

router = APIRouter()

PROJECT_EDITOR_ROLES = {"platform_admin", "owner", "admin", "engineer"}
WORK_EDITOR_ROLES = PROJECT_EDITOR_ROLES | {"supervisor"}
SELF_TASK_ROLES = {"worker", "transport"}
SELF_TASK_STATUSES = {"in_progress", "review", "completed"}


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
            metadata_json=metadata,
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
        .order_by(ProjectLevel.sort_order, ProjectLevel.name)
    )
    return list(result.scalars())


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
    level = ProjectLevel(project_id=project_id, **payload.model_dump())
    db.add(level)
    await flush_or_conflict(db, "Ya existe un nivel con ese nombre en la obra")
    add_activity(db, access, "project_level.created", "project_level", level.id)
    await commit_or_conflict(db, "Ya existe un nivel con ese nombre en la obra")
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
    for field, value in changes.items():
        setattr(level, field, value)
    add_activity(db, access, "project_level.updated", "project_level", level.id, changes)
    await commit_or_conflict(db, "Ya existe un nivel con ese nombre en la obra")
    await db.refresh(level)
    return level


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
    values = payload.model_dump()
    task = Task(
        company_id=access.company_id,
        project_id=project_id,
        created_by_user_id=access.user.id,
        **values,
    )
    if task.status == "completed":
        task.completed_at = datetime.now(UTC).replace(tzinfo=None)
    db.add(task)
    await flush_or_conflict(db, "No fue posible crear la tarea")
    add_activity(db, access, "task.created", "task", task.id)
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
