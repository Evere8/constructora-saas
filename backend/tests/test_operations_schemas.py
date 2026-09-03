from datetime import date

import pytest
from pydantic import ValidationError

from app.api.schemas.operations import ProjectCreate, ProjectPatch, TaskCreate, TaskPatch


def test_project_rejects_invalid_date_range() -> None:
    with pytest.raises(ValidationError, match="fecha final prevista"):
        ProjectCreate(
            name="Edificio Centro",
            start_date=date(2026, 9, 10),
            planned_end_date=date(2026, 9, 9),
        )


def test_operation_patches_require_a_change() -> None:
    with pytest.raises(ValidationError, match="al menos un campo"):
        ProjectPatch()
    with pytest.raises(ValidationError, match="al menos un campo"):
        TaskPatch()


def test_task_rejects_unknown_status_and_priority() -> None:
    with pytest.raises(ValidationError):
        TaskCreate(title="Hormigonar losa", status="started")
    with pytest.raises(ValidationError):
        TaskCreate(title="Hormigonar losa", priority="critical")


def test_task_defaults_are_safe() -> None:
    task = TaskCreate(title="Preparar armaduras")
    assert task.task_type == "work"
    assert task.status == "pending"
    assert task.priority == "normal"

