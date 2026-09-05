from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    app_env: str = "production"
    log_level: str = "INFO"
    mysql_host: str = "mysql"
    mysql_port: int = 3306
    mysql_database: str = "constructora_saas"
    mysql_user: str = "constructora_app"
    mysql_password: str = Field(min_length=1)

    supabase_url: str | None = None
    supabase_publishable_key: str | None = None
    supabase_secret_key: str | None = None
    supabase_invite_redirect_url: str | None = None
    supabase_audience: str = "authenticated"
    cors_origins: str = "http://localhost:3000,http://localhost:5173"
    upload_root: Path = Path("/data/uploads")
    evidence_max_bytes: int = 10 * 1024 * 1024

    @property
    def database_url(self) -> URL:
        return URL.create(
            drivername="mysql+asyncmy",
            username=self.mysql_user,
            password=self.mysql_password,
            host=self.mysql_host,
            port=self.mysql_port,
            database=self.mysql_database,
            query={"charset": "utf8mb4"},
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [value.strip() for value in self.cors_origins.split(",") if value.strip()]

    @property
    def supabase_issuer(self) -> str | None:
        if not self.supabase_url:
            return None
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @property
    def supabase_jwks_url(self) -> str | None:
        if not self.supabase_issuer:
            return None
        return f"{self.supabase_issuer}/.well-known/jwks.json"

    @property
    def invite_redirect_url(self) -> str | None:
        if self.supabase_invite_redirect_url:
            return self.supabase_invite_redirect_url
        origin = next(
            (origin for origin in self.cors_origin_list if origin.startswith("https://")),
            None,
        )
        return f"{origin.rstrip('/')}/restablecer" if origin else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
