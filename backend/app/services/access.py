"""Права доступа.

Роли журнала обходов переносятся так:
  admin                → префектура: видит всё, принимает/возвращает, может
                          создать карточку в любом районе;
  inspector / reviewer → сотрудник района: журнал и действия только в своём
                          районе. Проверяющий без района (проверяющий округа) —
                          просмотр всего округа, но без создания и исправления.
                          Инспектор без района журнала не видит вовсе: в
                          журнале обходов это незавершённая настройка
                          аккаунта, и тот отдаёт ему пустой список районов.
Свод по люкам открыт всем вошедшим.
"""
from uuid import UUID

from fastapi import HTTPException

from app.models import Card, User

NO_DISTRICT_MESSAGE = (
    "В журнале обходов вам не назначен район — зафиксировать нарушение нельзя. "
    "Обратитесь к администратору журнала обходов."
)


NO_DISTRICT_JOURNAL_MESSAGE = (
    "В журнале обходов вам не назначен район — журнал недоступен. "
    "Обратитесь к администратору журнала обходов."
)


def sees_whole_okrug(user: User) -> bool:
    return user.is_prefecture or (user.role == "reviewer" and user.district_id is None)


def resolve_district_filter(user: User, requested: UUID | None) -> UUID | None:
    if sees_whole_okrug(user):
        return requested
    if user.district_id is None:
        raise HTTPException(403, NO_DISTRICT_JOURNAL_MESSAGE)
    if requested is not None and requested != user.district_id:
        raise HTTPException(403, "Журнал другого района вам недоступен")
    return user.district_id


def can_view(user: User, card: Card) -> bool:
    if sees_whole_okrug(user):
        return True
    return user.district_id is not None and card.district_id == user.district_id


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
