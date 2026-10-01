"""Загрузка справочника ДТ/ОДХ (data/territories.json.gz) в базу.

Запускается при каждом старте контейнера API (docker-entrypoint.sh) сразу
после миграций и ничего не делает, если файл не менялся с прошлой загрузки.
Новая выгрузка реестра: пересобрать файл (tools/build_territories.py),
закоммитить и обновить приложение как обычно.

    python -m app.load_territories [путь к файлу]
"""
import asyncio
import gzip
import hashlib
import json
import sys
from pathlib import Path

from sqlalchemy import func, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Territory
from app.services.territories import district_key

DATASET_NAME = "territories"
DEFAULT_PATH = Path(__file__).resolve().parent.parent / "data" / "territories.json.gz"
# asyncpg принимает не больше 32767 параметров в запросе — у строки их 17.
BATCH_SIZE = 500


def _bbox(polygons: list) -> tuple[float, float, float, float]:
    lons = [p[0] for polygon in polygons for ring in polygon for p in ring]
    lats = [p[1] for polygon in polygons for ring in polygon for p in ring]
    return min(lats), min(lons), max(lats), max(lons)


def _row(item: dict) -> dict:
    min_lat, min_lon, max_lat, max_lon = _bbox(item["polygons"])
    return {
        "kind": item["kind"],
        "registry_id": item["registry_id"],
        "short_id": item.get("short_id") or None,
        "name": item["name"],
        "district_names": item["districts"],
        "district_keys": [district_key(d) for d in item["districts"]],
        "owner": item.get("owner"),
        "category": item.get("category"),
        "area_m2": item.get("area_m2"),
        "passport_url": item.get("passport_url"),
        "polygons": item["polygons"],
        "min_lat": min_lat,
        "min_lon": min_lon,
        "max_lat": max_lat,
        "max_lon": max_lon,
        "is_active": True,
    }


async def load_dataset(db: AsyncSession, raw: bytes, *, force: bool = False) -> str:
    sha = hashlib.sha256(raw).hexdigest()
    current = (await db.execute(
        text("SELECT sha256 FROM dataset_versions WHERE name = :name"), {"name": DATASET_NAME}
    )).scalar_one_or_none()
    if current == sha and not force:
        return "Справочник ДТ/ОДХ не менялся"

    dataset = json.loads(gzip.decompress(raw))
    rows = [_row(item) for item in dataset["items"]]
    # Объекта нет в новой выгрузке — он останется выключенным, а не
    # удалённым: на него могут ссылаться карточки. Всё в одной транзакции,
    # так что пустого справочника никто не увидит.
    await db.execute(update(Territory).where(Territory.is_active).values(is_active=False))
    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start:start + BATCH_SIZE]
        stmt = insert(Territory).values(batch)
        await db.execute(stmt.on_conflict_do_update(
            index_elements=[Territory.kind, Territory.registry_id],
            set_={
                col: getattr(stmt.excluded, col)
                for col in batch[0] if col not in ("kind", "registry_id")
            } | {"updated_at": func.now()},
        ))
    await db.execute(text("""
        INSERT INTO dataset_versions (name, sha256, source_date, items, loaded_at)
        VALUES (:name, :sha, :source_date, :items, now())
        ON CONFLICT (name) DO UPDATE
        SET sha256 = EXCLUDED.sha256, source_date = EXCLUDED.source_date,
            items = EXCLUDED.items, loaded_at = now()
    """), {"name": DATASET_NAME, "sha": sha, "source_date": dataset.get("source_date"), "items": len(rows)})
    await db.commit()
    kinds = {k: sum(1 for r in rows if r["kind"] == k) for k in ("dt", "odh")}
    return (
        f"Справочник ДТ/ОДХ загружен: выгрузка {dataset.get('source_date')}, "
        f"ДТ {kinds['dt']}, ОДХ {kinds['odh']}"
    )


async def _main(path: Path) -> None:
    from app.database import async_session, engine

    async with async_session() as db:
        print(await load_dataset(db, path.read_bytes()))
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(_main(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PATH))
