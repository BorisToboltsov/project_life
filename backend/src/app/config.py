from functools import lru_cache
from typing import Literal, Self

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Секрет для разработки и тестов. На сервере обязан быть заменён — см. проверку ниже.
DEV_JWT_SECRET = "dev-only-secret-never-use-in-production"  # noqa: S105
# Сколько раз в минуту сервер обращается к Open Food Facts: за продуктом по штрихкоду и с
# поиском по названию. Сам сервис отвечает с одного адреса на 15 запросов продукта в
# минуту; предел нового поиска он не называет, у прежнего — 10. Держимся ниже.
OFF_PRODUCTS_PER_MINUTE = 12
OFF_SEARCHES_PER_MINUTE = 8


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LIFE_", env_file=".env", extra="ignore")

    environment: Literal["dev", "test", "prod"] = "dev"
    # Значение по умолчанию — локальная БД из compose.dev.yaml; на сервере задаётся окружением.
    database_url: str = "postgresql+psycopg://life:life@localhost:5433/life"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    # Адрес приложения для ссылок, которые печатает CLI.
    public_url: str = "http://localhost:5173"

    storage_url: str = "http://localhost:3900"
    storage_key: str = "GK11111111111111111111111111111111"
    storage_secret: SecretStr = SecretStr("dev-only-storage-secret")
    storage_staging_bucket: str = "life-uploads"
    storage_objects_bucket: str = "life-files"
    storage_quota_bytes: int = 20 * 1024 * 1024 * 1024

    jwt_secret: SecretStr = SecretStr(DEV_JWT_SECRET)
    access_ttl_minutes: int = 15
    refresh_ttl_days: int = 30
    # Окно, в котором повторно предъявленный refresh-токен считается повтором запроса (ADR 0001).
    refresh_grace_seconds: int = 10
    invite_ttl_days: int = 7
    password_reset_ttl_hours: int = 24

    login_window_minutes: int = 15
    login_max_failures_per_email: int = 10
    login_max_failures_per_ip: int = 30

    # Адрес Open Food Facts, где сервер ищет продукт по штрихкоду (ADR 0009). Пусто — наружу
    # не ходим: штрихкод ищется только в своём каталоге.
    off_url: str = "https://world.openfoodfacts.org"
    # Адрес поиска Open Food Facts по названию (ADR 0010). Пусто — по названию продукт
    # ищется только в своём каталоге; без `off_url` этот адрес не используется.
    off_search_url: str = "https://search.openfoodfacts.org"
    # Пределы берегут чужой сервис. Поднимает их только стенд, где сервис подменный.
    off_products_per_minute: int = OFF_PRODUCTS_PER_MINUTE
    off_searches_per_minute: int = OFF_SEARCHES_PER_MINUTE

    @model_validator(mode="after")
    def _require_real_secret_in_prod(self) -> Self:
        secret = self.jwt_secret.get_secret_value()
        if self.environment == "prod" and (secret == DEV_JWT_SECRET or len(secret) < 32):
            raise ValueError("LIFE_JWT_SECRET обязан быть задан и содержать не меньше 32 символов")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
