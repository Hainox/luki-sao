"""Контракт backend ↔ frontend: дубли без единого источника дрейфуют.

Единый источник — backend (app/config.py, app/services/*.py). Тест держит
значения фронта (src/lib/*) синхронными с ним: расхождение = упавший тест,
а не молча разный лимит фото в поле и на сервере.
"""

import re
from pathlib import Path

from app.config import settings
from app.services.formatting import card_label, fixed_percent, percent_label
from app.services.periods import PERIOD_LABELS
from app.services.photos import ALLOWED_EXTENSIONS

BACKEND_DIR = Path(__file__).resolve().parents[1]
FRONTEND_SRC = BACKEND_DIR.parent / "frontend" / "src"


def _read(rel: str) -> str:
    return (FRONTEND_SRC / rel).read_text(encoding="utf-8")


def _const_value(source: str, name: str) -> str:
    m = re.search(rf"(?:export const {name}|const {name})\s*=\s*([^\n;]+)", source)
    assert m, f"{name} не найден во фронте"
    return m.group(1).strip()


def test_photo_limits_match_frontend():
    photo_upload = _read("lib/photoUpload.ts")
    assert _const_value(photo_upload, "MAX_PHOTOS") == str(settings.MAX_PHOTOS_PER_SET)
    assert _const_value(photo_upload, "MAX_PHOTO_SIZE_MB") == str(settings.MAX_PHOTO_SIZE_MB)
    exts = set(
        re.search(r"ALLOWED_EXTENSIONS = \[([^\]]+)\]", photo_upload)
        .group(1)
        .replace("'", "")
        .replace('"', "")
        .replace(" ", "")
        .split(",")
    )
    assert exts == ALLOWED_EXTENSIONS, f"фронт {sorted(exts)} != бэк {sorted(ALLOWED_EXTENSIONS)}"


def test_card_label_matches_frontend():
    assert "ОЛХ-" in _read("lib/format.ts")
    for number, expected in ((1, "ОЛХ-001"), (42, "ОЛХ-042"), (1000, "ОЛХ-1000")):
        assert card_label(number) == expected
        assert "padStart(3, '0')" in _read("lib/format.ts"), "формат номера должен совпадать"


def test_percent_math_matches_frontend():
    cases = [
        (2, 3, "66,7%"),
        (5, 16, "31,3%"),
        (7, 10, "70%"),
        (0, 0, "—"),
        (0, 4, "0%"),
    ]
    for fixed, detected, expected in cases:
        assert percent_label(fixed, detected) == expected
    value = fixed_percent(5, 16)
    assert value is not None and float(value) == 31.3, "половина вверх, как Math.round на фронте"


def test_period_labels_match_frontend():
    period_ts = _read("lib/period.ts")
    for kind, label in PERIOD_LABELS.items():
        if kind == "custom":
            continue
        assert label in period_ts, f"подпись периода {kind!r} ({label}) разъехалась с бэком"


def test_summary_formula_matches_frontend():
    from app.services.summary import FOOTNOTE

    footnote_front = _read("components/SummaryParts.tsx")
    assert FOOTNOTE in footnote_front, "сноска свода разъехалась между бэком и фронтом"


def test_roles_match_frontend():
    roles_ts = _read("lib/roles.ts")
    assert "is_prefecture" in roles_ts
    # Весь округ видит только префектура; без района нет ни журнала, ни
    # свода — см. access.sees_whole_okrug и hasNoJournal.
    assert "hasNoJournal" in roles_ts
    assert "!user.is_prefecture && !user.district_id" in roles_ts
    from app.models import User

    assert hasattr(User, "is_prefecture")


def test_photo_problem_rejects_all_disallowed_backend_extensions():
    disallowed = {"html", "svg", "js", "php"}
    assert not (disallowed & ALLOWED_EXTENSIONS)
