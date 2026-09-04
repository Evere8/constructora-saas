from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import SupabaseTokenVerifier, TokenClaims, TokenVerificationError
from app.db.models import AppUser, Company, CompanyMembership
from app.db.session import get_db

bearer = HTTPBearer(auto_error=False)


async def get_token_claims(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> TokenClaims:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Falta el token de acceso"
        )
    try:
        verifier = SupabaseTokenVerifier(get_settings())
        return await run_in_threadpool(verifier.verify, credentials.credentials)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except TokenVerificationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


CurrentClaims = Annotated[TokenClaims, Depends(get_token_claims)]


@dataclass(frozen=True)
class CurrentUserContext:
    id: str
    supabase_user_id: str
    email: str
    full_name: str | None
    status: str
    is_platform_admin: bool
    claims: TokenClaims


DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(claims: CurrentClaims, db: DbSession) -> CurrentUserContext:
    result = await db.execute(
        select(AppUser).where(AppUser.supabase_user_id == claims.subject)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El usuario no está habilitado en la plataforma",
        )
    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El usuario está bloqueado o pendiente",
        )
    return CurrentUserContext(
        id=user.id,
        supabase_user_id=user.supabase_user_id,
        email=user.email,
        full_name=user.full_name,
        status=user.status,
        is_platform_admin=user.is_platform_admin,
        claims=claims,
    )


CurrentUser = Annotated[CurrentUserContext, Depends(get_current_user)]


async def require_platform_admin(user: CurrentUser) -> CurrentUserContext:
    if not user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere acceso de administrador de plataforma",
        )
    return user


CurrentPlatformAdmin = Annotated[CurrentUserContext, Depends(require_platform_admin)]


@dataclass(frozen=True)
class CompanyAccessContext:
    company_id: str
    company_status: str
    role: str
    user: CurrentUserContext


async def get_company_access(
    company_id: str, user: CurrentUser, db: DbSession
) -> CompanyAccessContext:
    company = await db.get(Company, company_id)
    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Constructora no encontrada"
        )

    if user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El administrador de plataforma no opera dentro de constructoras",
        )

    result = await db.execute(
        select(CompanyMembership).where(
            CompanyMembership.company_id == company.id,
            CompanyMembership.user_id == user.id,
            CompanyMembership.status == "active",
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tiene acceso a esta constructora",
        )
    if company.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La constructora no está activa",
        )
    return CompanyAccessContext(
        company_id=company.id,
        company_status=company.status,
        role=membership.role,
        user=user,
    )


CurrentCompanyAccess = Annotated[CompanyAccessContext, Depends(get_company_access)]
