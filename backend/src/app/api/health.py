from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app import __version__
from app.db import SessionDep

router = APIRouter(tags=["service"])


class Health(BaseModel):
    status: Literal["ok"]
    version: str


@router.get(
    "/health",
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"description": "База данных недоступна"}},
)
async def health(session: SessionDep) -> Health:
    try:
        await session.execute(text("SELECT 1"))
    except (SQLAlchemyError, OSError) as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "database unavailable") from error
    return Health(status="ok", version=__version__)
