"""A same-day equipment ledger and immutable daily activity reports.

Never infer today's availability from yesterday's inventory. Draft activities can
be saved before equipment close, but remain unverified until a same-date snapshot.
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.routes.operations import (
    add_activity,
    commit_or_conflict,
    flush_or_conflict,
    require_project,
    require_role,
)
from app.api.schemas.daily_operations import (
    ActivityDefinitionInput,
    ActivityDefinitionResponse,
    DailyActivityInput,
    DailyActivityResponse,
    InventoryDayResponse,
    RegisterInventoryDay,
    RestockCreate,
    RestockResponse,
)
from app.db.models import (
    ActivityDefinition,
    Company,
    DailyActivityPlan,
    InventoryDaySnapshot,
    InventoryItem,
    InventoryMovement,
    InventoryRelocationRequest,
    InventoryRestockRequest,
    Project,
)
from app.services.operational_alerts import refresh_linked_requirement_availability

router = APIRouter()
LOCAL_ZONE = ZoneInfo("America/Asuncion")
EDIT_ROLES = {"owner", "admin", "engineer", "supervisor"}


def today() -> date:
    return datetime.now(LOCAL_ZONE).date()


def require_day_registrar(access: CurrentCompanyAccess) -> None:
    if access.role not in {"owner", "admin"} and not access.can_register_inventory_day:
        raise HTTPException(
            status_code=403,
            detail="El administrador debe habilitarle Registrar movimientos diarios",
        )


async def last_snapshot(
    db: DbSession, company_id: str, on_date: date
) -> InventoryDaySnapshot | None:
    return await db.scalar(
        select(InventoryDaySnapshot)
        .where(
            InventoryDaySnapshot.company_id == company_id,
            InventoryDaySnapshot.snapshot_date == on_date,
        )
        .order_by(InventoryDaySnapshot.revision.desc())
        .limit(1)
    )


def snapshot_response(snapshot: InventoryDaySnapshot) -> InventoryDayResponse:
    return InventoryDayResponse(
        id=snapshot.id,
        snapshot_date=snapshot.snapshot_date,
        revision=snapshot.revision,
        registered_at=snapshot.registered_at,
        registered_by_user_id=snapshot.registered_by_user_id,
        items=snapshot.items_json,
    )


@router.get("/inventory/days", response_model=list[InventoryDayResponse])
async def inventory_days(
    access: CurrentCompanyAccess, db: DbSession, limit: int = Query(default=30, ge=1, le=100)
):
    snapshots = (
        (
            await db.execute(
                select(InventoryDaySnapshot)
                .where(InventoryDaySnapshot.company_id == access.company_id)
                .order_by(
                    InventoryDaySnapshot.snapshot_date.desc(),
                    InventoryDaySnapshot.revision.desc(),
                )
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [snapshot_response(snapshot) for snapshot in snapshots]


@router.post("/inventory/days", response_model=InventoryDayResponse, status_code=201)
async def register_inventory_day(
    payload: RegisterInventoryDay, access: CurrentCompanyAccess, db: DbSession
):
    require_day_registrar(access)
    if payload.snapshot_date != today():
        raise HTTPException(
            status_code=422, detail="Solo puede registrar los movimientos del día de hoy"
        )
    assignments = {entry.item_id: entry for entry in payload.assignments}
    if len(assignments) != len(payload.assignments):
        raise HTTPException(status_code=422, detail="Hay herramientas duplicadas")
    # Serializes this batch against concurrent day closes. The optimistic source
    # check also rejects a stale browser tab after individual movements.
    await db.scalar(select(Company).where(Company.id == access.company_id).with_for_update())
    items = (
        (
            await db.execute(
                select(InventoryItem)
                .where(
                    InventoryItem.company_id == access.company_id,
                    InventoryItem.item_type.in_(("machine", "tool")),
                )
                .order_by(InventoryItem.id)
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    if set(assignments) != {item.id for item in items}:
        raise HTTPException(
            status_code=409, detail="Cambió el inventario; actualice el tablero antes de registrar"
        )
    active_projects = set(
        (
            await db.execute(
                select(Project.id).where(
                    Project.company_id == access.company_id, Project.status == "active"
                )
            )
        )
        .scalars()
        .all()
    )
    changed = []
    for item in items:
        entry = assignments[item.id]
        if item.current_project_id != entry.expected_project_id:
            raise HTTPException(
                status_code=409, detail=f"Cambió la ubicación de {item.name}; actualice el tablero"
            )
        if entry.to_project_id and entry.to_project_id not in active_projects:
            raise HTTPException(
                status_code=422, detail="El destino debe ser una obra activa de la constructora"
            )
        if item.current_project_id != entry.to_project_id:
            if item.status in {"relocation_pending", "in_transit", "maintenance", "retired"}:
                raise HTTPException(
                    status_code=409, detail=f"{item.name} no está disponible para mover"
                )
            pending = await db.scalar(
                select(InventoryRelocationRequest.id).where(
                    InventoryRelocationRequest.company_id == access.company_id,
                    InventoryRelocationRequest.inventory_item_id == item.id,
                    InventoryRelocationRequest.status.in_(("pending", "in_transit")),
                )
            )
            if pending:
                raise HTTPException(
                    status_code=409, detail=f"{item.name} tiene una reubicación pendiente"
                )
            db.add(
                InventoryMovement(
                    company_id=access.company_id,
                    item_id=item.id,
                    from_project_id=item.current_project_id,
                    to_project_id=entry.to_project_id,
                    quantity=item.quantity,
                    moved_by_user_id=access.user.id,
                    notes="Registro de movimientos diarios",
                )
            )
            item.current_project_id = entry.to_project_id
            item.status = "assigned" if entry.to_project_id else "available"
            changed.append(item.id)
    snapshot = InventoryDaySnapshot(
        company_id=access.company_id,
        snapshot_date=payload.snapshot_date,
        revision=1
        + (
            await db.scalar(
                select(func.max(InventoryDaySnapshot.revision)).where(
                    InventoryDaySnapshot.company_id == access.company_id,
                    InventoryDaySnapshot.snapshot_date == payload.snapshot_date,
                )
            )
            or 0
        ),
        registered_by_user_id=access.user.id,
        items_json=[
            {
                "item_id": item.id,
                "name": item.name,
                "code": item.code,
                "project_id": item.current_project_id,
                "quantity": str(item.quantity),
                "status": item.status,
            }
            for item in items
        ],
    )
    db.add(snapshot)
    await flush_or_conflict(db, "No fue posible preparar el registro diario")
    if changed:
        await refresh_linked_requirement_availability(db, access.company_id)
    add_activity(
        db,
        access,
        "inventory.day.registered",
        "inventory_day_snapshot",
        snapshot.id,
        {"changed_item_ids": changed},
    )
    await commit_or_conflict(db, "No fue posible registrar la jornada")
    await db.refresh(snapshot)
    return snapshot_response(snapshot)


@router.get("/inventory/restock-requests", response_model=list[RestockResponse])
async def list_restock_requests(access: CurrentCompanyAccess, db: DbSession):
    return (
        (
            await db.execute(
                select(InventoryRestockRequest)
                .where(InventoryRestockRequest.company_id == access.company_id)
                .order_by(InventoryRestockRequest.created_at.desc())
                .limit(100)
            )
        )
        .scalars()
        .all()
    )


@router.post("/inventory/restock-requests", response_model=RestockResponse, status_code=201)
async def create_restock_request(
    payload: RestockCreate, access: CurrentCompanyAccess, db: DbSession
):
    if payload.project_id:
        await require_project(db, access.company_id, payload.project_id)
    request = InventoryRestockRequest(
        company_id=access.company_id,
        project_id=payload.project_id,
        name=payload.name.strip(),
        quantity=payload.quantity,
        note=payload.note,
        requested_by_user_id=access.user.id,
    )
    db.add(request)
    await flush_or_conflict(db, "No fue posible preparar la solicitud")
    add_activity(db, access, "inventory.restock.requested", "inventory_restock_request", request.id)
    await commit_or_conflict(db, "No fue posible solicitar reposición")
    await db.refresh(request)
    return request


@router.patch("/inventory/restock-requests/{request_id}/fulfilled", response_model=RestockResponse)
async def fulfill_restock_request(request_id: str, access: CurrentCompanyAccess, db: DbSession):
    require_role(access, {"owner", "admin", "warehouse"})
    request = await db.scalar(
        select(InventoryRestockRequest).where(
            InventoryRestockRequest.company_id == access.company_id,
            InventoryRestockRequest.id == request_id,
        )
    )
    if request is None:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")
    request.status = "fulfilled"
    add_activity(db, access, "inventory.restock.fulfilled", "inventory_restock_request", request.id)
    await commit_or_conflict(db, "No fue posible cerrar la solicitud")
    return request


def definition_response(definition: ActivityDefinition) -> ActivityDefinitionResponse:
    return ActivityDefinitionResponse(
        id=definition.id,
        title=definition.title,
        is_active=definition.is_active,
        requirements=definition.requirements_json,
    )


@router.get("/activity-definitions", response_model=list[ActivityDefinitionResponse])
async def list_definitions(access: CurrentCompanyAccess, db: DbSession):
    definitions = (
        (
            await db.execute(
                select(ActivityDefinition)
                .where(
                    ActivityDefinition.company_id == access.company_id,
                    ActivityDefinition.is_active.is_(True),
                )
                .order_by(ActivityDefinition.title)
            )
        )
        .scalars()
        .all()
    )
    return [definition_response(definition) for definition in definitions]


@router.post("/activity-definitions", response_model=ActivityDefinitionResponse, status_code=201)
async def create_definition(
    payload: ActivityDefinitionInput, access: CurrentCompanyAccess, db: DbSession
):
    require_role(access, EDIT_ROLES)
    names = [r.name.strip().casefold() for r in payload.requirements]
    if len(names) != len(set(names)):
        raise HTTPException(status_code=422, detail="Una herramienta se repite en la actividad")
    definition = ActivityDefinition(
        company_id=access.company_id,
        title=payload.title.strip(),
        requirements_json=[
            {"name": r.name.strip(), "quantity": str(r.quantity)} for r in payload.requirements
        ],
    )
    db.add(definition)
    await flush_or_conflict(db, "Ya existe una actividad con ese nombre")
    add_activity(db, access, "activity.definition.created", "activity_definition", definition.id)
    await commit_or_conflict(db, "Ya existe una actividad con ese nombre")
    return definition_response(definition)


@router.patch("/activity-definitions/{definition_id}", response_model=ActivityDefinitionResponse)
async def update_definition(
    definition_id: str,
    payload: ActivityDefinitionInput,
    access: CurrentCompanyAccess,
    db: DbSession,
):
    require_role(access, EDIT_ROLES)
    definition = await db.scalar(
        select(ActivityDefinition).where(
            ActivityDefinition.id == definition_id,
            ActivityDefinition.company_id == access.company_id,
        )
    )
    if definition is None:
        raise HTTPException(status_code=404, detail="Actividad no encontrada")
    names = [r.name.strip().casefold() for r in payload.requirements]
    if len(names) != len(set(names)):
        raise HTTPException(status_code=422, detail="Una herramienta se repite en la actividad")
    definition.title = payload.title.strip()
    definition.requirements_json = [
        {"name": r.name.strip(), "quantity": str(r.quantity)} for r in payload.requirements
    ]
    add_activity(db, access, "activity.definition.updated", "activity_definition", definition.id)
    await commit_or_conflict(db, "No fue posible actualizar la actividad")
    return definition_response(definition)


async def present_plan(
    db: DbSession, company_id: str, plan_date: date, plan: DailyActivityPlan | None
) -> DailyActivityResponse:
    snapshot = await last_snapshot(db, company_id, plan_date)
    available: dict[tuple[str, str], Decimal] = {}
    if snapshot:
        for item in snapshot.items_json:
            if item["status"] not in {"available", "assigned"} or not item["project_id"]:
                continue
            key = (item["project_id"], item["name"].strip().casefold())
            available[key] = available.get(key, Decimal(0)) + Decimal(item["quantity"])
    entries = []
    for entry in plan.entries_json if plan else []:
        missing = (
            [
                r["name"]
                for r in entry["requirements"]
                if available.get((entry["project_id"], r["name"].strip().casefold()), Decimal(0))
                < Decimal(r["quantity"])
            ]
            if snapshot
            else []
        )
        entries.append(
            {
                **{
                    k: entry[k]
                    for k in (
                        "project_id",
                        "project_name",
                        "activity_definition_id",
                        "activity_title",
                        "people_count",
                        "note",
                    )
                },
                "verification": "incomplete" if not snapshot else "missing" if missing else "ready",
                "missing_tools": missing,
            }
        )
    return DailyActivityResponse(
        id=plan.id if plan else None,
        plan_date=plan_date,
        registered_at=plan.registered_at if plan else None,
        inventory_registered_at=snapshot.registered_at if snapshot else None,
        total_people=sum(entry["people_count"] for entry in entries),
        entries=entries,
    )


@router.get("/daily-activity-plans", response_model=list[DailyActivityResponse])
async def list_plans(
    access: CurrentCompanyAccess, db: DbSession, limit: int = Query(default=30, ge=1, le=100)
):
    plans = (
        (
            await db.execute(
                select(DailyActivityPlan)
                .where(DailyActivityPlan.company_id == access.company_id)
                .order_by(DailyActivityPlan.plan_date.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [await present_plan(db, access.company_id, plan.plan_date, plan) for plan in plans]


@router.get("/daily-activity-plans/{plan_date}", response_model=DailyActivityResponse)
async def get_plan(plan_date: date, access: CurrentCompanyAccess, db: DbSession):
    plan = await db.scalar(
        select(DailyActivityPlan).where(
            DailyActivityPlan.company_id == access.company_id,
            DailyActivityPlan.plan_date == plan_date,
        )
    )
    return await present_plan(db, access.company_id, plan_date, plan)


@router.put("/daily-activity-plans/{plan_date}", response_model=DailyActivityResponse)
async def save_plan(
    plan_date: date, payload: DailyActivityInput, access: CurrentCompanyAccess, db: DbSession
):
    require_role(access, EDIT_ROLES)
    if plan_date != payload.plan_date:
        raise HTTPException(status_code=422, detail="La fecha no coincide")
    plan = await db.scalar(
        select(DailyActivityPlan)
        .where(
            DailyActivityPlan.company_id == access.company_id,
            DailyActivityPlan.plan_date == plan_date,
        )
        .with_for_update()
    )
    if plan and plan.registered_at:
        raise HTTPException(
            status_code=409, detail="El informe ya está registrado y no se puede modificar"
        )
    project_ids = {entry.project_id for entry in payload.entries}
    projects = {
        project.id: project
        for project in (
            await db.execute(
                select(Project).where(
                    Project.company_id == access.company_id,
                    Project.id.in_(project_ids),
                    Project.status == "active",
                )
            )
        ).scalars()
    }
    if project_ids != set(projects):
        raise HTTPException(
            status_code=422, detail="Una obra no está activa o no pertenece a la constructora"
        )
    definition_ids = {
        entry.activity_definition_id for entry in payload.entries if entry.activity_definition_id
    }
    definitions = {
        definition.id: definition
        for definition in (
            await db.execute(
                select(ActivityDefinition).where(
                    ActivityDefinition.company_id == access.company_id,
                    ActivityDefinition.id.in_(definition_ids),
                    ActivityDefinition.is_active.is_(True),
                )
            )
        ).scalars()
    }
    if definition_ids != set(definitions):
        raise HTTPException(
            status_code=422, detail="Seleccione una actividad definida para la constructora"
        )
    entries = [
        {
            "project_id": entry.project_id,
            "project_name": projects[entry.project_id].name,
            "activity_definition_id": entry.activity_definition_id,
            "activity_title": definitions[entry.activity_definition_id].title
            if entry.activity_definition_id
            else None,
            "requirements": definitions[entry.activity_definition_id].requirements_json
            if entry.activity_definition_id
            else [],
            "people_count": entry.people_count,
            "note": entry.note,
        }
        for entry in payload.entries
    ]
    if plan is None:
        plan = DailyActivityPlan(
            company_id=access.company_id, plan_date=plan_date, entries_json=entries
        )
        db.add(plan)
    else:
        plan.entries_json = entries
    await flush_or_conflict(db, "No fue posible guardar la lista")
    add_activity(db, access, "activity.plan.saved", "daily_activity_plan", plan.id)
    await commit_or_conflict(db, "No fue posible guardar el borrador")
    return await present_plan(db, access.company_id, plan_date, plan)


@router.post("/daily-activity-plans/{plan_date}/register", response_model=DailyActivityResponse)
async def register_plan(plan_date: date, access: CurrentCompanyAccess, db: DbSession):
    require_role(access, EDIT_ROLES)
    plan = await db.scalar(
        select(DailyActivityPlan)
        .where(
            DailyActivityPlan.company_id == access.company_id,
            DailyActivityPlan.plan_date == plan_date,
        )
        .with_for_update()
    )
    if plan is None:
        raise HTTPException(status_code=404, detail="Guarde la lista antes de registrarla")
    if plan.registered_at is None:
        plan.registered_at = datetime.now(UTC).replace(tzinfo=None)
        plan.registered_by_user_id = access.user.id
        add_activity(db, access, "activity.plan.registered", "daily_activity_plan", plan.id)
        await commit_or_conflict(db, "No fue posible registrar actividades")
    # Registration preserves the report even without today's equipment close.
    return await present_plan(db, access.company_id, plan_date, plan)
