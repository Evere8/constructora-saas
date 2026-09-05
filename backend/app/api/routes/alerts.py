from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.routes.operations import (
    WORK_EDITOR_ROLES,
    add_activity,
    commit_or_conflict,
    require_project,
    require_role,
    require_task,
)
from app.api.schemas.alerts import (
    NotificationListResponse,
    NotificationPatch,
    NotificationResponse,
    TaskRequirementCreate,
    TaskRequirementPatch,
    TaskRequirementResponse,
)
from app.db.models import (
    InventoryItem,
    Notification,
    NotificationReceipt,
    TaskMaterialRequirement,
)
from app.services.operational_alerts import (
    derive_requirement_availability,
    sync_company_alerts,
)

router = APIRouter()
REQUIREMENT_EDITOR_ROLES = WORK_EDITOR_ROLES | {"warehouse"}
ASSIGNMENT_SCOPED_ROLES = {"worker", "transport"}


async def require_inventory_item(
    db: DbSession, company_id: str, item_id: str | None
) -> InventoryItem | None:
    if item_id is None:
        return None
    item = await db.scalar(
        select(InventoryItem).where(
            InventoryItem.id == item_id,
            InventoryItem.company_id == company_id,
        )
    )
    if item is None:
        raise HTTPException(status_code=422, detail="El recurso no pertenece a la constructora")
    return item


def derive_availability(
    item: InventoryItem | None,
    project_id: str,
    required_quantity: Decimal,
) -> str:
    return derive_requirement_availability(item, project_id, required_quantity)


def requirement_response(
    requirement: TaskMaterialRequirement,
    item: InventoryItem | None = None,
) -> TaskRequirementResponse:
    return TaskRequirementResponse(
        id=requirement.id,
        task_id=requirement.task_id,
        inventory_item_id=requirement.inventory_item_id,
        description=requirement.description,
        required_quantity=requirement.required_quantity,
        unit=requirement.unit,
        availability_status=requirement.availability_status,
        inventory_code=item.code if item else None,
        inventory_name=item.name if item else None,
    )


@router.get(
    "/projects/{project_id}/tasks/{task_id}/requirements",
    response_model=list[TaskRequirementResponse],
)
async def list_requirements(
    project_id: str,
    task_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> list[TaskRequirementResponse]:
    await require_task(db, access.company_id, project_id, task_id)
    rows = (
        await db.execute(
            select(TaskMaterialRequirement, InventoryItem)
            .outerjoin(InventoryItem, InventoryItem.id == TaskMaterialRequirement.inventory_item_id)
            .where(TaskMaterialRequirement.task_id == task_id)
            .order_by(TaskMaterialRequirement.description)
        )
    ).all()
    return [requirement_response(requirement, item) for requirement, item in rows]


@router.post(
    "/projects/{project_id}/tasks/{task_id}/requirements",
    response_model=TaskRequirementResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_requirement(
    project_id: str,
    task_id: str,
    payload: TaskRequirementCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> TaskRequirementResponse:
    require_role(access, REQUIREMENT_EDITOR_ROLES)
    await require_project(db, access.company_id, project_id)
    await require_task(db, access.company_id, project_id, task_id)
    item = await require_inventory_item(db, access.company_id, payload.inventory_item_id)
    values = payload.model_dump(exclude={"availability_status"})
    availability = payload.availability_status or derive_availability(
        item, project_id, payload.required_quantity
    )
    requirement = TaskMaterialRequirement(
        task_id=task_id,
        availability_status=availability,
        **values,
    )
    db.add(requirement)
    await db.flush()
    add_activity(
        db,
        access,
        "task.requirement.created",
        "task_material_requirement",
        requirement.id,
        {"task_id": task_id, "availability_status": availability},
    )
    await commit_or_conflict(db, "No fue posible agregar el recurso")
    await db.refresh(requirement)
    return requirement_response(requirement, item)


@router.patch(
    "/projects/{project_id}/tasks/{task_id}/requirements/{requirement_id}",
    response_model=TaskRequirementResponse,
)
async def update_requirement(
    project_id: str,
    task_id: str,
    requirement_id: str,
    payload: TaskRequirementPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> TaskRequirementResponse:
    require_role(access, REQUIREMENT_EDITOR_ROLES)
    await require_task(db, access.company_id, project_id, task_id)
    requirement = await db.scalar(
        select(TaskMaterialRequirement).where(
            TaskMaterialRequirement.id == requirement_id,
            TaskMaterialRequirement.task_id == task_id,
        )
    )
    if requirement is None:
        raise HTTPException(status_code=404, detail="Recurso requerido no encontrado")
    changes = payload.model_dump(exclude_unset=True)
    item_id = changes.get("inventory_item_id", requirement.inventory_item_id)
    item = await require_inventory_item(db, access.company_id, item_id)
    for field, value in changes.items():
        setattr(requirement, field, value)
    if "availability_status" not in changes:
        requirement.availability_status = derive_availability(
            item, project_id, requirement.required_quantity
        )
    add_activity(
        db,
        access,
        "task.requirement.updated",
        "task_material_requirement",
        requirement.id,
        changes,
    )
    await commit_or_conflict(db, "No fue posible actualizar el recurso")
    await db.refresh(requirement)
    return requirement_response(requirement, item)


@router.delete(
    "/projects/{project_id}/tasks/{task_id}/requirements/{requirement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_requirement(
    project_id: str,
    task_id: str,
    requirement_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    require_role(access, REQUIREMENT_EDITOR_ROLES)
    await require_task(db, access.company_id, project_id, task_id)
    requirement = await db.scalar(
        select(TaskMaterialRequirement).where(
            TaskMaterialRequirement.id == requirement_id,
            TaskMaterialRequirement.task_id == task_id,
        )
    )
    if requirement is None:
        raise HTTPException(status_code=404, detail="Recurso requerido no encontrado")
    await db.delete(requirement)
    add_activity(
        db,
        access,
        "task.requirement.deleted",
        "task_material_requirement",
        requirement_id,
        {"task_id": task_id},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def notification_response(
    notification: Notification,
    receipt_status: str | None,
) -> NotificationResponse:
    return NotificationResponse(
        id=notification.id,
        company_id=notification.company_id,
        project_id=notification.project_id,
        task_id=notification.task_id,
        checklist_item_id=notification.checklist_item_id,
        requirement_id=notification.requirement_id,
        alert_type=notification.alert_type,
        severity=notification.severity,
        title=notification.title,
        message=notification.message,
        due_at=notification.due_at,
        status=receipt_status or "unread",
        created_at=notification.created_at,
    )


def apply_notification_visibility(statement, access: CurrentCompanyAccess):
    if access.role in ASSIGNMENT_SCOPED_ROLES:
        return statement.where(Notification.assigned_user_id == access.user.id)
    return statement


@router.get("/notifications", response_model=NotificationListResponse)
async def list_notifications(
    access: CurrentCompanyAccess,
    db: DbSession,
) -> NotificationListResponse:
    try:
        await sync_company_alerts(db, access.company_id)
        await db.commit()
    except IntegrityError:
        await db.rollback()

    statement = (
        select(Notification, NotificationReceipt.status)
        .outerjoin(
            NotificationReceipt,
            and_(
                NotificationReceipt.notification_id == Notification.id,
                NotificationReceipt.user_id == access.user.id,
            ),
        )
        .where(
            Notification.company_id == access.company_id,
            Notification.resolved_at.is_(None),
        )
        .order_by(
            Notification.due_at.is_(None),
            Notification.due_at,
            Notification.created_at.desc(),
        )
    )
    rows = (await db.execute(apply_notification_visibility(statement, access))).all()
    items = [
        notification_response(notification, receipt_status) for notification, receipt_status in rows
    ]
    visible = [item for item in items if item.status != "dismissed"]
    return NotificationListResponse(
        items=visible,
        unread_count=sum(item.status == "unread" for item in visible),
    )


@router.patch("/notifications/{notification_id}", response_model=NotificationResponse)
async def update_notification(
    notification_id: str,
    payload: NotificationPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> NotificationResponse:
    statement = select(Notification).where(
        Notification.id == notification_id,
        Notification.company_id == access.company_id,
        Notification.resolved_at.is_(None),
    )
    notification = await db.scalar(apply_notification_visibility(statement, access))
    if notification is None:
        raise HTTPException(status_code=404, detail="Alerta no encontrada")
    receipt = await db.scalar(
        select(NotificationReceipt).where(
            NotificationReceipt.notification_id == notification.id,
            NotificationReceipt.user_id == access.user.id,
        )
    )
    current = datetime.now(UTC).replace(tzinfo=None)
    if receipt is None:
        receipt = NotificationReceipt(
            notification_id=notification.id,
            user_id=access.user.id,
            status=payload.status,
            read_at=current if payload.status != "unread" else None,
        )
        db.add(receipt)
    else:
        receipt.status = payload.status
        receipt.read_at = current if payload.status != "unread" else None
    await db.commit()
    return notification_response(notification, receipt.status)
