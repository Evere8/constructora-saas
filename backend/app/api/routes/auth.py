from fastapi import APIRouter
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DbSession
from app.api.schemas.auth import CurrentUserResponse, MembershipSummary
from app.db.models import Company, CompanyMembership

router = APIRouter()


@router.get("/me", response_model=CurrentUserResponse)
async def me(user: CurrentUser, db: DbSession) -> CurrentUserResponse:
    result = await db.execute(
        select(CompanyMembership, Company)
        .join(Company, Company.id == CompanyMembership.company_id)
        .where(
            CompanyMembership.user_id == user.id,
            CompanyMembership.status == "active",
        )
        .order_by(Company.name)
    )
    memberships = [
        MembershipSummary(
            company_id=company.id,
            company_name=company.name,
            company_slug=company.slug,
            company_status=company.status,
            role=membership.role,
            membership_status=membership.status,
        )
        for membership, company in result.all()
    ]
    return CurrentUserResponse(
        id=user.id,
        supabase_user_id=user.supabase_user_id,
        email=user.email,
        full_name=user.full_name,
        status=user.status,
        is_platform_admin=user.is_platform_admin,
        session_id=user.claims.session_id,
        memberships=memberships,
    )
