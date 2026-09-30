"""Районы округа (снимок из журнала обходов)."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UNKNOWN_DISTRICT_NAME, District


async def okrug_districts(db: AsyncSession) -> list[District]:
    rows = await db.execute(
        select(District).where(District.name != UNKNOWN_DISTRICT_NAME).order_by(District.name)
    )
    return list(rows.scalars().all())
