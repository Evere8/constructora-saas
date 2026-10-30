import hashlib

from fastapi import APIRouter, Header, Response, status
from sqlalchemy import select

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.routes.operations import commit_or_conflict, flush_or_conflict
from app.api.schemas.push import (
    PushConfigResponse,
    PushSubscriptionDelete,
    PushSubscriptionInput,
)
from app.core.config import get_settings
from app.db.models import PushSubscription

router = APIRouter()


def endpoint_hash(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode()).hexdigest()


@router.get("/push/config", response_model=PushConfigResponse)
async def push_config(access: CurrentCompanyAccess) -> PushConfigResponse:
    del access
    public_key = get_settings().vapid_public_key
    return PushConfigResponse(enabled=bool(public_key), public_key=public_key)


@router.post("/push/subscriptions", status_code=status.HTTP_204_NO_CONTENT)
async def save_push_subscription(
    payload: PushSubscriptionInput,
    access: CurrentCompanyAccess,
    db: DbSession,
    user_agent: str | None = Header(default=None),
) -> Response:
    endpoint = str(payload.endpoint)
    digest = endpoint_hash(endpoint)
    rows = list(
        (
            await db.execute(
                select(PushSubscription).where(
                    PushSubscription.company_id == access.company_id,
                    PushSubscription.endpoint_hash == digest,
                )
            )
        ).scalars()
    )
    current = next((row for row in rows if row.user_id == access.user.id), None)
    for row in rows:
        if row.user_id != access.user.id:
            row.is_active = False
    if current is None:
        current = PushSubscription(
            company_id=access.company_id,
            user_id=access.user.id,
            endpoint_hash=digest,
            endpoint=endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
            user_agent=(user_agent or "")[:500] or None,
            is_active=True,
        )
        db.add(current)
    else:
        current.endpoint = endpoint
        current.p256dh = payload.keys.p256dh
        current.auth = payload.keys.auth
        current.user_agent = (user_agent or "")[:500] or None
        current.is_active = True
    await flush_or_conflict(db, "No se pudo guardar la suscripción de notificaciones")
    await commit_or_conflict(db, "No se pudo guardar la suscripción de notificaciones")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/push/subscriptions", status_code=status.HTTP_204_NO_CONTENT)
async def delete_push_subscription(
    payload: PushSubscriptionDelete,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    subscription = await db.scalar(
        select(PushSubscription).where(
            PushSubscription.company_id == access.company_id,
            PushSubscription.user_id == access.user.id,
            PushSubscription.endpoint_hash == endpoint_hash(str(payload.endpoint)),
        )
    )
    if subscription:
        subscription.is_active = False
        await commit_or_conflict(db, "No se pudo desactivar la suscripción")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
