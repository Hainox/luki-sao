"""Собирает справочник ДТ и ОДХ (backend/data/territories.json.gz) из
выгрузки реестра АСУ ОДС (reestr-ogh.mos.ru) по САО.

Нужны два файла из архива выгрузки — контуры в WGS84:
    dt_sao_wgs84.geojson   — дворовые территории
    odh_sao_wgs84.geojson  — объекты дорожного хозяйства

    python tools/build_territories.py <каталог или .zip выгрузки> [--date 2026-10-01]

Контуры упрощаются (Дуглас — Пекер, допуск ~1,5 м) и округляются до 6
знаков: для подсказки «рядом с вами» хватает с запасом (GPS телефона
ошибается на 5–20 м), а справочник ужимается с ~22 МБ до пары мегабайт.
API загружает файл сам при старте (app/load_territories.py), если он
поменялся.
"""
import argparse
import gzip
import io
import json
import math
import re
import sys
import zipfile
from pathlib import Path

SOURCES = {"dt": "dt_sao_wgs84.geojson", "odh": "odh_sao_wgs84.geojson"}
OUT = Path(__file__).resolve().parent.parent / "data" / "territories.json.gz"
TOLERANCE_M = 1.5
OUTSIDE_DISTRICTS = "вне границ районов САО"


def _read_sources(src: Path) -> dict[str, dict]:
    if src.is_dir():
        return {kind: json.loads((src / name).read_text(encoding="utf-8")) for kind, name in SOURCES.items()}
    with zipfile.ZipFile(src) as zf:
        by_base = {Path(n).name: n for n in zf.namelist()}
        return {kind: json.loads(zf.read(by_base[name]).decode("utf-8")) for kind, name in SOURCES.items()}


def _simplify(points: list[list[float]], lat0: float) -> list[list[float]]:
    kx = 111_320 * math.cos(math.radians(lat0))
    ky = 110_540
    xy = [(p[0] * kx, p[1] * ky) for p in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = xy[a]
        bx, by = xy[b]
        dx, dy = bx - ax, by - ay
        seg = math.hypot(dx, dy)
        best, best_i = -1.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            d = (abs(dy * px - dx * py + bx * ay - by * ax) / seg) if seg else math.hypot(px - ax, py - ay)
            if d > best:
                best, best_i = d, i
        if best > TOLERANCE_M:
            keep[best_i] = True
            stack += [(a, best_i), (best_i, b)]
    out = [[round(p[0], 6), round(p[1], 6)] for p, k in zip(points, keep) if k]
    # Кольцо должно остаться многоугольником: иначе берём исходные точки.
    return out if len(out) >= 4 else [[round(p[0], 6), round(p[1], 6)] for p in points]


def _polygons(geometry: dict) -> list[list[list[list[float]]]]:
    if geometry["type"] == "Polygon":
        polys = [geometry["coordinates"]]
    elif geometry["type"] == "MultiPolygon":
        polys = geometry["coordinates"]
    else:
        raise ValueError(f"неожиданная геометрия {geometry['type']}")
    lat0 = polys[0][0][0][1]
    return [[_simplify(ring, lat0) for ring in poly] for poly in polys]


def _districts(props: dict, kind: str) -> list[str]:
    if kind == "dt":
        raw = props.get("Район") or ""
        names = raw.split(";")
    else:
        # «Аэропорт (52%); Савеловский (48%)» — объект на границе районов
        # видят оба района.
        raw = props.get("Все районы") or props.get("Район (по геометрии)") or ""
        names = [re.sub(r"\s*\(\d+%\)\s*$", "", part) for part in raw.split(";")]
    return [n.strip() for n in names if n.strip() and n.strip() != OUTSIDE_DISTRICTS]


def _name(props: dict, kind: str) -> str:
    name = (props.get("Наименование") or "").strip()
    # «ДТ\Острякова ул. 11, 9» — тип и так показан отдельной меткой.
    if kind == "dt" and name.startswith("ДТ\\"):
        name = name[3:].strip()
    return name


def build(src: Path, source_date: str) -> dict:
    data = _read_sources(src)
    items = []
    for kind, fc in data.items():
        for feature in fc["features"]:
            props = feature["properties"]
            if not feature.get("geometry"):
                continue
            items.append({
                "kind": kind,
                "registry_id": str(props["ID объекта"]),
                "short_id": str(props.get("ID (короткий)") or ""),
                "name": _name(props, kind),
                "districts": _districts(props, kind),
                "owner": props.get("Балансодержатель") if kind == "dt" else props.get("Заказчик"),
                "category": props.get("Категория объекта благоустройства") if kind == "dt" else props.get("Категория уборки"),
                "area_m2": props.get("Площадь, кв.м"),
                "passport_url": props.get("Ссылка на паспорт"),
                "polygons": _polygons(feature["geometry"]),
            })
    items.sort(key=lambda i: (i["kind"], i["registry_id"]))
    return {"source": "reestr-ogh.mos.ru, САО", "source_date": source_date, "items": items}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("src", type=Path)
    p.add_argument("--date", required=True, help="дата выгрузки, YYYY-MM-DD")
    args = p.parse_args()
    dataset = build(args.src, args.date)
    raw = json.dumps(dataset, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    buf = io.BytesIO()
    # mtime=0 — одинаковая выгрузка даёт побайтно одинаковый файл, и API не
    # перезагружает справочник без причины.
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        gz.write(raw)
    OUT.write_bytes(buf.getvalue())
    kinds = {k: sum(1 for i in dataset["items"] if i["kind"] == k) for k in SOURCES}
    print(f"{OUT}: ДТ {kinds['dt']}, ОДХ {kinds['odh']}, {len(raw) / 1e6:.1f} МБ → {OUT.stat().st_size / 1e6:.1f} МБ gzip", file=sys.stderr)


if __name__ == "__main__":
    main()
