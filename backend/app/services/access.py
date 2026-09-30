"""Права доступа.

Роли журнала обходов переносятся так:
  admin                → префектура: видит всё, принимает/возвращает, может
                          создать карточку в любом районе;
  inspector / reviewer → сотрудник района: журнал и действия только в своём
                          районе. Без района (у проверяющего округа) —
                          просмотр всего округа, но без создания и исправления.
Свод по люкам открыт всем вошедшим.
"""
from uuid import UUID

from fastapi import HTTPException

from app.models import Card, User

NO_DISTRICT_MESSAGE = (
    "В журнале обходов вам не назначен район — зафиксировать нарушение нельзя. "
    "Обратитесь к администратору журнала обходов."
)


def journal_scope(user: User) -> UUID | None:
    """Район, которым ограничен журнал пользователя; None — весь округ."""
    if user.is_prefecture:
        return None
    return user.district_id


def resolve_district_filter(user: User, requested: UUID | None) -> UUID | None:
    scope = journal_scope(user)
    if scope is None:
        return requested
    if requested is not None and requested != scope:
        raise HTTPException(403, "Журнал другого района вам недоступен")
    return scope


def can_view(user: User, card: Card) -> bool:
    scope = journal_scope(user)
    return scope is None or card.district_id == scope


def can_create(user: User) -> bool:
    return user.is_prefecture or user.district_id is not None


def can_work_in_district(user: User, district_id: UUID) -> bool:
    return user.is_prefecture or (user.district_id is not None and user.district_id == district_id)


def can_add_before(user: User, card: Card, before_count: int, max_photos: int) -> bool:
    return (
        card.created_by == user.id
        and card.status == "detected"
        and card.current_attempt == 0
        and before_count < max_photos
    )


def can_add_after(user: User, card: Card, latest_after_count: int, max_photos: int) -> bool:
    if not can_work_in_district(user, card.district_id):
        return False
    if card.status in ("detected", "returned"):
        return True
    return card.status == "on_review" and latest_after_count < max_photos


def can_review(user: User, card: Card) -> bool:
    return user.is_prefecture and card.status == "on_review"
