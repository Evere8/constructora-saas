import json

import httpx
import pytest

from app.core.config import Settings
from app.services.supabase_admin import SupabaseAdminClient, SupabaseAdminUnavailable


def settings() -> Settings:
    return Settings(
        mysql_password="test",
        supabase_url="https://project.supabase.co",
        supabase_secret_key="sb_secret_test",
        supabase_invite_redirect_url="https://app.example.com/restablecer",
    )


def test_admin_client_requires_server_secret() -> None:
    with pytest.raises(SupabaseAdminUnavailable):
        SupabaseAdminClient(
            Settings(mysql_password="test", supabase_url="https://project.supabase.co")
        )


@pytest.mark.asyncio
async def test_existing_auth_user_is_reused_without_invitation() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={"users": [{"id": "auth-user-1", "email": "owner@example.com"}]},
        )

    client = SupabaseAdminClient(settings(), transport=httpx.MockTransport(handler))
    user = await client.find_or_invite_user("OWNER@example.com", "Ana")

    assert user.id == "auth-user-1"
    assert user.invitation_sent is False
    assert [request.method for request in requests] == ["GET"]


@pytest.mark.asyncio
async def test_new_auth_user_receives_invitation_with_safe_redirect() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json={"users": []})
        return httpx.Response(
            200,
            json={"id": "auth-user-2", "email": "owner@example.com"},
        )

    client = SupabaseAdminClient(settings(), transport=httpx.MockTransport(handler))
    user = await client.find_or_invite_user("owner@example.com", "Ana Propietaria")

    assert user.id == "auth-user-2"
    assert user.invitation_sent is True
    invite = requests[1]
    assert invite.url.path == "/auth/v1/invite"
    assert invite.url.params["redirect_to"] == "https://app.example.com/restablecer"
    assert invite.headers["apikey"] == "sb_secret_test"
    assert json.loads(invite.content) == {
        "email": "owner@example.com",
        "data": {"full_name": "Ana Propietaria"},
    }
