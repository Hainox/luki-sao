"""Свод по люкам — открыт всем вошедшим (общая таблица округа)."""
from datetime import date
from urllib.parse import quote

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.database import get_db
from app.models import User
from app.schemas import SummaryOut
from app.services.periods import resolve_period
from app.services.security import get_current_user
from app.services.summary import build_summary, summary_xlsx

router = APIRouter()

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/summary", response_model=SummaryOut)
async def get_summary(
    period: str = "all",
    date_from: date | None = None,
    date_to: date | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await build_summary(db, resolve_period(period, date_from, date_to))


@router.get("/summary.xlsx")
async def get_summary_xlsx(
    period: str = "all",
    date_from: date | None = None,
    date_to: date | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    per = resolve_period(period, date_from, date_to)
    content = await run_in_threadpool(summary_xlsx, await build_summary(db, per))
    name = "Свод по люкам САО.xlsx" if per.kind == "all" else f"Свод по люкам САО {per.label}.xlsx"
    return Response(
        content=content,
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f"attachment; filename=\"luki-sao-svod.xlsx\"; filename*=UTF-8''{quote(name)}",
        },
    )
