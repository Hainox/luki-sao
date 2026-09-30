"""Конфигурация приложения (переменные окружения / .env)."""
from pydantic_settings import BaseSettings

DEV_SECRET_KEY = "dev-secret-change-in-production-32"


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/luki_sao"
    SECRET_KEY: str = DEV_SECRET_KEY
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 часов — одна смена
    UPLOAD_DIR: str = "uploads"
    MAX_PHOTO_SIZE_MB: int = 20
    MAX_PHOTOS_PER_SET: int = 5
    APP_ENV: str = "development"
    CORS_ORIGINS: str = "http://localhost:5173"
    # Журнал обходов (JiraJura) — единственный источник логинов/паролей и
    # списка районов. На проде — внутренний адрес его api-контейнера в общей
    # docker-сети jirajura_default.
    JIRAJURA_API_URL: str = "http://api:8000"
    JIRAJURA_TIMEOUT_SECONDS: float = 10.0

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def max_photo_bytes(self) -> int:
        return self.MAX_PHOTO_SIZE_MB * 1024 * 1024


settings = Settings()
