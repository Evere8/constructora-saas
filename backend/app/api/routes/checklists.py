from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.routes.operations import (
    WORK_EDITOR_ROLES,
    add_activity,
    commit_or_conflict,
    flush_or_conflict,
    require_assignee,
    require_project,
    require_role,
)
from app.api.schemas.checklists import (
    ChecklistCreate,
    ChecklistListResponse,
    ChecklistPatch,
    ChecklistProgressResponse,
    ChecklistResponse,
)
from app.db.models import ChecklistItem

router = APIRouter()

SELF_CHECKLIST_ROLES = {"worker", "transport"}
SELF_CHECKLIST_STATUSES = {"in_progress", "blocked", "completed"}


@router.get("/projects/{project_id}/checklist", response_model=ChecklistListResponse)
async def list_checklist(
    project_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
    checklist_status: str | None = Query(default=None, alias="status"),
    process_stage: str | None = Query(default=None, max_length=80),
    assigned_user_id: str | None = Query(default=None),
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
    project_id: str, access: CurrentCompanyAccess, db: DbSession
) -> ChecklistProgressResponse:
    await require_project(db, access.company_id, project_id)
    result = await db.execute(
        select(ChecklistItem.status, func.count(ChecklistItem.id))
        .where(
            ChecklistItem.company_id == access.company_id,
            ChecklistItem.project_id == project_id,
        )
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
    await require_assignee(db, access.company_id, payload.assigned_user_id)
    item = ChecklistItem(
        company_id=access.company_id,
        project_id=project_id,
        **payload.model_dump(),
    )
    if item.status == "completed":
        item.completed_at = datetime.now(UTC).replace(tzinfo=None)
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
    result = await db.execute(
        select(ChecklistItem).where(
            ChecklistItem.id == item_id,
            ChecklistItem.company_id == access.company_id,
            ChecklistItem.project_id == project_id,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Punto de control no encontrado",
        )

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
    if changes.get("status") == "completed" and item.status != "completed":
        item.completed_at = datetime.now(UTC).replace(tzinfo=None)
    elif "status" in changes and changes["status"] != "completed":
        item.completed_at = None
    for field, value in changes.items():
        setattr(item, field, value)
    add_activity(db, access, "checklist.updated", "checklist_item", item.id, changes)
    await commit_or_conflict(db, "No fue posible actualizar el punto de control")
    await db.refresh(item)
    return item
