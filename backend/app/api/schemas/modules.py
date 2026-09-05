from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class PlanVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    version_number: int
    original_filename: str
    mime_type: str
    size_bytes: int
    sha256: str
    created_by_user_id: str
    created_at: datetime


class PlanDocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    project_id: str
    level_id: str | None
    title: str
    status: str
    created_by_user_id: str
    created_at: datetime
    versions: list[PlanVersionResponse] = Field(default_factory=list)


class ProjectOverviewPlanPatch(BaseModel):
    plan_version_id: str | None = Field(default=None, min_length=36, max_length=36)


class ProjectOverviewPlanResponse(BaseModel):
    plan_version_id: str | None


class AnnotationCreate(BaseModel):
    page_number: int = Field(ge=1, le=10000)
    level_id: str | None = Field(default=None, min_length=36, max_length=36)
    level_id: str | None = Field(default=None, min_length=36, max_length=36)
    annotation_type: Literal["pin", "note", "line", "area"]
    geometry_json: dict
    style_json: dict = Field(default_factory=dict)
    comment: str | None = Field(default=None, max_length=3000)


class AnnotationPatch(BaseModel):
    comment: str | None = Field(default=None, max_length=3000)
    status: Literal["pending", "resolved"] | None = None

    @model_validator(mode="after")
    def require_change(self) -> "AnnotationPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class AnnotationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    plan_version_id: str
    level_id: str | None
    level_id: str | None
    page_number: int
    annotation_type: str
    geometry_json: dict
    style_json: dict
    comment: str | None
    status: str
    created_by_user_id: str
    created_at: datetime
    updated_at: datetime


ItemType = Literal["machine", "tool", "material"]
InventoryStatus = Literal["available", "assigned", "maintenance", "retired"]


class InventoryItemCreate(BaseModel):
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=2, max_length=180)
    item_type: ItemType
    unit: str = Field(default="unit", min_length=1, max_length=30)
    serial_number: str | None = Field(default=None, max_length=120)
    status: InventoryStatus = "available"
    current_project_id: str | None = Field(default=None, min_length=36, max_length=36)
    quantity: Decimal = Field(default=Decimal("1"), gt=0, max_digits=14, decimal_places=3)


class InventoryItemPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    unit: str | None = Field(default=None, min_length=1, max_length=30)
    serial_number: str | None = Field(default=None, max_length=120)
    status: InventoryStatus | None = None
    current_project_id: str | None = Field(default=None, min_length=36, max_length=36)
    quantity: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=3)

    @model_validator(mode="after")
    def require_change(self) -> "InventoryItemPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class InventoryItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    code: str
    name: str
    item_type: str
    unit: str
    serial_number: str | None
    status: str
    current_project_id: str | None
    quantity: Decimal
    created_at: datetime


class InventoryMovementCreate(BaseModel):
    item_id: str = Field(min_length=36, max_length=36)
    to_project_id: str | None = Field(default=None, min_length=36, max_length=36)
    quantity: Decimal = Field(default=Decimal("1"), gt=0, max_digits=14, decimal_places=3)
    condition_status: str | None = Field(default=None, max_length=30)
    notes: str | None = Field(default=None, max_length=3000)


class InventoryMovementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    item_id: str
    from_project_id: str | None
    to_project_id: str | None
    quantity: Decimal
    condition_status: str | None
    notes: str | None
    moved_by_user_id: str
    moved_at: datetime


class ElongationItemCreate(BaseModel):
    label: str = Field(min_length=1, max_length=50)
    classification: Literal["band", "distributed"]
    length_m: Decimal = Field(gt=0, max_digits=12, decimal_places=3)
    strand_count: int = Field(gt=0, le=1000)
    calculated_elongation: Decimal = Field(ge=0, max_digits=12, decimal_places=3)
    measured_elongation: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=3)
    review_status: Literal["pending", "approved", "rejected"] = "pending"


class ElongationItemPatch(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=50)
    classification: Literal["band", "distributed"] | None = None
    length_m: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=3)
    strand_count: int | None = Field(default=None, gt=0, le=1000)
    calculated_elongation: Decimal | None = Field(
        default=None, ge=0, max_digits=12, decimal_places=3
    )
    measured_elongation: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=3)
    review_status: Literal["pending", "approved", "rejected"] | None = None

    @model_validator(mode="after")
    def require_change(self) -> "ElongationItemPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class ElongationItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_id: str
    label: str
    classification: str
    length_m: Decimal
    strand_count: int
    calculated_elongation: Decimal
    measured_elongation: Decimal | None
    confidence: Decimal | None
    review_status: str
    source_location_json: dict | None


class ElongationJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    project_id: str
    plan_version_id: str | None
    title: str
    source_kind: str
    original_filename: str | None
    mime_type: str | None
    size_bytes: int | None
    status: str
    tolerance_percent: Decimal
    error_message: str | None
    completed_at: datetime | None
    created_at: datetime
    item_count: int = 0
    items: list[ElongationItemResponse] = Field(default_factory=list)


class CompanyMemberCreate(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    full_name: str | None = Field(default=None, max_length=180)
    role: Literal[
        "owner", "admin", "engineer", "supervisor", "warehouse", "transport", "worker", "viewer"
    ]

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        local, separator, domain = email.partition("@")
        if not separator or not local or "." not in domain:
            raise ValueError("Debe indicar un correo válido")
        return email


class CompanyMemberPatch(BaseModel):
    role: (
        Literal[
            "owner", "admin", "engineer", "supervisor", "warehouse", "transport", "worker", "viewer"
        ]
        | None
    ) = None
    status: Literal["active", "blocked"] | None = None

    @model_validator(mode="after")
    def require_change(self) -> "CompanyMemberPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class CompanyMemberResponse(BaseModel):
    id: str
    user_id: str
    email: str
    full_name: str | None
    role: str
    status: str
    created_at: datetime
    assigned_tasks: int = 0
    assigned_checklist: int = 0
    invitation_sent: bool = False


class ReportOverviewResponse(BaseModel):
    projects_total: int
    projects_active: int
    tasks_total: int
    tasks_completed: int
    checklist_total: int
    checklist_completed: int
    completion_percent: float
    inventory_total: int
    inventory_assigned: int
    members_active: int


class CompanySettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    status: str
    plan_id: str | None
    created_at: datetime
    updated_at: datetime


class CompanySettingsPatch(BaseModel):
    name: str = Field(min_length=2, max_length=180)
