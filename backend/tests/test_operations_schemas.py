from datetime import date

import pytest
from pydantic import ValidationError

from app.api.schemas.operations import (
    LevelCreate,
    LevelPlanGeometry,
    ProjectCreate,
    ProjectPatch,
    TaskCreate,
    TaskPatch,
)


def test_project_rejects_invalid_date_range() -> None:
    with pytest.raises(ValidationError, match="fecha final prevista"):
        ProjectCreate(
            name="Edificio Centro",
            start_date=date(2026, 9, 10),
            planned_end_date=date(2026, 9, 9),
        )


def test_project_accepts_address_and_planned_end_date() -> None:
    project = ProjectCreate(
        name="Edificio Centro",
        address="Avda. Principal 123",
        planned_end_date=date(2026, 12, 20),
    )
    assert project.address == "Avda. Principal 123"
    assert project.planned_end_date == date(2026, 12, 20)


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


def test_level_mapping_requires_its_plan_and_stays_inside_the_canvas() -> None:
    with pytest.raises(ValidationError, match="Seleccione la versión"):
        LevelCreate(
            name="Nivel 2",
            plan_geometry_json={"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1},
        )
    with pytest.raises(ValidationError, match="dentro del plano"):
        LevelPlanGeometry(x=0.9, y=0.1, width=0.2, height=0.2)

    level = LevelCreate(
        name="Nivel 2",
        building_name="Torre 1",
        work_status="concreted",
        plan_version_id="6f6dbbad-0a29-4e7d-8c82-9616a749d0df",
        plan_geometry_json={"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1},
    )
    assert level.building_name == "Torre 1"
    assert level.plan_geometry_json is not None
