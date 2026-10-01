"""Карточки неудовлетворительных ОЛХ: фиксация, фото ДО/ПОСЛЕ, проверка префектурой."""

import asyncio
from datetime import date
from typing import Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.config import settings
from app.database import get_db
from app.models import UNKNOWN_DISTRICT_NAME, Card, CardEvent, CardPhoto, District, User
from app.schemas import (
    CardCreate,
    CardDetail,
    CardListItem,
    CardListOut,
    CardPermissions,
    EventOut,
    FilterCounts,
    FilterGroup,
    PeriodOut,
    PersonOut,
    PhotoOut,
    ReturnRequest,
    ReviewQueueOut,
)
from app.services import access
from app.services.audit import log_action
from app.services.formatting import card_label
from app.services.periods import Period, resolve_period
from app.services.photos import delete_stored, public_url, save_photo
from app.services.security import client_ip, get_current_user, require_prefecture

router = APIRouter()

FILTER_STATUSES: dict[str, tuple[str, ...] | None] = {
    "all": None,
    # «Выявлено (не исправлено)» — всё, что ждёт работы района, включая
    # возвращённые на доработку.
    "open": ("detected", "returned"),
    "on_review": ("on_review",),
    "accepted": ("accepted",),
}

REVIEW_QUEUE_LIMIT = 50

_CARD_OPTIONS = (
    joinedload(Card.district),
    joinedload(Card.creator),
    selectinload(Card.photos).joinedload(CardPhoto.uploader),
    selectinload(Card.events).joinedload(CardEvent.user),
)


# ── Сборка ответов ──────────────────────────────────────────────


def _person(user: User) -> PersonOut:
    return PersonOut(id=user.id, full_name=user.full_name or user.login, login=user.login)


def _photo_out(photo: CardPhoto) -> PhotoOut:
    original = public_url(photo.storage_path)
    assert original is not None
    url = public_url(photo.preview_path) or original
    thumbnail = public_url(photo.thumbnail_path) or url
    return PhotoOut(
        id=photo.id,
        kind=cast(Literal["before", "after"], photo.kind),
        attempt=photo.attempt,
        url=url,
        thumbnail_url=thumbnail,
        original_url=original,
        uploaded_by=_person(photo.uploader),
        created_at=photo.created_at,
    )


def _sorted_photos(card: Card) -> tuple[list[CardPhoto], list[CardPhoto]]:
    befores = sorted((p for p in card.photos if p.kind == "before"), key=lambda p: p.created_at)
    afters = sorted(
        (p for p in card.photos if p.kind == "after"),
        key=lambda p: (p.attempt, p.created_at),
    )
    return befores, afters


def _permissions(
    user: User, card: Card, before_count: int, latest_after_count: int
) -> CardPermissions:
    limit = settings.MAX_PHOTOS_PER_SET
    return CardPermissions(
        can_add_before=access.can_add_before(user, card, before_count, limit),
        can_add_after=access.can_add_after(user, card, latest_after_count, limit),
        can_review=access.can_review(user, card),
    )


def _list_item_fields(
    card: Card,
    user: User,
    *,
    befores: list[CardPhoto] | None = None,
    afters: list[CardPhoto] | None = None,
    events: list[CardEvent] | None = None,
) -> dict:
    if befores is None or afters is None:
        befores, afters = _sorted_photos(card)
    latest_afters = [p for p in afters if p.attempt == card.current_attempt]
    if events is None:
        events = sorted(card.events, key=lambda e: e.created_at)
    return_comment = None
    if card.status == "returned":
        returned = [e for e in events if e.kind == "returned"]
        return_comment = returned[-1].comment if returned else None
    return {
        "id": card.id,
        "number": card.number,
        "label": card_label(card.number),
        "district_id": card.district_id,
        "district_name": card.district.name,
        "address": card.address,
        "status": card.status,
        "current_attempt": card.current_attempt,
        "created_at": card.created_at,
        "created_by": _person(card.creator),
        "status_changed_at": events[-1].created_at if events else card.created_at,
        "return_comment": return_comment,
        "before_photo": _photo_out(befores[0]) if befores else None,
        "before_count": len(befores),
        "after_photo": _photo_out(latest_afters[0]) if latest_afters else None,
        "after_count": len(latest_afters),
        "permissions": _permissions(user, card, len(befores), len(latest_afters)),
    }


def _list_item(card: Card, user: User) -> CardListItem:
    return CardListItem(**_list_item_fields(card, user))


def _detail(card: Card, user: User) -> CardDetail:
    befores, afters = _sorted_photos(card)
    events = sorted(card.events, key=lambda e: e.created_at)
    return CardDetail(
        **_list_item_fields(card, user, befores=befores, afters=afters, events=events),
        lat=card.lat,
        lon=card.lon,
        comment=card.comment,
        accepted_at=card.accepted_at,
        photos=[_photo_out(p) for p in befores + afters],
        events=[
            EventOut(
                id=e.id,
                kind=cast(
                    Literal["created", "after_uploaded", "accepted", "returned"],
                    e.kind,
                ),
                attempt=e.attempt,
                comment=e.comment,
                user=_person(e.user),
                created_at=e.created_at,
            )
            for e in events
        ],
    )


def _period_out(period: Period) -> PeriodOut:
    return PeriodOut(
        kind=period.kind,
        date_from=period.date_from,
        date_to=period.date_to,
        label=period.label,
    )


# ── Загрузка карточек ───────────────────────────────────────────


async def _load_full(db: AsyncSession, card_id: UUID) -> Card | None:
    return (
        (
            await db.execute(
                select(Card)
                .where(Card.id == card_id)
                .options(*_CARD_OPTIONS)
                .execution_options(populate_existing=True)
            )
        )
        .unique()
        .scalar_one_or_none()
    )


async def _get_visible(db: AsyncSession, card_id: UUID, user: User, *, lock: bool = False) -> Card:
    q = select(Card).where(Card.id == card_id).execution_options(populate_existing=True)
    if lock:
        q = q.with_for_update()
    card = (await db.execute(q)).scalar_one_or_none()
    if card is None:
        raise HTTPException(404, "Карточка не найдена")
    if not access.can_view(user, card):
        raise HTTPException(403, "Карточка другого района вам недоступна")
    return card


async def _photo_counts(db: AsyncSession, card: Card) -> tuple[int, int]:
    before_count = (
        await db.execute(
            select(func.count())
            .select_from(CardPhoto)
            .where(CardPhoto.card_id == card.id, CardPhoto.kind == "before")
        )
    ).scalar_one()
    latest_after_count = (
        await db.execute(
            select(func.count())
            .select_from(CardPhoto)
            .where(
                CardPhoto.card_id == card.id,
                CardPhoto.kind == "after",
                CardPhoto.attempt == card.current_attempt,
            )
        )
    ).scalar_one()
    return before_count, latest_after_count


def _check_upload(
    user: User, card: Card, kind: str, before_count: int, latest_after_count: int
) -> None:
    limit = settings.MAX_PHOTOS_PER_SET
    if kind == "before":
        if card.created_by != user.id:
            raise HTTPException(403, "Фото ДО добавляет только автор карточки")
        if card.status != "detected" or card.current_attempt > 0:
            raise HTTPException(
                409, "Фото ДО больше добавить нельзя: по карточке уже есть фото ПОСЛЕ"
            )
        if before_count >= limit:
            raise HTTPException(409, f"К карточке можно приложить не больше {limit} фото ДО")
        return
    if not access.can_work_in_district(user, card.district_id):
        raise HTTPException(403, "Фото ПОСЛЕ добавляют сотрудники района карточки или префектура")
    if card.status == "accepted":
        raise HTTPException(409, "Карточка уже принята префектурой")
    if card.status == "on_review" and latest_after_count >= limit:
        raise HTTPException(409, f"За одну попытку можно приложить не больше {limit} фото ПОСЛЕ")


def _after_attempt(card: Card) -> int:
    """Попытка, в которую ляжет фото ПОСЛЕ: новая, если карточка ждёт
    исправления, иначе текущая (карточка на проверке)."""
    if card.status in ("detected", "returned"):
        return card.current_attempt + 1
    return card.current_attempt


async def _find_card(db: AsyncSession, card_id: UUID) -> Card | None:
    return await db.get(Card, card_id)


async def _repeated_create(db: AsyncSession, existing: Card, user: User) -> CardDetail:
    if existing.created_by != user.id:
        raise HTTPException(409, "Карточка с таким идентификатором уже создана другим сотрудником")
    full = await _load_full(db, existing.id)
    assert full is not None
    return _detail(full, user)


# ── Эндпоинты ───────────────────────────────────────────────────


@router.post("", response_model=CardDetail, status_code=201)
async def create_card(
    data: CardCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not access.can_create(user):
        raise HTTPException(403, access.NO_DISTRICT_MESSAGE)
    district_id: UUID
    if user.is_prefecture:
        if data.district_id is None:
            raise HTTPException(422, "Выберите район")
        district_id = data.district_id
    else:
        if data.district_id is not None and data.district_id != user.district_id:
            raise HTTPException(403, "Фиксировать нарушения можно только в своём районе")
        if user.district_id is None:
            raise HTTPException(403, access.NO_DISTRICT_MESSAGE)
        district_id = user.district_id

    district = await db.get(District, district_id)
    if district is None or district.name == UNKNOWN_DISTRICT_NAME:
        raise HTTPException(422, "Район не найден — войдите заново, чтобы обновить список районов")

    if data.id is not None:
        existing = await _find_card(db, data.id)
        if existing is not None:
            return await _repeated_create(db, existing, user)

    card = Card(
        district_id=district_id,
        address=data.address,
        lat=data.lat,
        lon=data.lon,
        comment=data.comment,
        created_by=user.id,
    )
    if data.id is not None:
        card.id = data.id
    try:
        async with db.begin_nested():
            db.add(card)
            await db.flush()
    except IntegrityError:
        # Повтор с тем же id пришёл, пока первый запрос ещё не закоммичен:
        # проверка выше его не увидела, вставка дождалась коммита и упёрлась
        # в первичный ключ. Теперь карточка видна — отвечаем как на повтор.
        existing = await _find_card(db, data.id) if data.id is not None else None
        if existing is None:
            raise
        return await _repeated_create(db, existing, user)
    await db.refresh(card)
    db.add(CardEvent(card_id=card.id, kind="created", user_id=user.id))
    log_action(
        db,
        user.id,
        "card_create",
        "card",
        card.id,
        {"number": card.number, "district_id": str(district_id)},
        client_ip(request),
    )
    await db.commit()
    created = await _load_full(db, card.id)
    assert created is not None
    return _detail(created, user)


@router.get("", response_model=CardListOut)
async def list_cards(
    district_id: UUID | None = None,
    period: str = "all",
    date_from: date | None = None,
    date_to: date | None = None,
    filter_group: FilterGroup = Query("all", alias="filter"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    district = access.resolve_district_filter(user, district_id)
    per = resolve_period(period, date_from, date_to)
    conds = []
    if district is not None:
        conds.append(Card.district_id == district)
    start, end = per.utc_bounds
    if start is not None:
        conds.append(Card.created_at >= start)
    if end is not None:
        conds.append(Card.created_at < end)

    status_rows = (
        await db.execute(select(Card.status, func.count()).where(*conds).group_by(Card.status))
    ).all()
    by_status: dict[str, int] = {row[0]: row[1] for row in status_rows}
    counts = FilterCounts(
        all=sum(by_status.values()),
        open=by_status.get("detected", 0) + by_status.get("returned", 0),
        on_review=by_status.get("on_review", 0),
        accepted=by_status.get("accepted", 0),
    )

    q = select(Card).where(*conds)
    statuses = FILTER_STATUSES[filter_group]
    if statuses is not None:
        q = q.where(Card.status.in_(statuses))
    q = (
        q.options(*_CARD_OPTIONS)
        .order_by(Card.created_at.desc(), Card.number.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    cards = (await db.execute(q)).unique().scalars().all()
    return CardListOut(
        items=[_list_item(c, user) for c in cards],
        total=getattr(counts, filter_group),
        page=page,
        page_size=page_size,
        counts=counts,
        period=_period_out(per),
    )


@router.get("/review-queue", response_model=ReviewQueueOut)
async def review_queue(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_prefecture),
):
    """Очередь префектуры: сначала то, что ждёт решения дольше всех."""
    sent = (
        select(CardEvent.card_id, func.max(CardEvent.created_at).label("sent_at"))
        .where(CardEvent.kind == "after_uploaded")
        .group_by(CardEvent.card_id)
        .subquery()
    )
    total = (
        await db.execute(select(func.count()).select_from(Card).where(Card.status == "on_review"))
    ).scalar_one()
    cards = (
        (
            await db.execute(
                select(Card)
                .join(sent, sent.c.card_id == Card.id)
                .where(Card.status == "on_review")
                .options(*_CARD_OPTIONS)
                .order_by(sent.c.sent_at.asc(), Card.number.asc())
                .limit(REVIEW_QUEUE_LIMIT)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    return ReviewQueueOut(items=[_detail(c, user) for c in cards], total=total)


@router.get("/{card_id}", response_model=CardDetail)
async def get_card(
    card_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _get_visible(db, card_id, user)
    full = await _load_full(db, card_id)
    assert full is not None
    return _detail(full, user)


@router.post("/{card_id}/photos", response_model=PhotoOut, status_code=201)
async def upload_photo(
    card_id: UUID,
    request: Request,
    kind: Literal["before", "after"] = Query(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await _get_visible(db, card_id, user)
    _check_upload(user, card, kind, *await _photo_counts(db, card))
    intended_attempt = _after_attempt(card)
    # Закрываем читающую транзакцию до приёма файла: загрузка по мобильной
    # связи идёт десятки секунд, соединение с БД не должно всё это время
    # висеть «idle in transaction». close() вместо commit(): фиксировать здесь
    # нечего, а коммит молча записал бы чужие незакоммиченные изменения.
    await db.close()

    stored = await save_photo(file, kind)
    try:
        # Повторная проверка под блокировкой строки: пока файл загружался,
        # префектура могла принять карточку, а коллега — начать новую
        # попытку. Первая фотография ПОСЛЕ попытки переводит карточку на
        # проверку; остальные фото той же попытки просто добавляются.
        card = await _get_visible(db, card_id, user, lock=True)
        _check_upload(user, card, kind, *await _photo_counts(db, card))
        attempt = 0
        if kind == "after":
            # Фото ПОСЛЕ уходят по одному, а карточка попадает в очередь
            # проверки уже после первого: если префектура вернула её, пока
            # грузилось следующее, это фото снято к отклонённой попытке и не
            # должно молча открыть новую. Параллельная загрузка в ту же
            # попытку сюда не попадает — у неё попытка та же.
            if _after_attempt(card) != intended_attempt:
                raise HTTPException(
                    409,
                    "Пока фото загружалось, префектура уже вынесла решение "
                    "по карточке — откройте её заново",
                )
            if card.status in ("detected", "returned"):
                card.current_attempt += 1
                card.status = "on_review"
                db.add(
                    CardEvent(
                        card_id=card.id,
                        kind="after_uploaded",
                        attempt=card.current_attempt,
                        user_id=user.id,
                    )
                )
            attempt = card.current_attempt
        card.updated_at = func.now()
        photo = CardPhoto(
            card_id=card.id,
            kind=kind,
            attempt=attempt,
            storage_path=stored.storage_path,
            thumbnail_path=stored.thumbnail_path,
            preview_path=stored.preview_path,
            uploaded_by=user.id,
        )
        db.add(photo)
        await db.flush()
        log_action(
            db,
            user.id,
            "photo_upload",
            "card",
            card.id,
            {"kind": kind, "attempt": attempt, "photo_id": str(photo.id)},
            client_ip(request),
        )
        await db.commit()
    except (Exception, asyncio.CancelledError):
        await db.rollback()
        delete_stored(stored)
        raise

    photo = (
        await db.execute(
            select(CardPhoto)
            .where(CardPhoto.id == photo.id)
            .options(joinedload(CardPhoto.uploader))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return _photo_out(photo)


@router.post("/{card_id}/accept", response_model=CardDetail)
async def accept_card(
    card_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_prefecture),
):
    card = await _get_visible(db, card_id, user, lock=True)
    if card.status != "on_review":
        raise HTTPException(409, "Карточка не на проверке — возможно, решение уже принято")
    card.status = "accepted"
    card.accepted_at = func.now()
    card.accepted_by = user.id
    card.updated_at = func.now()
    db.add(
        CardEvent(
            card_id=card.id,
            kind="accepted",
            attempt=card.current_attempt,
            user_id=user.id,
        )
    )
    log_action(
        db,
        user.id,
        "card_accept",
        "card",
        card.id,
        {"attempt": card.current_attempt},
        client_ip(request),
    )
    await db.commit()
    full = await _load_full(db, card_id)
    assert full is not None
    return _detail(full, user)


@router.post("/{card_id}/return", response_model=CardDetail)
async def return_card(
    card_id: UUID,
    data: ReturnRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_prefecture),
):
    card = await _get_visible(db, card_id, user, lock=True)
    if card.status != "on_review":
        raise HTTPException(409, "Карточка не на проверке — возможно, решение уже принято")
    card.status = "returned"
    card.updated_at = func.now()
    db.add(
        CardEvent(
            card_id=card.id,
            kind="returned",
            attempt=card.current_attempt,
            comment=data.comment,
            user_id=user.id,
        )
    )
    log_action(
        db,
        user.id,
        "card_return",
        "card",
        card.id,
        {"attempt": card.current_attempt, "comment": data.comment},
        client_ip(request),
    )
    await db.commit()
    full_returned = await _load_full(db, card_id)
    assert full_returned is not None
    return _detail(full_returned, user)
