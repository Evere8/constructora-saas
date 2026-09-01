import pytest
from pydantic import ValidationError

from app.api.schemas.platform import CompanyCreate, CompanyPatch, MembershipCreate, PlanPatch


def test_company_slug_must_be_url_safe() -> None:
    company = CompanyCreate(name="Constructora Uno", slug="constructora-uno")
    assert company.slug == "constructora-uno"

    with pytest.raises(ValidationError):
        CompanyCreate(name="Constructora Uno", slug="Constructora Uno")


def test_patch_requires_at_least_one_change() -> None:
    with pytest.raises(ValidationError, match="al menos un campo"):
        CompanyPatch()
    with pytest.raises(ValidationError, match="al menos un campo"):
        PlanPatch()


def test_membership_rejects_unknown_role() -> None:
    with pytest.raises(ValidationError):
        MembershipCreate(user_id="a" * 36, role="platform_admin")
