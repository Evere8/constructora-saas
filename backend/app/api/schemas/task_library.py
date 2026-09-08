from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

TaskType = Literal["work", "transport"]
TaskPriority = Literal["low", "normal", "high", "urgent"]
DailyTaskStatus = Literal["pending", "in_progress", "completed"]


class TaskTemplateResourceInput(BaseModel):
    inventory_item_id: str | None = Field(default=None, min_length=36, max_length=36)
    description: str = Field(min_length=2, max_length=220)
    required_quantity: Decimal = Field(default=Decimal("1"), gt=0, max_digits=14, decimal_places=3)
    unit: str = Field(default="unidad", min_length=1, max_length=30)
    sort_order: int = Field(default=0, ge=0, le=1000)


class TaskTemplateChecklistInput(BaseModel):
    title: str = Field(min_length=2, max_length=220)
    description: str | None = Field(default=None, max_length=3000)
    sort_order: int = Field(default=0, ge=0, le=1000)


class TaskTemplateCreate(BaseModel):
    title: str = Field(min_length=2, max_length=220)
    description: str | None = Field(default=None, max_length=5000)
    task_type: TaskType = "work"
    priority: TaskPriority = "normal"
    default_location_text: str | None = Field(default=None, max_length=300)
    resources: list[TaskTemplateResourceInput] = Field(default_factory=list, max_length=60)
    checklist_items: list[TaskTemplateChecklistInput] = Field(default_factory=list, max_length=80)


class TaskTemplatePatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=220)
    description: str | None = Field(default=None, max_length=5000)
    task_type: TaskType | None = None
    priority: TaskPriority | None = None
    default_location_text: str | None = Field(default=None, max_length=300)
    is_active: bool | None = None
    resources: list[TaskTemplateResourceInput] | None = Field(default=None, max_length=60)
    checklist_items: list[TaskTemplateChecklistInput] | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def require_change(self) -> "TaskTemplatePatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class TaskTemplateResourceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    inventory_item_id: str | None
    description: str
    required_quantity: Decimal
    unit: str
    sort_order: int
    inventory_code: str | None = None
    inventory_name: str | None = None


class TaskTemplateChecklistResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    description: str | None
    sort_order: int


class TaskTemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    title: str
    description: str | None
    task_type: str
    priority: str
    default_location_text: str | None
    is_active: bool
    created_by_user_id: str | None
    created_at: datetime
    updated_at: datetime
    resources: list[TaskTemplateResourceResponse] = Field(default_factory=list)
    checklist_items: list[TaskTemplateChecklistResponse] = Field(default_factory=list)


class DailyTaskChecklistInput(BaseModel):
    title: str = Field(min_length=2, max_length=220)
    description: str | None = Field(default=None, max_length=3000)
    sort_order: int = Field(default=0, ge=0, le=1000)


class DailyTaskCreate(BaseModel):
    title: str = Field(min_length=2, max_length=220)
    description: str | None = Field(default=None, max_length=5000)
    assigned_user_id: str | None = Field(default=None, min_length=36, max_length=36)
    task_date: date = Field(default_factory=date.today)
    checklist_items: list[DailyTaskChecklistInput] = Field(default_factory=list, max_length=80)
    save_as_template: bool = False
    auto_renew_daily: bool = False


class DailyTaskTemplatePatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=220)
    description: str | None = Field(default=None, max_length=5000)
    auto_renew_daily: bool | None = None
    is_active: bool | None = None
    checklist_items: list[DailyTaskChecklistInput] | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def require_change(self) -> "DailyTaskTemplatePatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class DailyTaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=220)
    description: str | None = Field(default=None, max_length=5000)
    status: DailyTaskStatus | None = None

    @model_validator(mode="after")
    def require_change(self) -> "DailyTaskPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class DailyTaskChecklistPatch(BaseModel):
    status: DailyTaskStatus


class DailyTaskTemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    assigned_user_id: str
    title: str
    description: str | None
    auto_renew_daily: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime
    checklist_items: list[TaskTemplateChecklistResponse] = Field(default_factory=list)


class DailyTaskChecklistResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    daily_task_id: str
    title: str
    description: str | None
    sort_order: int
    status: str
    completed_at: datetime | None


class DailyTaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    template_id: str | None
    assigned_user_id: str
    task_date: date
    title: str
    description: str | None
    status: str
    created_at: datetime
    updated_at: datetime
    checklist_items: list[DailyTaskChecklistResponse] = Field(default_factory=list)
