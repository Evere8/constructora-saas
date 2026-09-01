from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CompanyStatus = Literal["active", "inactive", "suspended"]
MembershipRole = Literal[
    "owner",
    "admin",
    "engineer",
    "supervisor",
    "warehouse",
    "transport",
    "worker",
    "viewer",
]
MembershipStatus = Literal["active", "invited", "blocked"]


class PlanCreate(BaseModel):
    code: str = Field(min_length=2, max_length=50, pattern=r"^[a-z0-9_-]+$")
    name: str = Field(min_length=2, max_length=100)
    limits_json: dict[str, int | float | bool | str]
    is_active: bool = True


class PlanPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    limits_json: dict[str, int | float | bool | str] | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def require_change(self) -> "PlanPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class PlanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    code: str
    name: str
    limits_json: dict
    is_active: bool
    created_at: datetime


class CompanyCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    slug: str = Field(
        min_length=2,
        max_length=120,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    )
    plan_id: str | None = Field(default=None, max_length=36)
    status: CompanyStatus = "active"


class CompanyPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    slug: str | None = Field(
        default=None,
        min_length=2,
        max_length=120,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    )
    plan_id: str | None = Field(default=None, max_length=36)
    status: CompanyStatus | None = None

    @model_validator(mode="after")
    def require_change(self) -> "CompanyPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class CompanyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    status: str
    plan_id: str | None
    created_at: datetime
    updated_at: datetime


class CompanyListResponse(BaseModel):
    items: list[CompanyResponse]
    total: int
    limit: int
    offset: int


class MembershipCreate(BaseModel):
    user_id: str = Field(min_length=36, max_length=36)
    role: MembershipRole
    status: MembershipStatus = "active"


class MembershipPatch(BaseModel):
    role: MembershipRole | None = None
    status: MembershipStatus | None = None

    @model_validator(mode="after")
    def require_change(self) -> "MembershipPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class MembershipResponse(BaseModel):
    id: str
    company_id: str
    user_id: str
    email: str
    full_name: str | None
    role: str
    status: str
    created_at: datetime
