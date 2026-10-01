"""Список районов (синхронизируется из журнала обходов при входе)."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.schemas import DistrictOut
from app.services.districts import okrug_districts
from app.services.security import get_current_user

router = APIRouter()


@router.get("", response_model=list[DistrictOut])
async def list_districts(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    return [DistrictOut(id=d.id, name=d.name) for d in await okrug_districts(db)]
