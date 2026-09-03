from app.main import app


def test_openapi_exposes_company_operation_routes() -> None:
    paths = app.openapi()["paths"]
    prefix = "/api/v1/companies/{company_id}"

    assert f"{prefix}/projects" in paths
    assert f"{prefix}/projects/{{project_id}}/levels" in paths
    assert f"{prefix}/projects/{{project_id}}/tasks" in paths
    assert "post" in paths[f"{prefix}/projects"]
    assert "patch" in paths[f"{prefix}/projects/{{project_id}}/tasks/{{task_id}}"]
