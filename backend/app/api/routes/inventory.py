from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import aliased

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.routes.operations import (
    add_activity,
    commit_or_conflict,
    flush_or_conflict,
    require_assignee,
    require_project,
    require_role,
)
from app.api.schemas.modules import (
    InventoryItemCreate,
    InventoryItemPatch,
    InventoryItemResponse,
    InventoryMovementCreate,
    InventoryMovementResponse,
    InventoryRelocationCreate,
    InventoryRelocationRequestResponse,
)
from app.db.models import (
    AppUser,
    InventoryItem,
    InventoryMovement,
    InventoryRelocationRequest,
    Project,
    Task,
)
from app.services.inventory_relocations import (
    cancel_relocation,
    complete_relocation,
    start_relocation,
)
from app.services.operational_alerts import (
    refresh_linked_requirement_availability,
    sync_company_alerts,
)
from app.services.push_notifications import send_push_to_user

router = APIRouter()

INVENTORY_EDITOR_ROLES = {"platform_admin", "owner", "admin", "warehouse"}
MOVEMENT_MANAGER_ROLES = {"platform_admin", "owner", "admin"}
ACTIVE_RELOCATION_STATUSES = ("pending", "in_transit")


async def require_item(
    db: DbSession,
    company_id: str,
    item_id: str,
    *,
    for_update: bool = False,
) -> InventoryItem:
    statement = select(InventoryItem).where(
        InventoryItem.id == item_id, InventoryItem.company_id == company_id
    )
    if for_update:
        statement = statement.with_for_update()
    item = await db.scalar(statement)
    if item is None:
        raise HTTPException(status_code=404, detail="Herramienta o material no encontrado")
    return item


async def require_relocation(
    db: DbSession,
    company_id: str,
    relocation_id: str,
    *,
    for_update: bool = False,
) -> InventoryRelocationRequest:
    statement = select(InventoryRelocationRequest).where(
        InventoryRelocationRequest.id == relocation_id,
        InventoryRelocationRequest.company_id == company_id,
    )
    if for_update:
        statement = statement.with_for_update()
    relocation = await db.scalar(statement)
    if relocation is None:
        raise HTTPException(status_code=404, detail="Solicitud de reubicación no encontrada")
    return relocation


def require_relocation_actor(
    access: CurrentCompanyAccess,
    relocation: InventoryRelocationRequest,
) -> None:
    # Task-linked relocation has its own workflow and assignee checks; it is
    # independent of the permission to close the company's daily inventory.
    if access.role in MOVEMENT_MANAGER_ROLES or access.can_register_inventory_day:
        return
    if relocation.assigned_user_id == access.user.id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Solo el responsable asignado puede actualizar esta reubicación",
    )


def require_movement_manager(access: CurrentCompanyAccess) -> None:
    if access.role in MOVEMENT_MANAGER_ROLES or access.can_register_inventory_day:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="El administrador debe habilitarle Registrar movimientos diarios",
    )


def relocation_response(
    relocation: InventoryRelocationRequest,
    item: InventoryItem,
    task: Task,
    from_project_name: str | None,
    to_project_name: str | None,
    assigned_full_name: str | None,
    assigned_email: str | None,
) -> InventoryRelocationRequestResponse:
    return InventoryRelocationRequestResponse(
        id=relocation.id,
        company_id=relocation.company_id,
        task_id=relocation.task_id,
        inventory_item_id=relocation.inventory_item_id,
        from_project_id=relocation.from_project_id,
        to_project_id=relocation.to_project_id,
        assigned_user_id=relocation.assigned_user_id,
        requested_by_user_id=relocation.requested_by_user_id,
        status=relocation.status,
        notes=relocation.notes,
        started_at=relocation.started_at,
        completed_at=relocation.completed_at,
        cancelled_at=relocation.cancelled_at,
        created_at=relocation.created_at,
        updated_at=relocation.updated_at,
        inventory_code=item.code,
        inventory_name=item.name,
        task_title=task.title,
        from_project_name=from_project_name,
        to_project_name=to_project_name,
        assigned_user_name=assigned_full_name or assigned_email,
    )


async def fetch_relocation_rows(
    db: DbSession,
    company_id: str,
    *,
    relocation_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    active_only: bool = True,
    assigned_user_id: str | None = None,
):
    from_project = aliased(Project)
    to_project = aliased(Project)
    assignee = aliased(AppUser)
    filters = [InventoryRelocationRequest.company_id == company_id]
    if relocation_id:
        filters.append(InventoryRelocationRequest.id == relocation_id)
    if project_id:
        # Both the origin and destination project need to see an active move.
        # This also keeps a return-to-warehouse visible in its origin project.
        filters.append(
            or_(
                InventoryRelocationRequest.to_project_id == project_id,
                InventoryRelocationRequest.from_project_id == project_id,
            )
        )
    if task_id:
        filters.append(InventoryRelocationRequest.task_id == task_id)
    if active_only:
        filters.append(InventoryRelocationRequest.status.in_(ACTIVE_RELOCATION_STATUSES))
    if assigned_user_id:
        filters.append(InventoryRelocationRequest.assigned_user_id == assigned_user_id)
    result = await db.execute(
        select(
            InventoryRelocationRequest,
            InventoryItem,
            Task,
            from_project.name,
            to_project.name,
            assignee.full_name,
            assignee.email,
        )
        .join(InventoryItem, InventoryItem.id == InventoryRelocationRequest.inventory_item_id)
        .join(Task, Task.id == InventoryRelocationRequest.task_id)
        .outerjoin(from_project, from_project.id == InventoryRelocationRequest.from_project_id)
        .outerjoin(to_project, to_project.id == InventoryRelocationRequest.to_project_id)
        .outerjoin(assignee, assignee.id == InventoryRelocationRequest.assigned_user_id)
        .where(*filters)
        .order_by(
            InventoryRelocationRequest.status,
            InventoryRelocationRequest.created_at.desc(),
        )
    )
    return result.all()


async def fetch_relocation_response(
    db: DbSession,
    company_id: str,
    relocation_id: str,
) -> InventoryRelocationRequestResponse:
    rows = await fetch_relocation_rows(
        db,
        company_id,
        relocation_id=relocation_id,
        active_only=False,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Solicitud de reubicación no encontrada")
    return relocation_response(*rows[0])


@router.get(
    "/inventory/relocations",
    response_model=list[InventoryRelocationRequestResponse],
)
async def list_inventory_relocations(
    access: CurrentCompanyAccess,
    db: DbSession,
    project_id: str | None = Query(default=None),
    task_id: str | None = Query(default=None),
    active_only: bool = Query(default=True),
) -> list[InventoryRelocationRequestResponse]:
    assigned_user_id = (
        None
        if access.role in MOVEMENT_MANAGER_ROLES or access.can_register_inventory_day
        else access.user.id
    )
    rows = await fetch_relocation_rows(
        db,
        access.company_id,
        project_id=project_id,
        task_id=task_id,
        active_only=active_only,
        assigned_user_id=assigned_user_id,
    )
    return [relocation_response(*row) for row in rows]


@router.post(
    "/inventory/relocations",
    response_model=InventoryRelocationRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def request_inventory_relocation(
    payload: InventoryRelocationCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> InventoryRelocationRequestResponse:
    require_movement_manager(access)
    item = await require_item(
        db,
        access.company_id,
        payload.inventory_item_id,
        for_update=True,
    )
    destination = (
        await require_project(db, access.company_id, payload.to_project_id)
        if payload.to_project_id
        else None
    )
    if destination is not None and destination.status != "active":
        raise HTTPException(status_code=422, detail="El destino debe ser una obra activa")
    await require_assignee(db, access.company_id, payload.assigned_user_id)
    if item.current_project_id == (destination.id if destination else None):
        raise HTTPException(
            status_code=422,
            detail="La herramienta ya se encuentra en el Depósito"
            if destination is None
            else "La herramienta ya está en esa obra",
        )
    if item.status in {"maintenance", "retired", "relocation_pending", "in_transit"}:
        raise HTTPException(
            status_code=409,
            detail="La herramienta no está disponible para una nueva reubicación",
        )
    existing = await db.scalar(
        select(InventoryRelocationRequest.id).where(
            InventoryRelocationRequest.company_id == access.company_id,
            InventoryRelocationRequest.inventory_item_id == item.id,
            InventoryRelocationRequest.status.in_(ACTIVE_RELOCATION_STATUSES),
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="La herramienta ya tiene un traslado activo")
    # Tasks always belong to a project.  For a return to the warehouse, retain
    # the origin project as the task context while the actual destination is
    # represented by a null relocation destination.
    task_project_id = destination.id if destination is not None else item.current_project_id
    if task_project_id is None:
        raise HTTPException(
            status_code=422,
            detail="La herramienta ya se encuentra en el Depósito",
        )
    destination_name = destination.name if destination is not None else "Depósito"
    task = Task(
        company_id=access.company_id,
        project_id=task_project_id,
        task_type="transport",
        title=f"Reubicar {item.name} a {destination_name}",
        description=(
            f"Trasladar {item.code} · {item.name} desde su ubicación actual a "
            f"{destination_name}. La ubicación cambia al marcar la tarea como terminada."
        ),
        status="pending",
        priority="normal",
        assigned_user_id=payload.assigned_user_id,
        location_text=destination_name,
        created_by_user_id=access.user.id,
    )
    db.add(task)
    await flush_or_conflict(db, "No se pudo crear la tarea de reubicación")
    relocation = InventoryRelocationRequest(
        company_id=access.company_id,
        task_id=task.id,
        inventory_item_id=item.id,
        from_project_id=item.current_project_id,
        to_project_id=destination.id if destination is not None else None,
        assigned_user_id=payload.assigned_user_id,
        requested_by_user_id=access.user.id,
        status="pending",
        notes=payload.notes,
    )
    db.add(relocation)
    item.status = "relocation_pending"
    await flush_or_conflict(db, "No se pudo solicitar la reubicación")
    await sync_company_alerts(db, access.company_id)
    add_activity(
        db,
        access,
        "inventory.relocation.requested",
        "inventory_relocation_request",
        relocation.id,
        {
            "item_id": item.id,
            "task_id": task.id,
            "to_project_id": destination.id if destination is not None else None,
        },
    )
    await commit_or_conflict(db, "No se pudo solicitar la reubicación")
    await send_push_to_user(
        db,
        access.company_id,
        task.assigned_user_id,
        {
            "title": "Traslado asignado",
            "body": task.title,
            "url": "/tareas",
            "task_id": task.id,
            "project_id": task.project_id,
            "actions": ["received", "in_progress"],
        },
    )
    return await fetch_relocation_response(db, access.company_id, relocation.id)


@router.get("/inventory", response_model=list[InventoryItemResponse])
async def list_inventory(
    access: CurrentCompanyAccess,
    db: DbSession,
    item_type: str | None = Query(default=None),
    item_status: str | None = Query(default=None, alias="status"),
    project_id: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=120),
    include_retired: bool = Query(default=False),
) -> list[InventoryItem]:
    filters = [InventoryItem.company_id == access.company_id]
    if item_type:
        filters.append(InventoryItem.item_type == item_type)
    if item_status:
        filters.append(InventoryItem.status == item_status)
    elif not include_retired:
        # A deleted item is retired instead of destroying movement and task
        # history.  Normal operational views must not keep showing it.
        filters.append(InventoryItem.status != "retired")
    if project_id:
        filters.append(InventoryItem.current_project_id == project_id)
    if search and search.strip():
        term = f"%{search.strip()}%"
        filters.append(or_(InventoryItem.name.like(term), InventoryItem.code.like(term)))
    return list(
        (
            await db.execute(select(InventoryItem).where(*filters).order_by(InventoryItem.name))
        ).scalars()
    )


@router.post(
    "/inventory",
    response_model=InventoryItemResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_inventory_item(
    payload: InventoryItemCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> InventoryItem:
    require_role(access, INVENTORY_EDITOR_ROLES)
    if payload.status in {"relocation_pending", "in_transit"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El estado de traslado se crea desde una tarea, no al registrar el equipo",
        )
    if payload.current_project_id:
        await require_project(db, access.company_id, payload.current_project_id)
    item = InventoryItem(company_id=access.company_id, **payload.model_dump())
    db.add(item)
    await flush_or_conflict(db, "Ya existe un elemento con ese código")
    add_activity(db, access, "inventory.created", "inventory_item", item.id)
    await commit_or_conflict(db, "Ya existe un elemento con ese código")
    await db.refresh(item)
    return item


@router.patch("/inventory/{item_id}", response_model=InventoryItemResponse)
async def update_inventory_item(
    item_id: str,
    payload: InventoryItemPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> InventoryItem:
    require_role(access, INVENTORY_EDITOR_ROLES)
    item = await require_item(db, access.company_id, item_id, for_update=True)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("status") in {"relocation_pending", "in_transit"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El estado de traslado solo se actualiza desde la solicitud de reubicación",
        )
    if "current_project_id" in changes:
        raise HTTPException(
            status_code=422,
            detail="Registre los cambios de obra desde Movimientos diarios",
        )
    if "status" in changes:
        active_relocation = await db.scalar(
            select(InventoryRelocationRequest.id).where(
                InventoryRelocationRequest.company_id == access.company_id,
                InventoryRelocationRequest.inventory_item_id == item.id,
                InventoryRelocationRequest.status.in_(ACTIVE_RELOCATION_STATUSES),
            )
        )
        if active_relocation:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El equipo tiene una reubicación pendiente; actualícela desde el Resumen",
            )
    for field, value in changes.items():
        setattr(item, field, value)
    await refresh_linked_requirement_availability(db, access.company_id)
    add_activity(db, access, "inventory.updated", "inventory_item", item.id, changes)
    await commit_or_conflict(db, "No fue posible actualizar el elemento")
    await db.refresh(item)
    return item


@router.delete("/inventory/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def retire_inventory_item(
    item_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
):
    """Remove an item from available inventory without erasing audit history."""

    require_role(access, INVENTORY_EDITOR_ROLES)
    item = await require_item(db, access.company_id, item_id, for_update=True)
    active_relocation = await db.scalar(
        select(InventoryRelocationRequest.id).where(
            InventoryRelocationRequest.company_id == access.company_id,
            InventoryRelocationRequest.inventory_item_id == item.id,
            InventoryRelocationRequest.status.in_(ACTIVE_RELOCATION_STATUSES),
        )
    )
    if active_relocation:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se puede eliminar una herramienta con un traslado activo",
        )
    previous_project_id = item.current_project_id
    item.status = "retired"
    item.current_project_id = None
    await refresh_linked_requirement_availability(db, access.company_id)
    add_activity(
        db,
        access,
        "inventory.retired",
        "inventory_item",
        item.id,
        {"code": item.code, "name": item.name, "previous_project_id": previous_project_id},
    )
    await commit_or_conflict(db, "No fue posible eliminar el elemento")
    return None


@router.get("/inventory/movements", response_model=list[InventoryMovementResponse])
async def list_inventory_movements(
    access: CurrentCompanyAccess,
    db: DbSession,
    item_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
) -> list[InventoryMovement]:
    filters = [InventoryMovement.company_id == access.company_id]
    if item_id:
        filters.append(InventoryMovement.item_id == item_id)
    return list(
        (
            await db.execute(
                select(InventoryMovement)
                .where(*filters)
                .order_by(InventoryMovement.moved_at.desc())
                .limit(limit)
            )
        ).scalars()
    )


@router.post(
    "/inventory/movements",
    response_model=InventoryMovementResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_inventory_movement(
    payload: InventoryMovementCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> InventoryMovement:
    require_movement_manager(access)
    item = await require_item(db, access.company_id, payload.item_id, for_update=True)
    if item.status in {"relocation_pending", "in_transit"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El equipo tiene una reubicación activa; confírmela desde el Resumen",
        )
    if payload.quantity > item.quantity:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La cantidad del movimiento supera la existencia registrada",
        )
    if payload.to_project_id:
        await require_project(db, access.company_id, payload.to_project_id)
    movement = InventoryMovement(
        company_id=access.company_id,
        from_project_id=item.current_project_id,
        moved_by_user_id=access.user.id,
        **payload.model_dump(),
    )
    db.add(movement)
    if item.item_type in {"machine", "tool"}:
        item.current_project_id = payload.to_project_id
        item.status = "assigned" if payload.to_project_id else "available"
    await flush_or_conflict(db, "No fue posible registrar el movimiento")
    await refresh_linked_requirement_availability(db, access.company_id)
    add_activity(
        db,
        access,
        "inventory.moved",
        "inventory_movement",
        movement.id,
        {"item_id": item.id, "to_project_id": payload.to_project_id},
    )
    await commit_or_conflict(db, "No fue posible registrar el movimiento")
    await db.refresh(movement)
    return movement


@router.post(
    "/inventory/relocations/{relocation_id}/start",
    response_model=InventoryRelocationRequestResponse,
)
async def start_inventory_relocation(
    relocation_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> InventoryRelocationRequestResponse:
    relocation = await require_relocation(
        db, access.company_id, relocation_id, for_update=True
    )
    require_relocation_actor(access, relocation)
    item, _ = await start_relocation(db, access.company_id, relocation)
    add_activity(
        db,
        access,
        "inventory.relocation.started",
        "inventory_relocation_request",
        relocation.id,
        {"item_id": item.id, "task_id": relocation.task_id},
    )
    await commit_or_conflict(db, "No fue posible iniciar la reubicación")
    return await fetch_relocation_response(db, access.company_id, relocation.id)


@router.post(
    "/inventory/relocations/{relocation_id}/complete",
    response_model=InventoryRelocationRequestResponse,
)
async def complete_inventory_relocation(
    relocation_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> InventoryRelocationRequestResponse:
    relocation = await require_relocation(
        db, access.company_id, relocation_id, for_update=True
    )
    require_relocation_actor(access, relocation)
    item, _, _ = await complete_relocation(
        db, access.company_id, relocation, actor_user_id=access.user.id
    )
    add_activity(
        db,
        access,
        "inventory.relocation.completed",
        "inventory_relocation_request",
        relocation.id,
        {
            "item_id": item.id,
            "task_id": relocation.task_id,
            "to_project_id": relocation.to_project_id,
        },
    )
    await commit_or_conflict(db, "No fue posible confirmar la llegada del equipo")
    return await fetch_relocation_response(db, access.company_id, relocation.id)


@router.post(
    "/inventory/relocations/{relocation_id}/cancel",
    response_model=InventoryRelocationRequestResponse,
)
async def cancel_inventory_relocation(
    relocation_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> InventoryRelocationRequestResponse:
    relocation = await require_relocation(
        db, access.company_id, relocation_id, for_update=True
    )
    require_movement_manager(access)
    item, _ = await cancel_relocation(db, access.company_id, relocation)
    add_activity(
        db,
        access,
        "inventory.relocation.cancelled",
        "inventory_relocation_request",
        relocation.id,
        {"item_id": item.id, "task_id": relocation.task_id},
    )
    await commit_or_conflict(db, "No fue posible cancelar la reubicación")
    return await fetch_relocation_response(db, access.company_id, relocation.id)
