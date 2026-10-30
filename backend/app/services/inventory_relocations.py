"""Transactional state changes shared by inventory and task workflows."""

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select

from app.api.dependencies import DbSession
from app.db.models import InventoryItem, InventoryMovement, InventoryRelocationRequest, Task
from app.services.operational_alerts import refresh_linked_requirement_availability

ACTIVE_STATUSES = ("pending", "in_transit")


async def relocation_entities(
    db: DbSession,
    company_id: str,
    relocation: InventoryRelocationRequest,
) -> tuple[InventoryItem, Task]:
    item = await db.scalar(
        select(InventoryItem).where(
            InventoryItem.id == relocation.inventory_item_id,
            InventoryItem.company_id == company_id,
        )
    )
    task = await db.scalar(
        select(Task).where(Task.id == relocation.task_id, Task.company_id == company_id)
    )
    if item is None:
        raise HTTPException(status_code=404, detail="La herramienta vinculada ya no existe")
    if task is None:
        raise HTTPException(status_code=404, detail="La tarea vinculada ya no existe")
    return item, task


async def start_relocation(
    db: DbSession,
    company_id: str,
    relocation: InventoryRelocationRequest,
) -> tuple[InventoryItem, Task]:
    if relocation.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La reubicación ya fue iniciada, completada o cancelada",
        )
    item, task = await relocation_entities(db, company_id, relocation)
    relocation.status = "in_transit"
    relocation.started_at = datetime.now(UTC).replace(tzinfo=None)
    item.status = "in_transit"
    if task.task_type == "transport":
        task.status = "in_progress"
        task.custom_status_label = None
    await db.flush()
    return item, task


async def complete_relocation(
    db: DbSession,
    company_id: str,
    relocation: InventoryRelocationRequest,
    *,
    actor_user_id: str,
) -> tuple[InventoryItem, Task, InventoryMovement]:
    if relocation.status not in ACTIVE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La reubicación ya fue completada o cancelada",
        )
    item, task = await relocation_entities(db, company_id, relocation)
    current = datetime.now(UTC).replace(tzinfo=None)
    movement = InventoryMovement(
        company_id=company_id,
        item_id=item.id,
        from_project_id=relocation.from_project_id,
        to_project_id=relocation.to_project_id,
        quantity=item.quantity,
        notes=relocation.notes or f"Reubicación para tarea: {task.title}",
        moved_by_user_id=actor_user_id,
        moved_at=current,
    )
    db.add(movement)
    relocation.status = "completed"
    relocation.completed_at = current
    item.current_project_id = relocation.to_project_id
    item.status = "assigned" if relocation.to_project_id else "available"
    if task.task_type == "transport":
        task.status = "completed"
        task.custom_status_label = None
        task.completed_at = current
    await refresh_linked_requirement_availability(db, company_id)
    await db.flush()
    return item, task, movement


async def cancel_relocation(
    db: DbSession,
    company_id: str,
    relocation: InventoryRelocationRequest,
) -> tuple[InventoryItem, Task]:
    if relocation.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Solo se puede cancelar una reubicación que aún no inició",
        )
    item, task = await relocation_entities(db, company_id, relocation)
    relocation.status = "cancelled"
    relocation.cancelled_at = datetime.now(UTC).replace(tzinfo=None)
    item.current_project_id = relocation.from_project_id
    item.status = "assigned" if relocation.from_project_id else "available"
    if task.task_type == "transport":
        task.status = "cancelled"
        task.custom_status_label = None
        task.completed_at = None
    await refresh_linked_requirement_availability(db, company_id)
    await db.flush()
    return item, task
