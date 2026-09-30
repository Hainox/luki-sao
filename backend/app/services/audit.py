"""Журнал важных действий (вход, создание карточки, фото, решения префектуры)."""
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


def log_action(
    db: AsyncSession,
    user_id: UUID | None,
    action: str,
    entity_type: str | None = None,
    entity_id: str | UUID | None = None,
    details: dict[str, Any] | None = None,
    ip: str | None = None,
) -> None:
    """Добавляет запись в текущую транзакцию — коммитит вызывающий код,
    чтобы запись аудита и само действие фиксировались вместе."""
    db.add(AuditLog(
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        details=details,
        ip=ip,
    ))
