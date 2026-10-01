"""Справочник ДТ и ОДХ для выбора места люка при фиксации нарушения."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import UNKNOWN_DISTRICT_NAME, District, Territory, User
from app.schemas import NearbyTerritoryOut, TerritoryOut
from app.services import access
from app.services.security import get_current_user
from app.services.territories import district_territories, nearby_territories

router = APIRouter()


def _out(t: Territory) -> dict:
    return {
        "id": t.id,
        "kind": t.kind,
        "name": t.name,
        "owner": t.owner,
        "category": t.category,
        "passport_url": t.passport_url,
    }


async def _work_district(db: AsyncSession, user: User, district_id: UUID | None) -> District:
    target = access.resolve_work_district(user, district_id)
    district = await db.get(District, target)
    if district is None or district.name == UNKNOWN_DISTRICT_NAME:
        raise HTTPException(404, "Район не найден — войдите заново, чтобы обновить список районов")
    return district


@router.get("", response_model=list[TerritoryOut])
async def list_territories(
    district_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Все ДТ и ОДХ района — их пара сотен, фильтрует и ищет фронтенд."""
    district = await _work_district(db, user, district_id)
    return [TerritoryOut(**_out(t)) for t in await district_territories(db, district)]


@router.get("/nearby", response_model=list[NearbyTerritoryOut])
async def list_nearby(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    district_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    district = await _work_district(db, user, district_id)
    return [
        NearbyTerritoryOut(**_out(t), distance_m=round(d))
        for t, d in await nearby_territories(db, district, lat, lon)
    ]
