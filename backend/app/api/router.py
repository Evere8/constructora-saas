from fastapi import APIRouter

from app.api.routes import (
    auth,
    checklists,
    company_admin,
    documents,
    health,
    inventory,
    operations,
    plans,
    platform,
)

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(auth.router, prefix="/v1/auth", tags=["auth"])
api_router.include_router(platform.router, prefix="/v1/platform", tags=["platform"])
api_router.include_router(
    operations.router,
    prefix="/v1/companies/{company_id}",
    tags=["operations"],
)
api_router.include_router(
    checklists.router,
    prefix="/v1/companies/{company_id}",
    tags=["checklists"],
)
api_router.include_router(
    plans.router,
    prefix="/v1/companies/{company_id}",
    tags=["plans"],
)
api_router.include_router(
    documents.router,
    prefix="/v1/companies/{company_id}",
    tags=["documents"],
)
api_router.include_router(
    inventory.router,
    prefix="/v1/companies/{company_id}",
    tags=["inventory"],
)
api_router.include_router(
    company_admin.router,
    prefix="/v1/companies/{company_id}",
    tags=["company-admin"],
)
