from fastapi import APIRouter, Depends, FastAPI

from app import __version__
from app.api import admin, auth, health, me, measurements
from app.api.deps import current_user, require_admin
from app.config import get_settings
from app.errors import error_responses
from app.log import configure_logging


def create_app() -> FastAPI:
    configure_logging(get_settings().log_level)
    app = FastAPI(
        title="project_life",
        version=__version__,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )

    # Открытые эндпоинты перечислены поимённо; всё остальное закрыто на уровне роутера,
    # так что новый эндпоинт нельзя забыть защитить (инвариант I5).
    public = APIRouter(prefix="/api")
    public.include_router(health.router)
    public.include_router(auth.public)

    private = APIRouter(
        prefix="/api", dependencies=[Depends(current_user)], responses=error_responses(401)
    )
    private.include_router(auth.private)
    private.include_router(me.router)
    private.include_router(measurements.router)

    admin_only = APIRouter(
        prefix="/api", dependencies=[Depends(require_admin)], responses=error_responses(401, 403)
    )
    admin_only.include_router(admin.router)

    app.include_router(public)
    app.include_router(private)
    app.include_router(admin_only)
    return app


app = create_app()
