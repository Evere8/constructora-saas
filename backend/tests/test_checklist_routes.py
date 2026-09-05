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
