"""Период отбора карточек — по дате создания карточки, по московскому времени."""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import HTTPException

MSK = ZoneInfo("Europe/Moscow")

PeriodKind = Literal["all", "today", "week", "month", "custom"]

PERIOD_LABELS: dict[str, str] = {
    "all": "За всё время",
    "today": "Сегодня",
    "week": "Неделя",
    "month": "Месяц",
    "custom": "Свой период",
}


@dataclass(frozen=True)
class Period:
    kind: str
    date_from: date | None  # включительно, по МСК
    date_to: date | None  # включительно, по МСК

    @property
    def utc_bounds(self) -> tuple[datetime | None, datetime | None]:
        """Полуоткрытый интервал [from, to) в UTC для сравнения с timestamptz.

        Полночь берётся именно по Москве: карточка, созданная в 00:30 МСК
        (21:30 UTC накануне), относится к «сегодня», а не ко вчерашнему дню.
        """
        start = (
            datetime.combine(self.date_from, time.min, tzinfo=MSK).astimezone(timezone.utc)
            if self.date_from else None
        )
        end = (
            datetime.combine(self.date_to + timedelta(days=1), time.min, tzinfo=MSK).astimezone(timezone.utc)
            if self.date_to else None
        )
        return start, end

    @property
    def label(self) -> str:
        if self.kind == "all":
            return PERIOD_LABELS["all"]
        assert self.date_from and self.date_to
        if self.date_from == self.date_to:
            return self.date_from.strftime("%d.%m.%Y")
        return f"{self.date_from.strftime('%d.%m.%Y')} — {self.date_to.strftime('%d.%m.%Y')}"


def msk_today(now: datetime | None = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(MSK).date()


def resolve_period(
    kind: str,
    date_from: date | None = None,
    date_to: date | None = None,
    now: datetime | None = None,
) -> Period:
    """«Неделя» и «Месяц» — скользящие окна (последние 7 и 30 дней, включая
    сегодня), а не календарные: в понедельник календарная неделя была бы
    почти пустой и свод выглядел бы как провал."""
    today = msk_today(now)
    if kind == "all":
        return Period("all", None, None)
    if kind == "today":
        return Period("today", today, today)
    if kind == "week":
        return Period("week", today - timedelta(days=6), today)
    if kind == "month":
        return Period("month", today - timedelta(days=29), today)
    if kind == "custom":
        if date_from is None and date_to is None:
            raise HTTPException(422, "Укажите хотя бы одну дату периода")
        start = date_from or date_to
        end = date_to or date_from
        assert start and end
        if start > end:
            raise HTTPException(422, "Дата начала периода позже даты окончания")
        return Period("custom", start, end)
    raise HTTPException(422, "Неизвестный период")
