"""Конфигурация приложения (переменные окружения / .env)."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Ключ-подпись JWT не имеет значения по умолчанию специально: без SECRET_KEY
# в окружении приложение падает при старте в любом окружении (а не только в
# production). Иначе прод, запущенный без APP_ENV=production, молча подписывал
# бы токены известным из репозитория значением.
DEV_SECRET_KEY = "dev-secret-change-in-production-32"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/luki_sao"
    SECRET_KEY: str = Field(min_length=32)  # type: ignore[call-arg]  # обязателен в env/.env
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=480, le=480)  # 8 часов — одна смена
    UPLOAD_DIR: str = "uploads"
    MAX_PHOTO_SIZE_MB: int = 20
    MAX_PHOTOS_PER_SET: int = 5
    APP_ENV: str = "development"
    CORS_ORIGINS: str = "http://localhost:5173"
    # Доверенные прокси для заголовков X-Forwarded-For/X-Real-IP (uvicorn
    # --forwarded-allow-ips): только docker-сети и loopback. "*" здесь нельзя —
    # тогда любой контейнер в общей сети мог бы подделать клиентский IP.
    FORWARDED_ALLOW_IPS: str = "127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
    # Окно входа без капчи на один IP: защита от перебора через наш прокси
    # независимо от лимита журнала обходов выше по цепочке.
    LOGIN_RATE_LIMIT_PER_MINUTE: int = 10
    # Журнал обходов (JiraJura) — единственный источник логинов/паролей и
    # списка районов. На проде — внутренний адрес его api-контейнера в общей
    # docker-сети jirajura_default.
    JIRAJURA_API_URL: str = "http://api:8000"
    JIRAJURA_TIMEOUT_SECONDS: float = 10.0

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def max_photo_bytes(self) -> int:
        return self.MAX_PHOTO_SIZE_MB * 1024 * 1024


settings = Settings()  # type: ignore[call-arg]  # SECRET_KEY приходит из окружения
