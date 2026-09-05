"""API contracts for the additive V2 elongation workflow."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _normalise_decimal_input(value: Any) -> Any:
    if isinstance(value, str):
        return value.strip().replace(",", ".")
    return value


class ElongationItemV2Patch(BaseModel):
    label: str | None = Field(default=None, min_length=2, max_length=50)
    classification: Literal["band", "distributed", "unknown"] | None = None
    length_m: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=3)
    strand_count: int | None = Field(default=None, gt=0, le=1000)
    calculated_elongation: Decimal | None = Field(
        default=None, ge=0, max_digits=12, decimal_places=3
    )
    theory_review_status: Literal["pending", "approved", "rejected", "conflict"] | None = None
    source_location_json: dict[str, Any] | None = None

    @field_validator("length_m", "calculated_elongation", mode="before")
    @classmethod
    def normalise_decimal(cls, value: Any) -> Any:
        return _normalise_decimal_input(value)

    @model_validator(mode="after")
    def require_change(self) -> ElongationItemV2Patch:
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class ElongationMeasurementPatch(BaseModel):
    ordinal: int | None = Field(default=None, gt=0, le=1000)
    measured_elongation: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=3)
    raw_text: str | None = Field(default=None, max_length=5000)
    match_method: Literal["label_anchor", "spatial", "manual"] | None = None
    review_status: Literal["pending", "approved", "rejected", "conflict"] | None = None
    override_reason: str | None = Field(default=None, max_length=2000)
    source_location_json: dict[str, Any] | None = None

    @field_validator("measured_elongation", mode="before")
    @classmethod
    def normalise_decimal(cls, value: Any) -> Any:
        return _normalise_decimal_input(value)

    @model_validator(mode="after")
    def require_change(self) -> ElongationMeasurementPatch:
        if not self.model_fields_set:
            raise ValueError("Debe indicar al menos un campo")
        return self


class ElongationBulkClassification(BaseModel):
    item_ids: list[str] = Field(min_length=1, max_length=500)
    classification: Literal["band", "distributed"]


class ElongationZoneGeometry(BaseModel):
    page: int = Field(default=1, ge=1, le=25)
    x: Decimal = Field(ge=0, le=1)
    y: Decimal = Field(ge=0, le=1)
    width: Decimal = Field(gt=0, le=1)
    height: Decimal = Field(gt=0, le=1)

    @model_validator(mode="after")
    def fit_inside_source(self) -> ElongationZoneGeometry:
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("La zona debe permanecer dentro del plano")
        return self


class ElongationClassificationZoneCreate(BaseModel):
    classification: Literal["band", "distributed"]
    geometry: ElongationZoneGeometry
    name: str | None = Field(default=None, min_length=1, max_length=100)


class ElongationClassificationZoneResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_id: str
    classification: str
    name: str | None
    geometry_json: dict[str, Any]
    created_by_user_id: str
    created_at: datetime


class ElongationFileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_id: str
    kind: str
    version_number: int
    original_filename: str
    mime_type: str
    size_bytes: int
    sha256: str
    page_count: int | None
    processing_status: str
    processing_summary_json: dict[str, Any] | None
    error_message: str | None
    created_at: datetime


class ElongationMeasurementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_id: str
    item_id: str
    ordinal: int
    measured_elongation: Decimal | None
    raw_text: str | None
    confidence: Decimal | None
    match_method: str | None
    review_status: str
    override_reason: str | None
    source_file_id: str | None
    source_page: int | None
    source_location_json: dict[str, Any] | None
    reviewed_by_user_id: str | None
    reviewed_at: datetime | None
    maximum_elongation: Decimal | None = None
    minimum_elongation: Decimal | None = None
    tolerance_status: Literal["within", "outside", "missing", "unresolved"] = "missing"


class ElongationItemV2Response(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_id: str
    label: str
    label_number: int
    raw_label: str | None
    raw_text: str | None
    sort_order: int
    classification: str
    length_m: Decimal
    strand_count: int
    calculated_elongation: Decimal
    confidence: Decimal | None
    theory_review_status: str
    field_confidence_json: dict[str, Any] | None
    source_file_id: str | None
    source_page: int | None
    source_location_json: dict[str, Any] | None
    reviewed_by_user_id: str | None
    reviewed_at: datetime | None
    measurements: list[ElongationMeasurementResponse] = Field(default_factory=list)


class ElongationProgressResponse(BaseModel):
    groups_total: int = 0
    groups_pending: int = 0
    measurements_expected: int = 0
    measurements_detected: int = 0
    measurements_pending: int = 0
    outside_tolerance: int = 0
    unresolved_conflicts: int = 0
    can_approve_theory: bool = False
    can_approve_final: bool = False
    approval_blockers: list[str] = Field(default_factory=list)


class ElongationJobV2Response(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: str
    project_id: str
    level_id: str | None
    responsible_user_id: str | None
    plan_version_id: str | None
    title: str
    workflow_status: str
    tolerance_percent: Decimal
    template_mapping_json: dict[str, Any] | None
    processing_summary_json: dict[str, Any] | None
    error_message: str | None
    theory_approved_by_user_id: str | None
    theory_approved_at: datetime | None
    approved_by_user_id: str | None
    approved_at: datetime | None
    version_number: int
    created_at: datetime
    progress: ElongationProgressResponse = Field(default_factory=ElongationProgressResponse)
    files: list[ElongationFileResponse] = Field(default_factory=list)
    zones: list[ElongationClassificationZoneResponse] = Field(default_factory=list)
    items: list[ElongationItemV2Response] = Field(default_factory=list)


class ElongationJobListResponse(BaseModel):
    items: list[ElongationJobV2Response] = Field(default_factory=list)
