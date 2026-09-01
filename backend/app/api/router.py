from fastapi import APIRouter

from app.api.routes import auth, health, platform

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(auth.router, prefix="/v1/auth", tags=["auth"])
api_router.include_router(platform.router, prefix="/v1/platform", tags=["platform"])
