from dataclasses import dataclass

import httpx

from app.core.config import Settings


class SupabaseAdminUnavailable(RuntimeError):
    """La integración administrativa no tiene configuración suficiente."""


class SupabaseAdminError(RuntimeError):
    """Supabase rechazó o no pudo completar una operación administrativa."""


@dataclass(frozen=True)
class SupabaseAuthUser:
    id: str
    email: str
    invitation_sent: bool


class SupabaseAdminClient:
    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not settings.supabase_url or not settings.supabase_secret_key:
            raise SupabaseAdminUnavailable(
                "La invitación de usuarios requiere SUPABASE_URL y SUPABASE_SECRET_KEY "
                "en el servidor"
            )
        self.base_url = f"{settings.supabase_url.rstrip('/')}/auth/v1"
        self.secret_key = settings.supabase_secret_key
        self.redirect_url = settings.invite_redirect_url
        self.transport = transport

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "apikey": self.secret_key,
            "Authorization": f"Bearer {self.secret_key}",
        }

    @staticmethod
    async def _error_detail(response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            return "Supabase Auth no pudo completar la solicitud"
        if isinstance(payload, dict):
            for key in ("msg", "message", "error_description", "error"):
                value = payload.get(key)
                if isinstance(value, str) and value:
                    return value
        return "Supabase Auth no pudo completar la solicitud"

    async def find_or_invite_user(self, email: str, full_name: str | None) -> SupabaseAuthUser:
        normalized_email = email.strip().lower()
        try:
            async with httpx.AsyncClient(
                headers=self.headers,
                timeout=httpx.Timeout(15.0),
                transport=self.transport,
            ) as client:
                existing = await self._find_user(client, normalized_email)
                if existing:
                    return SupabaseAuthUser(
                        id=existing["id"],
                        email=existing.get("email") or normalized_email,
                        invitation_sent=False,
                    )

                params = {"redirect_to": self.redirect_url} if self.redirect_url else None
                response = await client.post(
                    f"{self.base_url}/invite",
                    params=params,
                    json={
                        "email": normalized_email,
                        "data": {"full_name": full_name} if full_name else {},
                    },
                )
                if response.is_error:
                    # Cubre una carrera: el usuario pudo ser creado entre la búsqueda y el alta.
                    existing = await self._find_user(client, normalized_email)
                    if existing:
                        return SupabaseAuthUser(
                            id=existing["id"],
                            email=existing.get("email") or normalized_email,
                            invitation_sent=False,
                        )
                    detail = await self._error_detail(response)
                    raise SupabaseAdminError(f"No se pudo invitar al usuario: {detail}")

                payload = response.json()
                user_id = payload.get("id") if isinstance(payload, dict) else None
                if not isinstance(user_id, str) or not user_id:
                    raise SupabaseAdminError("Supabase Auth devolvió una respuesta incompleta")
                return SupabaseAuthUser(
                    id=user_id,
                    email=payload.get("email") or normalized_email,
                    invitation_sent=True,
                )
        except httpx.RequestError as exc:
            raise SupabaseAdminError("No fue posible comunicarse con Supabase Auth") from exc

    async def _find_user(
        self,
        client: httpx.AsyncClient,
        email: str,
    ) -> dict | None:
        page = 1
        per_page = 1000
        while page <= 10:
            response = await client.get(
                f"{self.base_url}/admin/users",
                params={"page": page, "per_page": per_page},
            )
            if response.is_error:
                detail = await self._error_detail(response)
                raise SupabaseAdminError(f"No se pudo consultar usuarios de Supabase: {detail}")
            payload = response.json()
            users = payload.get("users", []) if isinstance(payload, dict) else []
            for user in users:
                candidate = user.get("email") if isinstance(user, dict) else None
                if isinstance(candidate, str) and candidate.lower() == email:
                    return user
            if len(users) < per_page:
                return None
            page += 1
        raise SupabaseAdminError("No se pudo completar la búsqueda de usuarios en Supabase")
