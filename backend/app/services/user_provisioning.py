from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.db.models import AppUser
from app.services.supabase_admin import (
    SupabaseAdminClient,
    SupabaseAdminError,
    SupabaseAdminUnavailable,
)


async def resolve_or_invite_user(db, email: str, full_name: str | None) -> tuple[AppUser, bool]:
    user = await db.scalar(
        select(AppUser).where(func.lower(AppUser.email) == email.lower()).limit(1)
    )
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
        auth_user = await SupabaseAdminClient(get_settings()).find_or_invite_user(email, full_name)
    except SupabaseAdminUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    user = AppUser(
        supabase_user_id=auth_user.id,
        email=auth_user.email,
        full_name=full_name,
        status="active",
        is_platform_admin=False,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="No fue posible registrar el usuario invitado"
        ) from exc
    return user, auth_user.invitation_sent
