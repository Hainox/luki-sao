"""Справочник ДТ/ОДХ: объекты района и подсказка «рядом с вами».

PostGIS в базе нет — для пары тысяч объектов он не нужен: по рамкам
(min/max широта и долгота) база отбирает объекты вокруг точки, а точное
расстояние до контура считается здесь, в локальной плоской проекции (на
сотнях метров её ошибка — сантиметры).
"""
import math
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import District, Territory

NEARBY_RADIUS_M = 300
NEARBY_LIMIT = 8
_M_PER_DEG_LAT = 110_540
_M_PER_DEG_LON_EQUATOR = 111_320

PLACE_LABELS = {"dt": "ДТ", "odh": "ОДХ"}
PLACE_TITLES = {"dt": "дворовые территории (ДТ)", "odh": "объекты дорожного хозяйства (ОДХ)"}


def district_key(name: str) -> str:
    return name.strip().lower().replace("ё", "е")


def _ring_contains(ring: list[tuple[float, float]], x: float, y: float) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def distance_m(polygons: list, lat: float, lon: float) -> float:
    """Расстояние от точки до объекта в метрах; 0 — точка внутри контура
    (с учётом дыр: внутри, если точка попала в нечётное число колец)."""
    kx = _M_PER_DEG_LON_EQUATOR * math.cos(math.radians(lat))
    best = math.inf
    for polygon in polygons:
        rings = [[((p[0] - lon) * kx, (p[1] - lat) * _M_PER_DEG_LAT) for p in ring] for ring in polygon]
        if sum(_ring_contains(ring, 0.0, 0.0) for ring in rings) % 2 == 1:
            return 0.0
        for ring in rings:
            for (ax, ay), (bx, by) in zip(ring, ring[1:]):
                best = min(best, _segment_distance(0.0, 0.0, ax, ay, bx, by))
    return best


async def district_territories(db: AsyncSession, district: District) -> list[Territory]:
    return list((await db.execute(
        select(Territory)
        .where(Territory.is_active, Territory.district_keys.any(district_key(district.name)))
        .order_by(Territory.kind, Territory.name)
    )).scalars().all())


async def nearby_territories(
    db: AsyncSession, district: District, lat: float, lon: float, radius_m: float = NEARBY_RADIUS_M,
) -> list[tuple[Territory, float]]:
    dlat = radius_m / _M_PER_DEG_LAT
    dlon = radius_m / (_M_PER_DEG_LON_EQUATOR * math.cos(math.radians(lat)))
    candidates = (await db.execute(
        select(Territory).where(
            Territory.is_active,
            Territory.district_keys.any(district_key(district.name)),
            Territory.max_lat >= lat - dlat,
            Territory.min_lat <= lat + dlat,
            Territory.max_lon >= lon - dlon,
            Territory.min_lon <= lon + dlon,
        )
    )).scalars().all()
    found = [(t, distance_m(t.polygons, lat, lon)) for t in candidates]
    found = [(t, d) for t, d in found if d <= radius_m]
    found.sort(key=lambda item: (item[1], item[0].name))
    return found[:NEARBY_LIMIT]


async def territory_for_card(db: AsyncSession, territory_id: UUID, place_kind: str, district: District) -> Territory:
    territory = await db.get(Territory, territory_id)
    if territory is None or not territory.is_active:
        raise HTTPException(422, "Объект не найден в справочнике ДТ и ОДХ — выберите его заново")
    if territory.kind != place_kind:
        raise HTTPException(
            422, f"«{territory.name}» — это {PLACE_LABELS[territory.kind]}, а выбрано {PLACE_LABELS[place_kind]}",
        )
    if district_key(district.name) not in territory.district_keys:
        raise HTTPException(422, f"«{territory.name}» относится к другому району")
    return territory


def card_address(territory: Territory, note: str | None) -> str:
    return f"{territory.name} — {note}" if note else territory.name
