"""Свод по люкам: таблица по всем районам — только префектуре; подробный
свод по району — сотрудникам этого района и префектуре."""

from datetime import date
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.database import get_db
from app.models import UNKNOWN_DISTRICT_NAME, District, User
from app.schemas import DistrictSummaryOut, PeriodOut, PlaceFilter, SummaryOut
from app.services import access
from app.services.district_summary import (
    build_district_summary,
    district_summary_xlsx,
    district_xlsx_title,
)
from app.services.periods import Period, resolve_period
from app.services.security import get_current_user
from app.services.summary import build_summary, summary_xlsx
from app.services.territories import PLACE_LABELS

router = APIRouter()

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


async def okrug_summary_user(user: User = Depends(get_current_user)) -> User:
    access.require_okrug_summary(user)
    return user


def _xlsx_response(
    content: bytes,
    title: str,
    ascii_name: str,
    period: Period | PeriodOut,
    place: PlaceFilter,
) -> Response:
    if place != "all":
        title = f"{title} ({PLACE_LABELS[place]})"
    name = f"{title}.xlsx" if period.kind == "all" else f"{title} {period.label}.xlsx"
    return Response(
        content=content,
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"
            ),
        },
    )


@router.get("/summary", response_model=SummaryOut)
async def get_summary(
    period: str = "all",
    date_from: date | None = None,
    date_to: date | None = None,
    place: PlaceFilter = "all",
    db: AsyncSession = Depends(get_db),
    _: User = Depends(okrug_summary_user),
):
    return await build_summary(db, resolve_period(period, date_from, date_to), place)


@router.get("/summary.xlsx")
async def get_summary_xlsx(
    period: str = "all",
    date_from: date | None = None,
    date_to: date | None = None,
    place: PlaceFilter = "all",
    db: AsyncSession = Depends(get_db),
    _: User = Depends(okrug_summary_user),
):
    per = resolve_period(period, date_from, date_to)
    content = await run_in_threadpool(summary_xlsx, await build_summary(db, per, place))
    return _xlsx_response(content, "Свод по люкам САО", "luki-sao-svod.xlsx", per, place)


async def _district_summary(
    db: AsyncSession,
    user: User,
    district_id: UUID | None,
    period: str,
    date_from: date | None,
    date_to: date | None,
    place: PlaceFilter,
) -> DistrictSummaryOut:
    target = access.resolve_summary_district(user, district_id)
    per = resolve_period(period, date_from, date_to)
    district = await db.get(District, target)
    if district is None or district.name == UNKNOWN_DISTRICT_NAME:
        raise HTTPException(404, "Район не найден — войдите заново, чтобы обновить список районов")
    return await build_district_summary(db, district, per, place)


@router.get("/summary/district", response_model=DistrictSummaryOut)
async def get_district_summary(
    district_id: UUID | None = None,
    period: str = "all",
    date_from: date | None = None,
    date_to: date | None = None,
    place: PlaceFilter = "all",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await _district_summary(db, user, district_id, period, date_from, date_to, place)


@router.get("/summary/district.xlsx")
async def get_district_summary_xlsx(
    district_id: UUID | None = None,
    period: str = "all",
    date_from: date | None = None,
    date_to: date | None = None,
    place: PlaceFilter = "all",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    summary = await _district_summary(db, user, district_id, period, date_from, date_to, place)
    content = await run_in_threadpool(district_summary_xlsx, summary)
    return _xlsx_response(
        content,
        district_xlsx_title(summary.district.name),
        "luki-sao-svod-rayona.xlsx",
        summary.period,
        place,
    )
