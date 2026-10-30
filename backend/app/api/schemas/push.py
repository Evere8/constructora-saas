from pydantic import BaseModel, Field, HttpUrl, field_validator


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=20, max_length=500)
    auth: str = Field(min_length=8, max_length=500)


class PushSubscriptionInput(BaseModel):
    endpoint: HttpUrl
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def require_secure_endpoint(cls, value: HttpUrl) -> HttpUrl:
        if value.scheme != "https":
            raise ValueError("El endpoint de notificaciones debe usar HTTPS")
        return value


class PushSubscriptionDelete(BaseModel):
    endpoint: HttpUrl

    @field_validator("endpoint")
    @classmethod
    def require_secure_endpoint(cls, value: HttpUrl) -> HttpUrl:
        if value.scheme != "https":
            raise ValueError("El endpoint de notificaciones debe usar HTTPS")
        return value


class PushConfigResponse(BaseModel):
    enabled: bool
    public_key: str | None = None
