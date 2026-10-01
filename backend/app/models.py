"""ORM-модели. Схема создаётся рукописными миграциями (alembic/versions),
модели только отражают её — autogenerate не используется."""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

TZ = TIMESTAMP(timezone=True)

CARD_STATUSES = ("detected", "on_review", "accepted", "returned")
PHOTO_KINDS = ("before", "after")
EVENT_KINDS = ("created", "after_uploaded", "accepted", "returned")
# Где найден люк: ДТ — дворовая территория, ОДХ — объект дорожного хозяйства.
PLACE_KINDS = ("dt", "odh")

# Служебный район журнала обходов для объектов без района — в своде и в
# выборе района его быть не должно.
UNKNOWN_DISTRICT_NAME = "Неизвестный район"


class Base(DeclarativeBase):
    pass


class District(Base):
    __tablename__ = "districts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    synced_at: Mapped[datetime] = mapped_column(TZ, nullable=False, server_default=text("now()"))


class User(Base):
    """Снимок пользователя журнала обходов на момент последнего входа."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    login: Mapped[str] = mapped_column(Text, nullable=False)
    full_name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    # Без FK на districts: район приходит из журнала обходов и может
    # оказаться ещё не синхронизированным (синхронизация районов — best effort).
    district_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(TZ, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZ, nullable=False, server_default=text("now()"))

    @property
    def is_prefecture(self) -> bool:
        return self.role == "admin"


class Territory(Base):
    """Объект реестра АСУ ОДС (ДТ или ОДХ), см. app/load_territories.py."""
    __tablename__ = "territories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    kind: Mapped[str] = mapped_column(String(3), nullable=False)
    registry_id: Mapped[str] = mapped_column(Text, nullable=False)
    short_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    district_names: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default=text("'{}'"))
    district_keys: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default=text("'{}'"))
    owner: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(Text, nullable=True)
    area_m2: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    passport_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    polygons: Mapped[list] = mapped_column(JSONB, nullable=False)
    min_lat: Mapped[float] = mapped_column(Float, nullable=False)
    min_lon: Mapped[float] = mapped_column(Float, nullable=False)
    max_lat: Mapped[float] = mapped_column(Float, nullable=False)
    max_lon: Mapped[float] = mapped_column(Float, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    updated_at: Mapped[datetime] = mapped_column(TZ, nullable=False, server_default=text("now()"))


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        unique=True,
        server_default=text("nextval('card_number_seq')"),
    )
    district_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("districts.id"), nullable=False
    )
    # Название объекта ДТ/ОДХ на момент фиксации (+ уточнение через «—»):
    # справочник обновляется из реестра, а адрес в карточке меняться не должен.
    address: Mapped[str] = mapped_column(Text, nullable=False)
    place_kind: Mapped[str | None] = mapped_column(String(3), nullable=True)
    territory_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("territories.id"), nullable=True
    )
    address_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    lon: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'detected'")
    )
    # Номер текущей попытки исправления (0 — фото ПОСЛЕ ещё не было).
    current_attempt: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(TZ, nullable=False, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(TZ, nullable=False, server_default=text("now()"))
    accepted_at: Mapped[datetime | None] = mapped_column(TZ, nullable=True)
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    district: Mapped[District] = relationship(lazy="raise")
    territory: Mapped[Territory | None] = relationship(lazy="raise")
    creator: Mapped[User] = relationship(foreign_keys=[created_by], lazy="raise")
    photos: Mapped[list["CardPhoto"]] = relationship(
        back_populates="card", lazy="raise", order_by="CardPhoto.created_at"
    )
    events: Mapped[list["CardEvent"]] = relationship(
        back_populates="card", lazy="raise", order_by="CardEvent.created_at"
    )


class CardPhoto(Base):
    __tablename__ = "card_photos"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    thumbnail_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    preview_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(TZ, nullable=False, server_default=text("now()"))

    card: Mapped[Card] = relationship(back_populates="photos", lazy="raise")
    uploader: Mapped[User] = relationship(lazy="raise")


class CardEvent(Base):
    __tablename__ = "card_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    attempt: Mapped[int | None] = mapped_column(Integer, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(TZ, nullable=False, server_default=text("now()"))

    card: Mapped[Card] = relationship(back_populates="events", lazy="raise")
    user: Mapped[User] = relationship(lazy="raise")


class TokenBlocklist(Base):
    """Отозванные при выходе JWT по jti. Строки живут до exp токена —
    чистит их периодический DELETE (см. alembic 0002), уникальность jti не
    нужна: повторный выход с тем же токеном — штатная ситуация."""

    __tablename__ = "token_blocklist"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    jti: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(TZ, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TZ, nullable=False, server_default=text("now()"))


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZ, nullable=False, server_default=text("now()"))
