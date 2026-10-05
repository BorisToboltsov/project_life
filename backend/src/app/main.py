from fastapi import FastAPI

from app import __version__
from app.api import health
from app.config import get_settings
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
    app.include_router(health.router, prefix="/api")
    return app


app = create_app()
