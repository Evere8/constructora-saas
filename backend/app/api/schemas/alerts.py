from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

AvailabilityStatus = Literal["unchecked", "available", "partial", "missing"]
NotificationStatus = Literal["unread", "read", "dismissed"]


class TaskRequirementCreate(BaseModel):
    inventory_item_id: str | None = Field(default=None, min_length=36, max_length=36)
    description: str = Field(min_length=2, max_length=220)
    required_quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    unit: str = Field(min_length=1, max_length=30)
    availability_status: AvailabilityStatus | None = None


class TaskRequirementPatch(BaseModel):
    inventory_item_id: str | None = Field(default=None, min_length=36, max_length=36)
    description: str | None = Field(default=None, min_length=2, max_length=220)
    required_quantity: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=3)
    unit: str | None = Field(default=None, min_length=1, max_length=30)
    availability_status: AvailabilityStatus | None = None

    @model_validator(mode="after")
    def require_change(self) -> "TaskRequirementPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        for field in {
            "description",
            "required_quantity",
            "unit",
            "availability_status",
        }:
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} no puede ser nulo")
        return self


class TaskRequirementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    inventory_item_id: str | None
    description: str
    required_quantity: Decimal
    unit: str
    availability_status: str
    inventory_code: str | None = None
    inventory_name: str | None = None


class NotificationPatch(BaseModel):
    status: NotificationStatus


class NotificationResponse(BaseModel):
    id: str
    company_id: str
    project_id: str | None
    task_id: str | None
    checklist_item_id: str | None
    requirement_id: str | None
    alert_type: str
    severity: str
    title: str
    message: str
    due_at: datetime | None
    status: NotificationStatus
    created_at: datetime


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    unread_count: int


class ReportStatusCount(BaseModel):
    status: str
    count: int


class ReportProjectRow(BaseModel):
    project_id: str
    project_name: str
    tasks_total: int
    tasks_completed: int
    tasks_overdue: int
    completion_percent: float


class ReportAssigneeRow(BaseModel):
    user_id: str | None
    name: str
    tasks_total: int
    tasks_completed: int
    tasks_overdue: int
    completion_percent: float


class ReportAdvancedResponse(BaseModel):
    date_from: date | None
    date_to: date | None
    project_id: str | None
    assigned_user_id: str | None
    tasks_total: int
    tasks_completed: int
    tasks_overdue: int
    tasks_due_soon: int
    tasks_unassigned: int
    checklist_total: int
    checklist_completed: int
    checklist_blocked: int
    requirements_at_risk: int
    completion_percent: float
    status_counts: list[ReportStatusCount]
    projects: list[ReportProjectRow]
    assignees: list[ReportAssigneeRow]
