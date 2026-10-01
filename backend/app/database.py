"""Подключение к БД: движок создаётся лениво, а не на импорте модуля."""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    """Один движок на процесс. pool_pre_ping отсекает протухшие соединения
    после рестарта Postgres — иначе первые запросы падают с 500."""
    global _engine, _session_factory
    if _engine is None:
        _engine = create_async_engine(
            settings.DATABASE_URL,
            echo=False,
            pool_size=10,
            max_overflow=5,
            pool_pre_ping=True,
        )
        _session_factory = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)
    assert _session_factory is not None
    return _engine


async def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None


# Обратная совместимость для тестов/миграций, где движок уже импортировался.
def __getattr__(name: str):
    if name in ("engine", "async_session"):
        get_engine()
        assert _engine is not None and _session_factory is not None
        return _engine if name == "engine" else _session_factory
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


async def get_db() -> AsyncIterator[AsyncSession]:
    get_engine()
    assert _session_factory is not None
    async with _session_factory() as session:
        yield session
