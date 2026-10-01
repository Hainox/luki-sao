"""Загрузка фото: белый список расширений, размер, превью, раздача."""

import io
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest
from PIL import Image

from app.config import settings
from tests.conftest import BACKEND_DIR, create_card, image_bytes, login_as, upload


def _uploaded_files() -> set[str]:
    root = Path(settings.UPLOAD_DIR)
    return {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()}


@pytest.fixture
async def author(client, jj):
    return await login_as(client, jj, "inspector1")


@pytest.mark.parametrize("filename", ["evil.html", "evil.svg", "evil.js", "script.php"])
async def test_disallowed_extensions_rejected(client, author, filename):
    card = await create_card(client, author)
    before = _uploaded_files()
    r = await upload(
        client,
        author,
        card["id"],
        "before",
        filename=filename,
        content=b"<script>alert(1)</script>",
    )
    assert r.status_code == 400
    assert "Недопустимый тип файла" in r.json()["detail"]
    assert _uploaded_files() == before


async def test_non_image_with_jpg_extension_rejected(client, author):
    card = await create_card(client, author)
    before = _uploaded_files()
    r = await upload(
        client,
        author,
        card["id"],
        "before",
        filename="fake.jpg",
        content=b"<html>hi</html>",
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Файл не распознан как фотография"
    assert _uploaded_files() == before


async def test_non_image_with_heic_extension_rejected(client, author):
    card = await create_card(client, author)
    before = _uploaded_files()
    r = await upload(
        client,
        author,
        card["id"],
        "before",
        filename="fake.heic",
        content=b"<html><script>alert(1)</script></html>",
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Файл не распознан как фотография"
    assert _uploaded_files() == before


async def test_undecodable_heif_container_is_kept_without_preview(client, author):
    # Настоящий контейнер HEIF, который libheif не разобрал, — всё равно
    # доказательство с камеры: сохраняем оригинал без превью.
    card = await create_card(client, author)
    content = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 200
    r = await upload(
        client, author, card["id"], "before", filename="IMG_0003.HEIC", content=content
    )
    assert r.status_code == 201, r.text
    photo = r.json()
    assert photo["url"] == photo["thumbnail_url"] == photo["original_url"]
    assert photo["original_url"].endswith(".heic")


async def test_size_limit(client, author, monkeypatch):
    monkeypatch.setattr(settings, "MAX_PHOTO_SIZE_MB", 1)
    card = await create_card(client, author)
    before = _uploaded_files()
    r = await upload(client, author, card["id"], "before", content=os.urandom(1024 * 1024 + 10))
    assert r.status_code == 413
    assert r.json()["detail"] == "Файл больше 1 МБ"
    assert _uploaded_files() == before


async def test_empty_file_rejected(client, author):
    card = await create_card(client, author)
    r = await upload(client, author, card["id"], "before", content=b"")
    assert r.status_code == 400


async def test_jpeg_gets_thumbnail_and_is_served_safely(client, author):
    card = await create_card(client, author)
    r = await upload(
        client,
        author,
        card["id"],
        "before",
        filename="IMG_0001.JPG",
        content=image_bytes(size=(1600, 1200)),
    )
    assert r.status_code == 201, r.text
    photo = r.json()
    assert photo["original_url"].startswith("/uploads/before/") and photo["original_url"].endswith(
        ".jpg"
    )
    assert photo["url"] == photo["original_url"]
    assert photo["thumbnail_url"].startswith("/uploads/thumbs/")
    assert photo["uploaded_by"]["login"] == "inspector1"

    thumb = await client.get(photo["thumbnail_url"])
    assert thumb.status_code == 200
    assert thumb.headers["x-content-type-options"] == "nosniff"
    assert thumb.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(thumb.content)) as img:
        assert max(img.size) == 480

    detail = (await client.get(f"/api/cards/{card['id']}", headers=author)).json()
    assert detail["before_photo"]["id"] == photo["id"]
    assert detail["before_count"] == 1


def test_large_rotated_photo_is_thumbnailed_without_full_size_copies(tmp_path, monkeypatch):
    # 24 Мп, портретная съёмка (поворот через EXIF) — обычное фото с телефона.
    # Полноразмерная копия такого кадра — 72 МБ, а у api mem_limit 512m.
    monkeypatch.setattr("app.services.photos.upload_root", lambda: tmp_path)
    src = tmp_path / "big.jpg"
    exif = Image.Exif()
    exif[0x0112] = 6
    Image.new("RGB", (6000, 4000), (90, 90, 90)).save(src, "JPEG", exif=exif)
    # resource.getrusage нет на Windows — гоняем подпроцесс только на POSIX.
    # На Windows проверяем результат (размер/поворот), память — в CI на Linux.
    code = textwrap.dedent(f"""
        from pathlib import Path
        from unittest.mock import patch
        from app.services import photos
        with patch.object(photos, "upload_root", return_value=Path({str(tmp_path)!r})):
            try:
                import resource
                start = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            except ImportError:
                start = None
            photos._make_derivatives(Path({str(src)!r}), "jpg", "big")
            if start is not None:
                import resource as _r
                delta_kb = (_r.getrusage(_r.RUSAGE_SELF).ru_maxrss - start) // 1024
                assert delta_kb < 40 * 1024, "превью съело слишком много памяти"
    """)
    subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND_DIR,
        env={**os.environ, "UPLOAD_DIR": str(tmp_path)},
        capture_output=True,
        text=True,
        check=True,
    )
    with Image.open(tmp_path / "thumbs" / "big.jpg") as thumb:
        assert thumb.size == (320, 480)


async def test_png_with_alpha_is_accepted(client, author):
    card = await create_card(client, author)
    r = await upload(
        client,
        author,
        card["id"],
        "before",
        filename="screen.png",
        content=image_bytes("PNG"),
    )
    assert r.status_code == 201, r.text


async def test_heic_gets_jpeg_preview(client, author):
    pillow_heif = pytest.importorskip("pillow_heif")
    buf = io.BytesIO()
    try:
        pillow_heif.from_pillow(Image.new("RGB", (320, 240), (10, 120, 200))).save(
            buf, format="HEIF"
        )
    except Exception as exc:  # в сборке без кодировщика x265 создать HEIC нечем
        pytest.skip(f"HEIC-кодировщик недоступен: {exc}")
    card = await create_card(client, author)
    r = await upload(
        client,
        author,
        card["id"],
        "before",
        filename="IMG_0002.HEIC",
        content=buf.getvalue(),
    )
    assert r.status_code == 201, r.text
    photo = r.json()
    assert photo["original_url"].endswith(".heic")
    assert photo["url"].startswith("/uploads/preview/") and photo["url"].endswith(".jpg")
    assert photo["thumbnail_url"].startswith("/uploads/thumbs/")


async def test_at_most_five_before_photos(client, author):
    card = await create_card(client, author)
    for _ in range(5):
        assert (await upload(client, author, card["id"], "before")).status_code == 201
    before = _uploaded_files()
    r = await upload(client, author, card["id"], "before")
    assert r.status_code == 409
    assert _uploaded_files() == before
    detail = (await client.get(f"/api/cards/{card['id']}", headers=author)).json()
    assert detail["permissions"]["can_add_before"] is False


async def test_at_most_five_after_photos_per_attempt(client, author, jj, admin):
    card = await create_card(client, author)
    for _ in range(5):
        assert (await upload(client, author, card["id"], "after")).status_code == 201
    assert (await upload(client, author, card["id"], "after")).status_code == 409
    await client.post(
        f"/api/cards/{card['id']}/return",
        json={"comment": "Не видно крышку"},
        headers=admin,
    )
    # Новая попытка — новый лимит.
    r = await upload(client, author, card["id"], "after")
    assert r.status_code == 201
    assert r.json()["attempt"] == 2
