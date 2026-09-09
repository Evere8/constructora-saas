from app.api.routes.checklists import derive_level_work_status
from app.main import app


def test_openapi_exposes_checklist_routes() -> None:
    paths = app.openapi()["paths"]
    prefix = "/api/v1/companies/{company_id}/projects/{project_id}/checklist"

    assert prefix in paths
    assert f"{prefix}/progress" in paths
    assert f"{prefix}/{{item_id}}" in paths
    assert "get" in paths[prefix]
    assert "post" in paths[prefix]
    assert "patch" in paths[f"{prefix}/{{item_id}}"]
    evidence_path = f"{prefix}/{{item_id}}/evidence"
    evidence_file_path = f"{evidence_path}/{{evidence_id}}/file"
    assert "get" in paths[evidence_path]
    assert "post" in paths[evidence_path]
    assert "get" in paths[evidence_file_path]


def test_level_status_follows_its_checklist_progress() -> None:
    assert derive_level_work_status(["pending", "pending"]) == "pending"
    assert derive_level_work_status(["completed", "pending"]) == "in_progress"
    assert derive_level_work_status(["blocked", "pending"]) == "in_progress"
    assert derive_level_work_status(["completed", "not_applicable"]) == "concreted"
