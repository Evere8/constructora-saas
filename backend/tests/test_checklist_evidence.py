from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.routes.checklists import evidence_path, require_evidence_access


def test_evidence_path_rejects_directory_traversal() -> None:
    with pytest.raises(HTTPException) as exc_info:
        evidence_path("../fuera-del-almacenamiento.pdf")

    assert exc_info.value.status_code == 500


def test_editor_can_add_evidence() -> None:
    access = SimpleNamespace(role="engineer", user=SimpleNamespace(id="user-1"))
    item = SimpleNamespace(assigned_user_id=None)

    require_evidence_access(access, item)


def test_assigned_worker_can_add_evidence() -> None:
    access = SimpleNamespace(role="worker", user=SimpleNamespace(id="user-1"))
    item = SimpleNamespace(assigned_user_id="user-1")

    require_evidence_access(access, item)


def test_unassigned_worker_cannot_add_evidence() -> None:
    access = SimpleNamespace(role="worker", user=SimpleNamespace(id="user-1"))
    item = SimpleNamespace(assigned_user_id="user-2")

    with pytest.raises(HTTPException) as exc_info:
        require_evidence_access(access, item)

    assert exc_info.value.status_code == 403
