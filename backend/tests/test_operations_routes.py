from datetime import date
from types import SimpleNamespace

from app.api.routes.operations import add_activity
from app.main import app


def test_openapi_exposes_company_operation_routes() -> None:
    paths = app.openapi()["paths"]
    prefix = "/api/v1/companies/{company_id}"

    assert f"{prefix}/projects" in paths
    assert f"{prefix}/projects/{{project_id}}/levels" in paths
    assert f"{prefix}/projects/{{project_id}}/sectors" in paths
    assert f"{prefix}/projects/{{project_id}}/tasks" in paths
    assert "post" in paths[f"{prefix}/projects"]
    assert "patch" in paths[f"{prefix}/projects/{{project_id}}/tasks/{{task_id}}"]
    assert "delete" in paths[f"{prefix}/projects/{{project_id}}/tasks/{{task_id}}"]
    assert "delete" in paths[f"{prefix}/projects/{{project_id}}/levels/{{level_id}}"]
    assert "patch" in paths[f"{prefix}/projects/{{project_id}}/sectors/{{sector_id}}"]


def test_openapi_exposes_company_onboarding_route() -> None:
    path = app.openapi()["paths"]["/api/v1/platform/companies/onboard"]
    assert "post" in path


def test_openapi_exposes_elongation_v2_routes_without_removing_legacy_documents() -> None:
    paths = app.openapi()["paths"]
    prefix = "/api/v1/companies/{company_id}/projects/{project_id}"

    assert f"{prefix}/documents" in paths
    assert f"{prefix}/elongation-jobs" in paths
    assert f"{prefix}/elongation-jobs/{{job_id}}/approve-theory" in paths
    assert f"{prefix}/elongation-jobs/{{job_id}}/measurement-files" in paths
    assert "delete" in paths[f"{prefix}/elongation-jobs/{{job_id}}/files/{{file_id}}"]
    assert f"{prefix}/elongation-jobs/{{job_id}}/exports/final" in paths
    assert "delete" in paths[f"{prefix}/elongation-jobs/{{job_id}}"]


def test_openapi_exposes_project_plan_board_routes() -> None:
    paths = app.openapi()["paths"]
    prefix = "/api/v1/companies/{company_id}/projects/{project_id}"

    assert f"{prefix}/plans/overview" in paths
    assert f"{prefix}/plans/versions/{{version_id}}/preview" in paths
    assert f"{prefix}/plans/versions/{{version_id}}/detect-levels" in paths
    assert f"{prefix}/plans/annotations/{{annotation_id}}" in paths
    assert f"{prefix}/levels/{{level_id}}/checklist-template" in paths


def test_openapi_exposes_inventory_relocation_actions() -> None:
    paths = app.openapi()["paths"]
    prefix = "/api/v1/companies/{company_id}/inventory/relocations/{relocation_id}"

    assert f"{prefix}/start" in paths
    assert f"{prefix}/complete" in paths
    assert f"{prefix}/cancel" in paths


def test_openapi_exposes_task_library_and_daily_task_routes() -> None:
    paths = app.openapi()["paths"]
    prefix = "/api/v1/companies/{company_id}"

    assert f"{prefix}/task-templates" in paths
    assert f"{prefix}/task-templates/{{template_id}}" in paths
    assert f"{prefix}/daily-tasks" in paths
    assert f"{prefix}/daily-tasks/{{daily_task_id}}/checklist/{{item_id}}" in paths


def test_activity_metadata_serializes_checklist_dates() -> None:
    added: list[object] = []
    db = SimpleNamespace(add=added.append)
    access = SimpleNamespace(company_id="company-1", user=SimpleNamespace(id="user-1"))

    add_activity(
        db,
        access,
        "checklist.updated",
        "checklist_item",
        "item-1",
        {"performed_on": date(2026, 9, 5)},
    )

    assert added[0].metadata_json == {"performed_on": "2026-09-05"}
