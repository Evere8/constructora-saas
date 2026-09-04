from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import or_, select

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.routes.operations import (
    add_activity,
    commit_or_conflict,
    flush_or_conflict,
    require_project,
    require_role,
)
from app.api.schemas.modules import (
    InventoryItemCreate,
    InventoryItemPatch,
    InventoryItemResponse,
    InventoryMovementCreate,
    InventoryMovementResponse,
)
from app.db.models import InventoryItem, InventoryMovement

router = APIRouter()

INVENTORY_EDITOR_ROLES = {"platform_admin", "owner", "admin", "warehouse"}
MOVEMENT_EDITOR_ROLES = INVENTORY_EDITOR_ROLES | {"engineer", "supervisor"}


async def require_item(db: DbSession, company_id: str, item_id: str) -> InventoryItem:
    item = await db.scalar(
        select(InventoryItem).where(
            InventoryItem.id == item_id, InventoryItem.company_id == company_id
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Herramienta o material no encontrado")
    return item


@router.get("/inventory", response_model=list[InventoryItemResponse])
async def list_inventory(
    access: CurrentCompanyAccess,
    db: DbSession,
    item_type: str | None = Query(default=None),
    item_status: str | None = Query(default=None, alias="status"),
    project_id: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=120),
) -> list[InventoryItem]:
    filters = [InventoryItem.company_id == access.company_id]
    if item_type:
        filters.append(InventoryItem.item_type == item_type)
    if item_status:
        filters.append(InventoryItem.status == item_status)
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
    item = await require_item(db, access.company_id, item_id)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("current_project_id"):
        await require_project(db, access.company_id, changes["current_project_id"])
    for field, value in changes.items():
        setattr(item, field, value)
    add_activity(db, access, "inventory.updated", "inventory_item", item.id, changes)
    await commit_or_conflict(db, "No fue posible actualizar el elemento")
    await db.refresh(item)
    return item


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
    require_role(access, MOVEMENT_EDITOR_ROLES)
    item = await require_item(db, access.company_id, payload.item_id)
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
