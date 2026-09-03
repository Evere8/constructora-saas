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
