import pytest
from pydantic import ValidationError

from app.api.schemas.platform import (
    CompanyCreate,
    CompanyOnboardingCreate,
    CompanyPatch,
    MembershipCreate,
    PlanPatch,
)


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
        MembershipCreate(email="owner@example.com", role="platform_admin")


def test_onboarding_normalizes_owner_email() -> None:
    payload = CompanyOnboardingCreate(
        name="Constructora Uno",
        slug="constructora-uno",
        owner_email="  OWNER@Example.COM ",
        owner_full_name="Ana Propietaria",
    )
    assert payload.owner_email == "owner@example.com"


def test_membership_requires_valid_email() -> None:
    with pytest.raises(ValidationError, match="correo válido"):
        MembershipCreate(email="correo-invalido", role="viewer")
