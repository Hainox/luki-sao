"""Pydantic-схемы API."""
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

# Те же ограничения, что у LoginRequest журнала обходов: иначе он вернул бы
# 422 на то, что мы пропустили.
Login = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=50)]


class LoginRequest(BaseModel):
    login: Login
    password: str = Field(min_length=1, max_length=200)


class UserOut(BaseModel):
    id: UUID
    login: str
    full_name: str
    role: str
    district_id: UUID | None
    district_name: str | None
    is_prefecture: bool
    can_create_cards: bool


class TokenResponse(BaseModel):
    access_token: str
    user: UserOut


class DistrictOut(BaseModel):
    id: UUID
    name: str


# ── Карточки ────────────────────────────────────────────────────

CardStatus = Literal["detected", "on_review", "accepted", "returned"]
FilterGroup = Literal["all", "open", "on_review", "accepted"]
PlaceKind = Literal["dt", "odh"]
PlaceFilter = Literal["all", "dt", "odh"]


class TerritoryOut(BaseModel):
    id: UUID
    kind: PlaceKind
    name: str
    owner: str | None
    category: str | None
    passport_url: str | None


class NearbyTerritoryOut(TerritoryOut):
    # 0 — точка внутри контура объекта.
    distance_m: int


class CardCreate(BaseModel):
    # Клиент придумывает id один раз на форму: повторное «Зафиксировать»
    # после потерянного ответа возвращает ту же карточку, а не создаёт вторую.
    id: UUID | None = None
    district_id: UUID | None = None
    # Где найден люк — обязательно: ДТ или ОДХ и конкретный объект реестра.
    place_kind: PlaceKind
    territory_id: UUID
    # Уточнение к объекту («у подъезда 2»), необязательно.
    address_note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] | None = None
    lat: Decimal | None = Field(default=None, ge=-90, le=90, max_digits=9, decimal_places=6)
    lon: Decimal | None = Field(default=None, ge=-180, le=180, max_digits=9, decimal_places=6)
    comment: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None = None

    @model_validator(mode="before")
    @classmethod
    def _round_coords(cls, data):
        # Геолокация браузера отдаёт 14+ знаков после запятой — NUMERIC(9,6)
        # хватает с запасом (~11 см), лишнее просто округляем, а не отвергаем.
        if isinstance(data, dict):
            for key in ("lat", "lon"):
                value = data.get(key)
                if isinstance(value, (int, float)):
                    data[key] = round(float(value), 6)
        return data

    @model_validator(mode="after")
    def _coords_pair(self):
        if (self.lat is None) != (self.lon is None):
            raise ValueError("Координаты указываются парой: широта и долгота")
        if self.comment == "":
            self.comment = None
        if self.address_note == "":
            self.address_note = None
        return self


class ReturnRequest(BaseModel):
    comment: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class PersonOut(BaseModel):
    id: UUID
    full_name: str
    login: str


class PhotoOut(BaseModel):
    id: UUID
    kind: Literal["before", "after"]
    attempt: int
    url: str
    thumbnail_url: str
    original_url: str
    uploaded_by: PersonOut
    created_at: datetime


class EventOut(BaseModel):
    id: UUID
    kind: Literal["created", "after_uploaded", "accepted", "returned"]
    attempt: int | None
    comment: str | None
    user: PersonOut
    created_at: datetime


class CardPermissions(BaseModel):
    can_add_before: bool
    can_add_after: bool
    can_review: bool


class CardListItem(BaseModel):
    id: UUID
    number: int
    label: str
    district_id: UUID
    district_name: str
    address: str
    # У карточек, заведённых до справочника ДТ/ОДХ, места нет.
    place_kind: PlaceKind | None
    territory: TerritoryOut | None
    status: CardStatus
    current_attempt: int
    created_at: datetime
    created_by: PersonOut
    status_changed_at: datetime
    return_comment: str | None
    before_photo: PhotoOut | None
    before_count: int
    after_photo: PhotoOut | None
    after_count: int
    permissions: CardPermissions


class CardDetail(CardListItem):
    lat: Decimal | None
    lon: Decimal | None
    comment: str | None
    accepted_at: datetime | None
    photos: list[PhotoOut]
    events: list[EventOut]


class FilterCounts(BaseModel):
    all: int
    open: int
    on_review: int
    accepted: int


class PeriodOut(BaseModel):
    kind: str
    date_from: date | None
    date_to: date | None
    label: str


class CardListOut(BaseModel):
    items: list[CardListItem]
    total: int
    page: int
    page_size: int
    counts: FilterCounts
    period: PeriodOut


class ReviewQueueOut(BaseModel):
    items: list[CardDetail]
    total: int


# ── Свод ────────────────────────────────────────────────────────

class SummaryRow(BaseModel):
    district_id: UUID | None
    district_name: str
    detected: int
    fixed: int
    on_review: int
    percent: Decimal | None
    percent_label: str


class SummaryOut(BaseModel):
    period: PeriodOut
    place: PlaceFilter
    rows: list[SummaryRow]
    total: SummaryRow


class DistrictSummaryTotals(BaseModel):
    """По карточкам, созданным в периоде; статус — текущий."""
    detected: int
    accepted: int
    on_review: int
    # Ждут работы района: выявлено + возвращено на доработку.
    open: int
    returned_now: int
    percent_text: str
    returns_count: int
    avg_days_to_accept: float | None


class DynamicsBucket(BaseModel):
    label: str
    date_from: date
    date_to: date
    detected: int
    accepted: int
    percent_text: str


class OldestOpenCard(BaseModel):
    id: UUID
    label: str
    address: str
    place_kind: PlaceKind | None
    status: CardStatus
    created_at: datetime
    age_days: int


class DistrictSummaryOut(BaseModel):
    district: DistrictOut
    period: PeriodOut
    place: PlaceFilter
    totals: DistrictSummaryTotals
    dynamics_unit: Literal["day", "month"]
    dynamics: list[DynamicsBucket]
    oldest_open: list[OldestOpenCard]
