from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator


class InventoryAssignment(BaseModel):
    item_id: str = Field(min_length=36, max_length=36)
    expected_project_id: str | None = None
    to_project_id: str | None = None


class RegisterInventoryDay(BaseModel):
    snapshot_date: date
    assignments: list[InventoryAssignment] = Field(max_length=2000)


class InventoryDayResponse(BaseModel):
    id: str
    snapshot_date: date
    revision: int
    registered_at: datetime
    registered_by_user_id: str
    items: list[dict]


class RestockCreate(BaseModel):
    project_id: str | None = None
    name: str = Field(min_length=2, max_length=180)
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    note: str | None = Field(default=None, max_length=2000)


class RestockResponse(BaseModel):
    id: str
    project_id: str | None
    name: str
    quantity: Decimal
    note: str | None
    status: str
    requested_by_user_id: str
    created_at: datetime


class ActivityRequirement(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    quantity: Decimal = Field(default=Decimal("1"), gt=0, max_digits=14, decimal_places=3)


class ActivityDefinitionInput(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    requirements: list[ActivityRequirement] = Field(default_factory=list, max_length=100)


class ActivityDefinitionResponse(ActivityDefinitionInput):
    id: str
    is_active: bool


class ActivityEntryInput(BaseModel):
    project_id: str
    activity_definition_id: str | None = None
    assigned_user_id: str | None = Field(default=None, min_length=36, max_length=36)
    task_id: str | None = Field(default=None, min_length=36, max_length=36)
    people_count: int = Field(ge=0, le=10000)
    note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def meaningful_assignment(self):
        if self.activity_definition_id is None and self.people_count != 0:
            raise ValueError("Seleccione una actividad para asignar personal")
        return self


class DailyActivityInput(BaseModel):
    plan_date: date
    entries: list[ActivityEntryInput] = Field(max_length=500)
    expected_revision: str | None = None


class RegisterActivityInput(BaseModel):
    expected_revision: str


class ActivityEntryResponse(BaseModel):
    project_id: str
    project_name: str
    activity_definition_id: str | None
    activity_title: str | None
    assigned_user_id: str | None
    assigned_user_name: str | None
    task_id: str | None
    task_status: str | None
    custom_status_label: str | None
    people_count: int
    note: str | None
    verification: str
    missing_tools: list[str]


class DailyActivityResponse(BaseModel):
    id: str | None
    revision: str | None
    plan_date: date
    registered_at: datetime | None
    inventory_registered_at: datetime | None
    total_people: int
    entries: list[ActivityEntryResponse]
