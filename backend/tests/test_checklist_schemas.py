import pytest
from pydantic import ValidationError

from app.api.schemas.checklists import ChecklistCreate, ChecklistPatch


def test_checklist_defaults_to_pending() -> None:
    item = ChecklistCreate(title="Verificar armaduras")
    assert item.status == "pending"
    assert item.assigned_user_id is None


def test_checklist_rejects_unknown_status() -> None:
    with pytest.raises(ValidationError):
        ChecklistCreate(title="Verificar armaduras", status="approved")


def test_checklist_patch_requires_a_change() -> None:
    with pytest.raises(ValidationError, match="al menos un campo"):
        ChecklistPatch()

