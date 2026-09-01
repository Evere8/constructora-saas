import pytest

from app.core.config import Settings
from app.core.security import SupabaseTokenVerifier


def test_verifier_requires_supabase_configuration() -> None:
    settings = Settings(mysql_password="test", supabase_url=None)
    with pytest.raises(RuntimeError, match="no está configurado"):
        SupabaseTokenVerifier(settings)
