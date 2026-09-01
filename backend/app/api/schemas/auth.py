from pydantic import BaseModel


class MembershipSummary(BaseModel):
    company_id: str
    company_name: str
    company_slug: str
    company_status: str
    role: str
    membership_status: str


class CurrentUserResponse(BaseModel):
    id: str
    supabase_user_id: str
    email: str
    full_name: str | None
    status: str
    is_platform_admin: bool
    session_id: str | None
    memberships: list[MembershipSummary]
