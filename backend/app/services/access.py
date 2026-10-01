"""Права доступа.

Роли журнала обходов переносятся так:
  admin                → префектура: весь округ — журнал и свод по всем
                          районам; принимает/возвращает, может создать
                          карточку в любом районе;
  inspector / reviewer → сотрудник района: журнал, действия и свод только по
                          своему району.
Сотрудник без района (инспектор или проверяющий) не видит ни журнала, ни
свода: в журнале обходов это незавершённая настройка аккаунта. Весь округ и
чужие районы видит только префектура — решение владельца продукта
(docs/DECISIONS.md, «Свод и журнал по всему округу — только префектура»).
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

NO_DISTRICT_SUMMARY_MESSAGE = (
    "В журнале обходов вам не назначен район — свод недоступен. "
    "Обратитесь к администратору журнала обходов."
)
OKRUG_SUMMARY_MESSAGE = "Свод по всем районам доступен только префектуре"
OTHER_DISTRICT_SUMMARY_MESSAGE = "Статистика другого района вам недоступна"


def sees_whole_okrug(user: User) -> bool:
    return user.is_prefecture


def resolve_district_filter(user: User, requested: UUID | None) -> UUID | None:
    if sees_whole_okrug(user):
        return requested
    if user.district_id is None:
        raise HTTPException(403, NO_DISTRICT_JOURNAL_MESSAGE)
    if requested is not None and requested != user.district_id:
        raise HTTPException(403, "Журнал другого района вам недоступен")
    return user.district_id


def require_okrug_summary(user: User) -> None:
    if sees_whole_okrug(user):
        return
    if user.district_id is None:
        raise HTTPException(403, NO_DISTRICT_SUMMARY_MESSAGE)
    raise HTTPException(403, OKRUG_SUMMARY_MESSAGE)


def resolve_summary_district(user: User, requested: UUID | None) -> UUID:
    """Район для подробного свода: префектура выбирает любой, сотрудник
    района — только свой (по умолчанию он и берётся)."""
    if sees_whole_okrug(user):
        if requested is None:
            raise HTTPException(422, "Выберите район")
        return requested
    if user.district_id is None:
        raise HTTPException(403, NO_DISTRICT_SUMMARY_MESSAGE)
    if requested is not None and requested != user.district_id:
        raise HTTPException(403, OTHER_DISTRICT_SUMMARY_MESSAGE)
    return user.district_id


def resolve_work_district(user: User, requested: UUID | None) -> UUID:
    """Район, где пользователь фиксирует нарушение: префектура — любой
    выбранный, сотрудник района — только свой."""
    if user.is_prefecture:
        if requested is None:
            raise HTTPException(422, "Выберите район")
        return requested
    if user.district_id is None:
        raise HTTPException(403, NO_DISTRICT_MESSAGE)
    if requested is not None and requested != user.district_id:
        raise HTTPException(403, "Фиксировать нарушения можно только в своём районе")
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
