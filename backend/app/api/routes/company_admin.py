from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.routes.operations import (
    add_activity,
    commit_or_conflict,
    flush_or_conflict,
    require_role,
)
from app.api.schemas.modules import (
    CompanyMemberCreate,
    CompanyMemberPatch,
    CompanyMemberResponse,
    CompanySettingsPatch,
    CompanySettingsResponse,
    ReportOverviewResponse,
)
from app.db.models import (
    AppUser,
    ChecklistItem,
    Company,
    CompanyMembership,
    InventoryItem,
    Project,
    Task,
)
from app.services.user_provisioning import resolve_or_invite_user

router = APIRouter()
MEMBER_EDITOR_ROLES = {"platform_admin", "owner", "admin"}


@router.get("/settings", response_model=CompanySettingsResponse)
async def get_settings(access: CurrentCompanyAccess, db: DbSession) -> Company:
    company = await db.get(Company, access.company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Constructora no encontrada")
    return company


@router.patch("/settings", response_model=CompanySettingsResponse)
async def update_settings(
    payload: CompanySettingsPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Company:
    require_role(access, MEMBER_EDITOR_ROLES)
    company = await db.get(Company, access.company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Constructora no encontrada")
    company.name = payload.name.strip()
    add_activity(db, access, "company.settings.updated", "company", company.id)
    await commit_or_conflict(db, "No fue posible actualizar la constructora")
    await db.refresh(company)
    return company


@router.get("/members", response_model=list[CompanyMemberResponse])
async def list_members(access: CurrentCompanyAccess, db: DbSession) -> list[CompanyMemberResponse]:
    rows = (
        await db.execute(
            select(
                CompanyMembership,
                AppUser,
                func.count(func.distinct(Task.id)),
                func.count(func.distinct(ChecklistItem.id)),
            )
            .join(AppUser, AppUser.id == CompanyMembership.user_id)
            .outerjoin(
                Task,
                (Task.company_id == CompanyMembership.company_id)
                & (Task.assigned_user_id == AppUser.id),
            )
            .outerjoin(
                ChecklistItem,
                (ChecklistItem.company_id == CompanyMembership.company_id)
                & (ChecklistItem.assigned_user_id == AppUser.id),
            )
            .where(CompanyMembership.company_id == access.company_id)
            .group_by(CompanyMembership.id, AppUser.id)
            .order_by(AppUser.full_name, AppUser.email)
        )
    ).all()
    return [
        CompanyMemberResponse(
            id=membership.id,
            user_id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=membership.role,
            status=membership.status,
            created_at=membership.created_at,
            assigned_tasks=task_count,
            assigned_checklist=checklist_count,
        )
        for membership, user, task_count, checklist_count in rows
    ]


@router.post(
    "/members",
    response_model=CompanyMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_member(
    payload: CompanyMemberCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> CompanyMemberResponse:
    require_role(access, MEMBER_EDITOR_ROLES)
    if payload.role == "owner" and access.role != "owner":
        raise HTTPException(
            status_code=403, detail="Solo el propietario puede agregar otro propietario"
        )
    user, invitation_sent = await resolve_or_invite_user(db, payload.email, payload.full_name)
    existing = await db.scalar(
        select(CompanyMembership.id).where(
            CompanyMembership.company_id == access.company_id,
            CompanyMembership.user_id == user.id,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="El usuario ya pertenece a la constructora")
    membership = CompanyMembership(
        company_id=access.company_id,
        user_id=user.id,
        role=payload.role,
        status="active",
    )
    db.add(membership)
    await flush_or_conflict(db, "No fue posible agregar al usuario")
    add_activity(
        db,
        access,
        "company.member.created",
        "company_membership",
        membership.id,
        {"user_id": user.id, "role": payload.role, "invitation_sent": invitation_sent},
    )
    await commit_or_conflict(db, "No fue posible agregar al usuario")
    await db.refresh(membership)
    return CompanyMemberResponse(
        id=membership.id,
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=membership.role,
        status=membership.status,
        created_at=membership.created_at,
        invitation_sent=invitation_sent,
    )


@router.patch("/members/{membership_id}", response_model=CompanyMemberResponse)
async def update_member(
    membership_id: str,
    payload: CompanyMemberPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> CompanyMemberResponse:
    require_role(access, MEMBER_EDITOR_ROLES)
    row = (
        await db.execute(
            select(CompanyMembership, AppUser)
            .join(AppUser, AppUser.id == CompanyMembership.user_id)
            .where(
                CompanyMembership.id == membership_id,
                CompanyMembership.company_id == access.company_id,
            )
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Miembro no encontrado")
    membership, user = row
    changes = payload.model_dump(exclude_unset=True)
    if membership.role == "owner" and access.role != "owner":
        raise HTTPException(
            status_code=403, detail="Solo un propietario puede modificar a otro propietario"
        )
    if changes.get("role") == "owner" and access.role != "owner":
        raise HTTPException(status_code=403, detail="Solo el propietario puede asignar ese rol")
    if membership.user_id == access.user.id and (
        changes.get("status") == "blocked"
        or (membership.role == "owner" and changes.get("role") not in {None, "owner"})
    ):
        raise HTTPException(status_code=422, detail="No puede quitar su propio acceso propietario")
    for field, value in changes.items():
        setattr(membership, field, value)
    add_activity(db, access, "company.member.updated", "company_membership", membership.id, changes)
    await commit_or_conflict(db, "No fue posible actualizar al miembro")
    await db.refresh(membership)
    return CompanyMemberResponse(
        id=membership.id,
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=membership.role,
        status=membership.status,
        created_at=membership.created_at,
    )


@router.get("/reports/overview", response_model=ReportOverviewResponse)
async def report_overview(access: CurrentCompanyAccess, db: DbSession) -> ReportOverviewResponse:
    company_id = access.company_id
    projects_total = (
        await db.scalar(select(func.count(Project.id)).where(Project.company_id == company_id)) or 0
    )
    projects_active = (
        await db.scalar(
            select(func.count(Project.id)).where(
                Project.company_id == company_id, Project.status == "active"
            )
        )
        or 0
    )
    tasks_total = (
        await db.scalar(select(func.count(Task.id)).where(Task.company_id == company_id)) or 0
    )
    tasks_completed = (
        await db.scalar(
            select(func.count(Task.id)).where(
                Task.company_id == company_id, Task.status == "completed"
            )
        )
        or 0
    )
    checklist_total = (
        await db.scalar(
            select(func.count(ChecklistItem.id)).where(ChecklistItem.company_id == company_id)
        )
        or 0
    )
    checklist_completed = (
        await db.scalar(
            select(func.count(ChecklistItem.id)).where(
                ChecklistItem.company_id == company_id, ChecklistItem.status == "completed"
            )
        )
        or 0
    )
    checklist_not_applicable = (
        await db.scalar(
            select(func.count(ChecklistItem.id)).where(
                ChecklistItem.company_id == company_id,
                ChecklistItem.status == "not_applicable",
            )
        )
        or 0
    )
    inventory_total = (
        await db.scalar(
            select(func.count(InventoryItem.id)).where(InventoryItem.company_id == company_id)
        )
        or 0
    )
    inventory_assigned = (
        await db.scalar(
            select(func.count(InventoryItem.id)).where(
                InventoryItem.company_id == company_id,
                InventoryItem.current_project_id.is_not(None),
            )
        )
        or 0
    )
    members_active = (
        await db.scalar(
            select(func.count(CompanyMembership.id)).where(
                CompanyMembership.company_id == company_id,
                CompanyMembership.status == "active",
            )
        )
        or 0
    )
    applicable_checklist = checklist_total - checklist_not_applicable
    applicable = applicable_checklist if checklist_total else tasks_total
    completed = checklist_completed if checklist_total else tasks_completed
    return ReportOverviewResponse(
        projects_total=projects_total,
        projects_active=projects_active,
        tasks_total=tasks_total,
        tasks_completed=tasks_completed,
        checklist_total=checklist_total,
        checklist_completed=checklist_completed,
        completion_percent=round(completed / applicable * 100, 2) if applicable else 0,
        inventory_total=inventory_total,
        inventory_assigned=inventory_assigned,
        members_active=members_active,
    )
