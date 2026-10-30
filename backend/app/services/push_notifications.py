"""Web Push delivery for installed Obrixapy clients."""

import json
import logging

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from app.api.dependencies import DbSession
from app.core.config import get_settings
from app.db.models import PushSubscription

logger = logging.getLogger(__name__)


def _deliver(subscription: PushSubscription, payload: dict) -> int | None:
    from pywebpush import WebPushException, webpush

    settings = get_settings()
    try:
        response = webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=str(settings.vapid_private_key_path),
            vapid_claims={"sub": settings.vapid_subject},
            timeout=10,
            ttl=24 * 60 * 60,
        )
        return getattr(response, "status_code", None)
    except WebPushException as exc:
        return getattr(exc.response, "status_code", None) or 0
    # Push is a best-effort side effect after the business transaction has
    # committed. A provider, network or key failure must never make a saved
    # task look failed to its creator.
    except Exception as exc:  # noqa: BLE001
        logger.warning("No se pudo entregar una notificación Web Push: %s", exc)
        return 0


async def send_push_to_user(
    db: DbSession,
    company_id: str,
    user_id: str | None,
    payload: dict,
) -> None:
    settings = get_settings()
    if user_id is None or settings.vapid_public_key is None:
        return
    subscriptions = list(
        (
            await db.execute(
                select(PushSubscription).where(
                    PushSubscription.company_id == company_id,
                    PushSubscription.user_id == user_id,
                    PushSubscription.is_active.is_(True),
                )
            )
        ).scalars()
    )
    company_payload = {**payload, "company_id": company_id}
    changed = False
    for subscription in subscriptions:
        status_code = await run_in_threadpool(_deliver, subscription, company_payload)
        if status_code in {404, 410}:
            subscription.is_active = False
            changed = True
    if changed:
        await db.commit()
