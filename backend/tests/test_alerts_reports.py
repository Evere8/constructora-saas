from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.routes.alerts import derive_availability
from app.api.routes.reports import date_bounds
from app.api.schemas.alerts import TaskRequirementCreate, TaskRequirementPatch
from app.api.schemas.operations import TaskCreate
from app.db.models import InventoryItem
from app.main import app
from app.services.operational_alerts import due_severity


def test_openapi_exposes_requirements_alerts_and_advanced_reports() -> None:
    paths = app.openapi()["paths"]
    prefix = "/api/v1/companies/{company_id}"
    assert f"{prefix}/projects/{{project_id}}/tasks/{{task_id}}/requirements" in paths
    assert f"{prefix}/notifications" in paths
    assert f"{prefix}/notifications/{{notification_id}}" in paths
    assert f"{prefix}/reports/advanced" in paths
    assert f"{prefix}/reports/advanced.csv" in paths


def test_due_severity_distinguishes_overdue_today_and_tomorrow() -> None:
    now = datetime(2026, 9, 4, 12, 0)
    assert due_severity(now - timedelta(minutes=1), now)[0] == "critical"
    assert due_severity(now + timedelta(hours=8), now)[0] == "warning"
    assert due_severity(now + timedelta(hours=30), now)[0] == "info"


def test_requirement_schema_and_automatic_availability() -> None:
    payload = TaskRequirementCreate(
        inventory_item_id=None,
        description="Taladro",
        required_quantity=Decimal("2"),
        unit="unidad",
    )
    assert payload.availability_status is None
    item = InventoryItem(
        company_id="company",
        code="HER-01",
        name="Taladro",
        item_type="tool",
        unit="unidad",
        status="assigned",
        current_project_id="project",
        quantity=Decimal("1"),
    )
    assert derive_availability(item, "project", Decimal("2")) == "partial"
    item.quantity = Decimal("2")
    assert derive_availability(item, "project", Decimal("2")) == "available"
    item.current_project_id = None
    assert derive_availability(item, "project", Decimal("2")) == "missing"
    assert derive_availability(None, "project", Decimal("2")) == "unchecked"


def test_requirement_patch_and_report_dates_validate_input() -> None:
    with pytest.raises(ValidationError):
        TaskRequirementPatch()
    with pytest.raises(ValidationError):
        TaskRequirementPatch(required_quantity=None)
    with pytest.raises(HTTPException) as exc:
        date_bounds(
            datetime(2026, 9, 5).date(),
            datetime(2026, 9, 4).date(),
        )
    assert exc.value.status_code == 422


def test_task_schedule_rejects_end_before_start() -> None:
    with pytest.raises(ValidationError):
        TaskCreate(
            title="Hormigonado",
            planned_start_at=datetime(2026, 9, 5, 8, 0),
            due_at=datetime(2026, 9, 5, 7, 0),
        )
