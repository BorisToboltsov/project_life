from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LIFE_", env_file=".env", extra="ignore")

    environment: Literal["dev", "test", "prod"] = "dev"
    # Значение по умолчанию — локальная БД из compose.dev.yaml; на сервере задаётся окружением.
    database_url: str = "postgresql+psycopg://life:life@localhost:5433/life"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
