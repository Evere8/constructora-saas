from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ProjectStatus = Literal["active", "inactive", "completed", "archived"]
TaskType = Literal["work", "transport"]
TaskStatus = Literal["pending", "in_progress", "review", "completed", "cancelled"]
TaskPriority = Literal["low", "normal", "high", "urgent"]


class ProjectCreate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=50)
    name: str = Field(min_length=2, max_length=180)
    description: str | None = Field(default=None, max_length=5000)
    address: str | None = Field(default=None, max_length=300)
    status: ProjectStatus = "active"
    start_date: date | None = None
    planned_end_date: date | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> "ProjectCreate":
        if self.start_date and self.planned_end_date and self.planned_end_date < self.start_date:
            raise ValueError("La fecha final prevista no puede ser anterior al inicio")
        return self


class ProjectPatch(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=50)
    name: str | None = Field(default=None, min_length=2, max_length=180)
    description: str | None = Field(default=None, max_length=5000)
    address: str | None = Field(default=None, max_length=300)
    status: ProjectStatus | None = None
    start_date: date | None = None
    planned_end_date: date | None = None
    actual_end_date: date | None = None

    @model_validator(mode="after")
    def require_change(self) -> "ProjectPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        if self.start_date and self.planned_end_date and self.planned_end_date < self.start_date:
            raise ValueError("La fecha final prevista no puede ser anterior al inicio")
        return self


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    code: str | None
    name: str
    description: str | None
    address: str | None
    status: str
    start_date: date | None
    planned_end_date: date | None
    actual_end_date: date | None
    created_at: datetime
    updated_at: datetime


class ProjectListResponse(BaseModel):
    items: list[ProjectResponse]
    total: int
    limit: int
    offset: int


class LevelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sort_order: int = Field(default=0, ge=-10000, le=10000)


class LevelPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    sort_order: int | None = Field(default=None, ge=-10000, le=10000)

    @model_validator(mode="after")
    def require_change(self) -> "LevelPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class LevelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    name: str
    sort_order: int


class TaskCreate(BaseModel):
    level_id: str | None = Field(default=None, min_length=36, max_length=36)
    task_type: TaskType = "work"
    title: str = Field(min_length=2, max_length=220)
    description: str | None = Field(default=None, max_length=5000)
    status: TaskStatus = "pending"
    priority: TaskPriority = "normal"
    assigned_user_id: str | None = Field(default=None, min_length=36, max_length=36)
    due_at: datetime | None = None


class TaskPatch(BaseModel):
    level_id: str | None = Field(default=None, min_length=36, max_length=36)
    task_type: TaskType | None = None
    title: str | None = Field(default=None, min_length=2, max_length=220)
    description: str | None = Field(default=None, max_length=5000)
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    assigned_user_id: str | None = Field(default=None, min_length=36, max_length=36)
    due_at: datetime | None = None

    @model_validator(mode="after")
    def require_change(self) -> "TaskPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    project_id: str
    level_id: str | None
    task_type: str
    title: str
    description: str | None
    status: str
    priority: str
    assigned_user_id: str | None
    due_at: datetime | None
    completed_at: datetime | None
    created_by_user_id: str
    created_at: datetime
    updated_at: datetime


class TaskListResponse(BaseModel):
    items: list[TaskResponse]
    total: int
    limit: int
    offset: int
