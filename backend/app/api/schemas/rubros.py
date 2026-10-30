"""Contracts for configurable project work streams and Perforaciones."""

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

RubroFeatureKey = Literal[
    "postensado_documentation",
    "interactive_pdf",
    "tasks",
    "checklists",
    "observations",
]


class RubroFeatureInput(BaseModel):
    feature_key: RubroFeatureKey
    settings_json: dict | None = None


class ProjectRubroCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    feature_keys: list[RubroFeatureKey] = Field(default_factory=list, max_length=10)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        return value.strip()


class ProjectRubroPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def require_change(self) -> "ProjectRubroPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        if self.name is not None:
            self.name = self.name.strip()
        return self


class ProjectRubroFeatureSet(BaseModel):
    features: list[RubroFeatureInput] = Field(default_factory=list, max_length=10)


class ProjectRubroFeatureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    rubro_id: str
    feature_key: str
    settings_json: dict | None
    sort_order: int


class ProjectRubroSummary(BaseModel):
    tasks_total: int = 0
    tasks_completed: int = 0
    documents_total: int = 0
    points_total: int = 0
    points_completed: int = 0


class ProjectRubroObservationCreate(BaseModel):
    body: str = Field(min_length=1, max_length=5000)

    @field_validator("body")
    @classmethod
    def clean_body(cls, value: str) -> str:
        return value.strip()


class ProjectRubroObservationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    project_id: str
    rubro_id: str
    body: str
    created_by_user_id: str | None
    created_at: datetime
    updated_at: datetime


class ProjectRubroResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    project_id: str
    slug: str
    name: str
    description: str | None
    is_system: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime
    features: list[ProjectRubroFeatureResponse] = Field(default_factory=list)
    summary: ProjectRubroSummary = Field(default_factory=ProjectRubroSummary)


class PerforationChecklistEntry(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=180)
    checked: bool = False


class PerforationColorCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    color_hex: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    checklist: list[PerforationChecklistEntry] = Field(default_factory=list, max_length=30)
    sort_order: int | None = Field(default=None, ge=-1000, le=1000)


class PerforationColorPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    color_hex: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    checklist: list[PerforationChecklistEntry] | None = Field(default=None, max_length=30)
    sort_order: int | None = Field(default=None, ge=-1000, le=1000)
    is_active: bool | None = None

    @model_validator(mode="after")
    def require_change(self) -> "PerforationColorPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class PerforationColorResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    rubro_id: str
    name: str
    color_hex: str
    checklist_json: list
    sort_order: int
    is_active: bool


class PerforationDocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    project_id: str
    rubro_id: str
    title: str
    original_filename: str
    mime_type: str
    size_bytes: int
    sha256: str
    page_count: int | None
    created_by_user_id: str
    created_at: datetime
    points_total: int = 0
    points_completed: int = 0


class PerforationPointCreate(BaseModel):
    document_id: str = Field(min_length=36, max_length=36)
    color_id: str = Field(min_length=36, max_length=36)
    page_number: int = Field(default=1, ge=1, le=10000)
    x: Decimal = Field(ge=0, le=1, max_digits=8, decimal_places=6)
    y: Decimal = Field(ge=0, le=1, max_digits=8, decimal_places=6)
    diameter: Decimal = Field(
        default=Decimal("0.026"),
        ge=Decimal("0.008"),
        le=Decimal("0.12"),
        max_digits=8,
        decimal_places=6,
    )
    label: str | None = Field(default=None, max_length=180)


class PerforationPointPatch(BaseModel):
    color_id: str | None = Field(default=None, min_length=36, max_length=36)
    page_number: int | None = Field(default=None, ge=1, le=10000)
    x: Decimal | None = Field(default=None, ge=0, le=1, max_digits=8, decimal_places=6)
    y: Decimal | None = Field(default=None, ge=0, le=1, max_digits=8, decimal_places=6)
    diameter: Decimal | None = Field(
        default=None, ge=Decimal("0.008"), le=Decimal("0.12"), max_digits=8, decimal_places=6
    )
    label: str | None = Field(default=None, max_length=180)
    note_text: str | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def require_change(self) -> "PerforationPointPatch":
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class PerforationChecklistPatch(BaseModel):
    checklist: list[PerforationChecklistEntry] = Field(default_factory=list, max_length=40)
    save_as_color_default: bool = False


class PerforationPointResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    project_id: str
    rubro_id: str
    document_id: str
    color_id: str | None
    page_number: int
    x: Decimal
    y: Decimal
    diameter: Decimal
    label: str | None
    color_hex: str
    checklist_json: list
    note_text: str | None
    note_original_filename: str | None
    note_mime_type: str | None
    status: str
    created_by_user_id: str


class PerforationCanvasPoint(BaseModel):
    x: Decimal = Field(ge=0, le=1, max_digits=8, decimal_places=6)
    y: Decimal = Field(ge=0, le=1, max_digits=8, decimal_places=6)


class PerforationAnnotationCreate(BaseModel):
    client_id: str | None = Field(
        default=None, pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    document_id: str = Field(min_length=36, max_length=36)
    page_number: int = Field(ge=1, le=10000)
    kind: Literal["line", "note"]
    points: list[PerforationCanvasPoint] = Field(min_length=1, max_length=2000)
    text: str | None = Field(default=None, max_length=500)
    color_hex: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    stroke_width: int = Field(ge=1, le=40)
    opacity: Decimal = Field(ge=0, le=1, max_digits=4, decimal_places=3)

    @model_validator(mode="after")
    def validate_shape(self) -> "PerforationAnnotationCreate":
        if self.kind == "line" and len(self.points) < 2:
            raise ValueError("El trazo necesita al menos dos posiciones")
        if self.kind == "note" and (len(self.points) != 1 or not (self.text or "").strip()):
            raise ValueError("La nota necesita una posición y texto")
        if self.kind == "line" and self.text:
            raise ValueError("Un trazo no puede contener texto")
        if self.text is not None:
            self.text = self.text.strip()
        return self


class PerforationAnnotationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    project_id: str
    rubro_id: str
    document_id: str
    page_number: int
    kind: Literal["line", "note"]
    points: list[PerforationCanvasPoint] = Field(validation_alias="points_json")
    text: str | None
    color_hex: str
    stroke_width: int
    opacity: Decimal
    created_by_user_id: str
    created_at: datetime


class PerforationWorkspaceResponse(BaseModel):
    rubro: ProjectRubroResponse
    colors: list[PerforationColorResponse] = Field(default_factory=list)
    documents: list[PerforationDocumentResponse] = Field(default_factory=list)
    points: list[PerforationPointResponse] = Field(default_factory=list)
    annotations: list[PerforationAnnotationResponse] = Field(default_factory=list)
