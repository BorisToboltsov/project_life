from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel


class ErrorCode(StrEnum):
    """Коды ошибок API. Текст для пользователя подбирает фронтенд по коду."""

    NOT_AUTHENTICATED = "not_authenticated"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    INVALID_CREDENTIALS = "invalid_credentials"
    TOO_MANY_ATTEMPTS = "too_many_attempts"
    INVITE_INVALID = "invite_invalid"
    RESET_INVALID = "reset_invalid"
    EMAIL_TAKEN = "email_taken"
    WRONG_PASSWORD = "wrong_password"  # noqa: S105


class ErrorResponse(BaseModel):
    detail: ErrorCode


class ApiError(HTTPException):
    def __init__(
        self, status_code: int, code: ErrorCode, headers: Mapping[str, str] | None = None
    ) -> None:
        super().__init__(status_code, code.value, dict(headers) if headers else None)


def error_responses(*status_codes: int) -> dict[int | str, dict[str, Any]]:
    """Описание ошибочных ответов для OpenAPI — из него фронтенд получает типы кодов."""
    return {status_code: {"model": ErrorResponse} for status_code in status_codes}
