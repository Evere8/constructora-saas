from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import jwt
from jwt import PyJWKClient

from app.core.config import Settings


class TokenVerificationError(Exception):
    pass


@dataclass(frozen=True)
class TokenClaims:
    subject: str
    email: str | None
    session_id: str | None
    raw: dict[str, Any]


class SupabaseTokenVerifier:
    def __init__(self, settings: Settings) -> None:
        if not settings.supabase_jwks_url or not settings.supabase_issuer:
            raise RuntimeError("Supabase Auth no está configurado")
        self._settings = settings
        self._jwks = PyJWKClient(settings.supabase_jwks_url, cache_keys=True, lifespan=300)

    def verify(self, token: str) -> TokenClaims:
        try:
            signing_key = self._jwks.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience=self._settings.supabase_audience,
                issuer=self._settings.supabase_issuer,
                options={"require": ["exp", "iat", "sub", "aud"]},
            )
        except jwt.PyJWTError as exc:
            raise TokenVerificationError("Token inválido o vencido") from exc

        subject = payload.get("sub")
        if not isinstance(subject, str) or not subject:
            raise TokenVerificationError("Token sin identificador de usuario")
        return TokenClaims(
            subject=subject,
            email=payload.get("email") if isinstance(payload.get("email"), str) else None,
            session_id=payload.get("session_id")
            if isinstance(payload.get("session_id"), str)
            else None,
            raw=payload,
        )
