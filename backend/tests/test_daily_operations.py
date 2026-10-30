from datetime import date, datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine

from app.api.routes import daily_operations
from app.api.schemas.daily_operations import DailyActivityInput, RegisterInventoryDay
from app.db.base import Base
from app.main import app

COMPANY = "12345678-aaaa-4aaa-8aaa-123456789abc"
PROJECT = "f43f11c9-898a-489a-8acd-923858b23418"


def test_activity_revision_changes_with_content_or_registration():
    plan = SimpleNamespace(id=PROJECT, entries_json=[], registered_at=None)
    initial = daily_operations.plan_revision(plan)
    assert initial == daily_operations.plan_revision(plan)
    assert daily_operations.plan_revision(None) is None
    plan.entries_json = [{"people_count": 3}]
    edited = daily_operations.plan_revision(plan)
    assert edited != initial
    plan.registered_at = datetime.now()
    assert daily_operations.plan_revision(plan) != edited


def test_new_tables_match_models_on_empty_sqlite_schema():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    from sqlalchemy import inspect

    tables = inspect(engine).get_table_names()
    assert all(
        name in tables
        for name in (
            "inventory_day_snapshots",
            "activity_definitions",
            "daily_activity_plans",
            "inventory_restock_requests",
            "project_folders",
            "project_files",
        )
    )


def test_daily_apis_are_published_and_reject_invalid_people_count():
    paths = app.openapi()["paths"]
    prefix = "/api/v1/companies/{company_id}"
    assert "post" in paths[f"{prefix}/inventory/days"]
    assert "put" in paths[f"{prefix}/daily-activity-plans/{{plan_date}}"]
    assert "post" in paths[f"{prefix}/projects/{{project_id}}/files"]
    with pytest.raises(ValueError):
        DailyActivityInput(
            plan_date=date.today(),
            entries=[
                {
                    "project_id": PROJECT,
                    "activity_definition_id": None,
                    "people_count": 5,
                }
            ],
        )
    with pytest.raises(ValueError):
        RegisterInventoryDay(snapshot_date=date.today(), assignments=[{"item_id": "short"}])


def test_only_owner_admin_or_explicitly_delegated_user_can_close_inventory():
    for role, delegated, allowed in (
        ("owner", False, True),
        ("admin", False, True),
        ("warehouse", False, False),
        ("worker", True, True),
    ):
        actor = SimpleNamespace(role=role, can_register_inventory_day=delegated)
        if allowed:
            daily_operations.require_day_registrar(actor)
        else:
            with pytest.raises(HTTPException) as exc:
                daily_operations.require_day_registrar(actor)
            assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_tool_verification_requires_same_date_close_and_sums_matching_equipment(monkeypatch):
    entry = {
        "project_id": PROJECT,
        "project_name": "Obra",
        "activity_definition_id": COMPANY,
        "activity_title": "Perforar",
        "requirements": [{"name": "Taladro", "quantity": "2"}],
        "people_count": 3,
        "note": None,
    }
    plan = SimpleNamespace(id=COMPANY, entries_json=[entry], registered_at=None)

    async def missing_snapshot(*_):
        return None

    monkeypatch.setattr(daily_operations, "last_snapshot", missing_snapshot)
    response = await daily_operations.present_plan(None, COMPANY, date.today(), plan)
    assert response.entries[0].verification == "incomplete"
    assert response.inventory_registered_at is None

    async def same_date_snapshot(*_):
        return SimpleNamespace(
            registered_at=datetime.now(),
            items_json=[
                {"name": "taladro", "project_id": PROJECT, "quantity": "1", "status": "assigned"},
                {"name": "Taladro", "project_id": PROJECT, "quantity": "1", "status": "assigned"},
                {"name": "Taladro", "project_id": COMPANY, "quantity": "50", "status": "assigned"},
            ],
        )

    monkeypatch.setattr(daily_operations, "last_snapshot", same_date_snapshot)
    response = await daily_operations.present_plan(None, COMPANY, date.today(), plan)
    assert response.entries[0].verification == "ready"
    assert response.total_people == 3

    entry["requirements"] = [{"name": "Taladro", "quantity": "3"}]
    response = await daily_operations.present_plan(None, COMPANY, date.today(), plan)
    assert response.entries[0].verification == "missing"
    assert response.entries[0].missing_tools == ["Taladro"]


def test_operational_drive_refuses_backup_remote(monkeypatch, tmp_path):
    monkeypatch.setattr(daily_operations, "today", lambda: date.today())
    from app.core import config
    from app.services import project_drive

    monkeypatch.setattr(
        config,
        "get_settings",
        lambda: SimpleNamespace(
            drive_document_remote="gdrive-crypt:", drive_document_config=tmp_path
        ),
    )
    monkeypatch.setattr(project_drive, "get_settings", config.get_settings)
    with pytest.raises(HTTPException) as exc:
        project_drive.drive_location(
            "1234567890abcdef1234567890abcdef/1234567890abcdef1234567890abcdef/1234567890abcdef1234567890abcdef"
        )
    assert exc.value.status_code == 503
