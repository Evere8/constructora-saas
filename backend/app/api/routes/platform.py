from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentPlatformAdmin, DbSession
from app.api.schemas.platform import (
    CompanyCreate,
    CompanyListResponse,
    CompanyOnboardingCreate,
    CompanyOnboardingResponse,
    CompanyPatch,
    CompanyResponse,
    MembershipCreate,
    MembershipPatch,
    MembershipResponse,
    PlanCreate,
    PlanPatch,
    PlanResponse,
)
from app.core.config import get_settings
from app.db.models import ActivityLog, AppUser, Company, CompanyMembership, Plan
from app.services.supabase_admin import (
    SupabaseAdminClient,
    SupabaseAdminError,
    SupabaseAdminUnavailable,
)

router = APIRouter()


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


async def require_plan(db: DbSession, plan_id: str | None) -> None:
    if plan_id is None:
        return
    plan = await db.get(Plan, plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Plan inválido"
        )


async def resolve_or_invite_user(
    db: DbSession,
    email: str,
    full_name: str | None,
) -> tuple[AppUser, bool]:
    result = await db.execute(
        select(AppUser).where(func.lower(AppUser.email) == email.lower()).limit(1)
    )
    user = result.scalar_one_or_none()
    if user is not None:
        if user.is_platform_admin:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Un administrador de plataforma no puede ser miembro de una constructora",
            )
        if user.status != "active":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El usuario existe, pero su cuenta no está activa",
            )
        if full_name and not user.full_name:
            user.full_name = full_name
        return user, False

    try:
        auth_user = await SupabaseAdminClient(get_settings()).find_or_invite_user(
            email,
            full_name,
        )
    except SupabaseAdminUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except SupabaseAdminError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    user = AppUser(
        supabase_user_id=auth_user.id,
        email=auth_user.email,
        full_name=full_name,
        status="active",
        is_platform_admin=False,
    )
    db.add(user)
    await flush_or_conflict(db, "No fue posible registrar el usuario invitado")
    return user, auth_user.invitation_sent


def add_activity(
    db: DbSession,
    actor_id: str,
    action: str,
    entity_type: str,
    entity_id: str,
    company_id: str | None = None,
    metadata: dict | None = None,
) -> None:
    db.add(
        ActivityLog(
            company_id=company_id,
            user_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata_json=metadata,
        )
    )


@router.get("/plans", response_model=list[PlanResponse])
async def list_plans(_: CurrentPlatformAdmin, db: DbSession) -> list[Plan]:
    result = await db.execute(select(Plan).order_by(Plan.name))
    return list(result.scalars())


@router.post("/plans", response_model=PlanResponse, status_code=status.HTTP_201_CREATED)
async def create_plan(
    payload: PlanCreate, admin: CurrentPlatformAdmin, db: DbSession
) -> Plan:
    plan = Plan(**payload.model_dump())
    db.add(plan)
    await flush_or_conflict(db, "Ya existe un plan con ese código")
    add_activity(db, admin.id, "platform.plan.created", "plan", plan.id)
    await commit_or_conflict(db, "Ya existe un plan con ese código")
    await db.refresh(plan)
    return plan


@router.patch("/plans/{plan_id}", response_model=PlanResponse)
async def update_plan(
    plan_id: str, payload: PlanPatch, admin: CurrentPlatformAdmin, db: DbSession
) -> Plan:
    plan = await db.get(Plan, plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan no encontrado")
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(plan, field, value)
    add_activity(db, admin.id, "platform.plan.updated", "plan", plan.id, metadata=changes)
    await commit_or_conflict(db, "No fue posible actualizar el plan")
    await db.refresh(plan)
    return plan


@router.get("/companies", response_model=CompanyListResponse)
async def list_companies(
    _: CurrentPlatformAdmin,
    db: DbSession,
    company_status: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> CompanyListResponse:
    filters = []
    if company_status:
        filters.append(Company.status == company_status)
    if search:
        term = f"%{search.strip()}%"
        filters.append(or_(Company.name.like(term), Company.slug.like(term)))

    total = await db.scalar(select(func.count()).select_from(Company).where(*filters))
    result = await db.execute(
        select(Company).where(*filters).order_by(Company.name).limit(limit).offset(offset)
    )
    return CompanyListResponse(
        items=[CompanyResponse.model_validate(company) for company in result.scalars()],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.post("/companies", response_model=CompanyResponse, status_code=status.HTTP_201_CREATED)
async def create_company(
    payload: CompanyCreate, admin: CurrentPlatformAdmin, db: DbSession
) -> Company:
    await require_plan(db, payload.plan_id)
    company = Company(**payload.model_dump())
    db.add(company)
    await flush_or_conflict(db, "Ya existe una constructora con ese identificador")
    add_activity(
        db,
        admin.id,
        "platform.company.created",
        "company",
        company.id,
        company_id=company.id,
    )
    await commit_or_conflict(db, "Ya existe una constructora con ese identificador")
    await db.refresh(company)
    return company


@router.post(
    "/companies/onboard",
    response_model=CompanyOnboardingResponse,
    status_code=status.HTTP_201_CREATED,
)
async def onboard_company(
    payload: CompanyOnboardingCreate,
    admin: CurrentPlatformAdmin,
    db: DbSession,
) -> CompanyOnboardingResponse:
    await require_plan(db, payload.plan_id)
    existing_company = await db.scalar(select(Company.id).where(Company.slug == payload.slug))
    if existing_company:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una constructora con ese identificador",
        )

    owner, invitation_sent = await resolve_or_invite_user(
        db,
        payload.owner_email,
        payload.owner_full_name,
    )
    company = Company(
        name=payload.name,
        slug=payload.slug,
        plan_id=payload.plan_id,
        status=payload.status,
    )
    db.add(company)
    await flush_or_conflict(db, "Ya existe una constructora con ese identificador")

    membership = CompanyMembership(
        company_id=company.id,
        user_id=owner.id,
        role="owner",
        status="active",
    )
    db.add(membership)
    await flush_or_conflict(db, "El propietario ya pertenece a esta constructora")
    add_activity(
        db,
        admin.id,
        "platform.company.onboarded",
        "company",
        company.id,
        company_id=company.id,
        metadata={"owner_user_id": owner.id, "invitation_sent": invitation_sent},
    )
    await commit_or_conflict(db, "No fue posible completar el alta de la constructora")
    await db.refresh(company)
    await db.refresh(membership)
    return CompanyOnboardingResponse(
        company=CompanyResponse.model_validate(company),
        owner=MembershipResponse(
            id=membership.id,
            company_id=membership.company_id,
            user_id=owner.id,
            email=owner.email,
            full_name=owner.full_name,
            role=membership.role,
            status=membership.status,
            created_at=membership.created_at,
            invitation_sent=invitation_sent,
        ),
    )


@router.get("/companies/{company_id}", response_model=CompanyResponse)
async def get_company(
    company_id: str, _: CurrentPlatformAdmin, db: DbSession
) -> Company:
    company = await db.get(Company, company_id)
    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Constructora no encontrada"
        )
    return company


@router.patch("/companies/{company_id}", response_model=CompanyResponse)
async def update_company(
    company_id: str,
    payload: CompanyPatch,
    admin: CurrentPlatformAdmin,
    db: DbSession,
) -> Company:
    company = await db.get(Company, company_id)
    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Constructora no encontrada"
        )
    changes = payload.model_dump(exclude_unset=True)
    if "plan_id" in changes:
        await require_plan(db, changes["plan_id"])
    for field, value in changes.items():
        setattr(company, field, value)
    add_activity(
        db,
        admin.id,
        "platform.company.updated",
        "company",
        company.id,
        company_id=company.id,
        metadata=changes,
    )
    await commit_or_conflict(db, "No fue posible actualizar la constructora")
    await db.refresh(company)
    return company


@router.get(
    "/companies/{company_id}/memberships", response_model=list[MembershipResponse]
)
async def list_memberships(
    company_id: str, _: CurrentPlatformAdmin, db: DbSession
) -> list[MembershipResponse]:
    if await db.get(Company, company_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Constructora no encontrada"
        )
    result = await db.execute(
        select(CompanyMembership, AppUser)
        .join(AppUser, AppUser.id == CompanyMembership.user_id)
        .where(CompanyMembership.company_id == company_id)
        .order_by(AppUser.email)
    )
    return [
        MembershipResponse(
            id=membership.id,
            company_id=membership.company_id,
            user_id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=membership.role,
            status=membership.status,
            created_at=membership.created_at,
        )
        for membership, user in result.all()
    ]


@router.post(
    "/companies/{company_id}/memberships",
    response_model=MembershipResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_membership(
    company_id: str,
    payload: MembershipCreate,
    admin: CurrentPlatformAdmin,
    db: DbSession,
) -> MembershipResponse:
    company = await db.get(Company, company_id)
    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Constructora no encontrada"
        )
    user, invitation_sent = await resolve_or_invite_user(
        db,
        payload.email,
        payload.full_name,
    )
    membership = CompanyMembership(
        company_id=company_id,
        user_id=user.id,
        role=payload.role,
        status=payload.status,
    )
    db.add(membership)
    await flush_or_conflict(db, "El usuario ya pertenece a esta constructora")
    add_activity(
        db,
        admin.id,
        "platform.membership.created",
        "company_membership",
        membership.id,
        company_id=company_id,
        metadata={"user_id": user.id, "role": membership.role},
    )
    await commit_or_conflict(db, "El usuario ya pertenece a esta constructora")
    await db.refresh(membership)
    return MembershipResponse(
        id=membership.id,
        company_id=membership.company_id,
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=membership.role,
        status=membership.status,
        created_at=membership.created_at,
        invitation_sent=invitation_sent,
    )


@router.patch("/memberships/{membership_id}", response_model=MembershipResponse)
async def update_membership(
    membership_id: str,
    payload: MembershipPatch,
    admin: CurrentPlatformAdmin,
    db: DbSession,
) -> MembershipResponse:
    membership = await db.get(CompanyMembership, membership_id)
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membresía no encontrada")
    user = await db.get(AppUser, membership.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(membership, field, value)
    add_activity(
        db,
        admin.id,
        "platform.membership.updated",
        "company_membership",
        membership.id,
        company_id=membership.company_id,
        metadata=changes,
    )
    await commit_or_conflict(db, "No fue posible actualizar la membresía")
    await db.refresh(membership)
    return MembershipResponse(
        id=membership.id,
        company_id=membership.company_id,
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=membership.role,
        status=membership.status,
        created_at=membership.created_at,
    )
