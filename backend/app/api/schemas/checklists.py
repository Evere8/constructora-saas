from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ChecklistStatus = Literal[
    "pending",
    "in_progress",
    "blocked",
    "completed",
    "not_applicable",
]


class ChecklistCreate(BaseModel):
    title: str = Field(min_length=2, max_length=220)
    description: str | None = Field(default=None, max_length=5000)
    process_stage: str | None = Field(default=None, min_length=1, max_length=80)
    status: ChecklistStatus = "pending"
    assigned_user_id: str | None = Field(default=None, min_length=36, max_length=36)
    due_at: datetime | None = None


class ChecklistPatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=220)
    description: str | None = Field(default=None, max_length=5000)
    process_stage: str | None = Field(default=None, min_length=1, max_length=80)
    status: ChecklistStatus | None = None
    assigned_user_id: str | None = Field(default=None, min_length=36, max_length=36)
    due_at: datetime | None = None

    @model_validator(mode="after")
    def require_change(self) -> "ChecklistPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class ChecklistResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    project_id: str
    plan_version_id: str | None
    annotation_id: str | None
    title: str
    description: str | None
    process_stage: str | None
    status: str
    assigned_user_id: str | None
    due_at: datetime | None
    completed_at: datetime | None
    created_at: datetime


class ChecklistListResponse(BaseModel):
    items: list[ChecklistResponse]
    total: int
    limit: int
    offset: int


class ChecklistProgressResponse(BaseModel):
    total: int
    pending: int
    in_progress: int
    blocked: int
    completed: int
    not_applicable: int
    completion_percent: float
