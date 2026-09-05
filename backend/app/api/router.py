from fastapi import APIRouter

from app.api.routes import (
    alerts,
    auth,
    checklists,
    company_admin,
    documents,
    elongations,
    health,
    inventory,
    operations,
    plans,
    platform,
    reports,
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
    elongations.router,
    prefix="/v1/companies/{company_id}",
    tags=["elongations"],
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
api_router.include_router(
    alerts.router,
    prefix="/v1/companies/{company_id}",
    tags=["alerts"],
)
api_router.include_router(
    reports.router,
    prefix="/v1/companies/{company_id}",
    tags=["reports"],
)
