from fastapi import APIRouter

from app.api.dependencies import CurrentClaims

router = APIRouter()


@router.get("/me")
async def me(claims: CurrentClaims) -> dict[str, str | None]:
    return {
        "supabase_user_id": claims.subject,
        "email": claims.email,
        "session_id": claims.session_id,
    }
