from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.dependencies import CurrentUserContext, get_company_access
from app.core.security import TokenClaims


class FakeDb:
    async def get(self, _model: object, _identifier: str) -> object:
        return SimpleNamespace(id="company-1", status="active")


def platform_admin() -> CurrentUserContext:
    return CurrentUserContext(
        id="user-1",
        supabase_user_id="auth-1",
        email="admin@example.com",
        full_name="Admin",
        status="active",
        is_platform_admin=True,
        claims=TokenClaims(
            subject="auth-1",
            email="admin@example.com",
            session_id="session-1",
            raw={},
        ),
    )


@pytest.mark.asyncio
async def test_platform_admin_cannot_bypass_company_membership() -> None:
    with pytest.raises(HTTPException) as exc:
        await get_company_access("company-1", platform_admin(), FakeDb())  # type: ignore[arg-type]

    assert exc.value.status_code == 403
    assert "no opera dentro de constructoras" in exc.value.detail
