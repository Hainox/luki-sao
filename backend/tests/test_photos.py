"""Загрузка фото: белый список расширений, размер, превью, раздача."""
import io
import os
from pathlib import Path

import pytest
from PIL import Image

from app.config import settings
from tests.conftest import create_card, image_bytes, login_as, upload


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
    r = await upload(client, author, card["id"], "before", filename=filename, content=b"<script>alert(1)</script>")
    assert r.status_code == 400
    assert "Недопустимый тип файла" in r.json()["detail"]
    assert _uploaded_files() == before


async def test_non_image_with_jpg_extension_rejected(client, author):
    card = await create_card(client, author)
    before = _uploaded_files()
    r = await upload(client, author, card["id"], "before", filename="fake.jpg", content=b"<html>hi</html>")
    assert r.status_code == 400
    assert r.json()["detail"] == "Файл не распознан как фотография"
    assert _uploaded_files() == before


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
    r = await upload(client, author, card["id"], "before", filename="IMG_0001.JPG",
                     content=image_bytes(size=(1600, 1200)))
    assert r.status_code == 201, r.text
    photo = r.json()
    assert photo["original_url"].startswith("/uploads/before/") and photo["original_url"].endswith(".jpg")
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


async def test_png_with_alpha_is_accepted(client, author):
    card = await create_card(client, author)
    r = await upload(client, author, card["id"], "before", filename="screen.png", content=image_bytes("PNG"))
    assert r.status_code == 201, r.text


async def test_heic_gets_jpeg_preview(client, author):
    pillow_heif = pytest.importorskip("pillow_heif")
    buf = io.BytesIO()
    try:
        pillow_heif.from_pillow(Image.new("RGB", (320, 240), (10, 120, 200))).save(buf, format="HEIF")
    except Exception as exc:  # в сборке без кодировщика x265 создать HEIC нечем
        pytest.skip(f"HEIC-кодировщик недоступен: {exc}")
    card = await create_card(client, author)
    r = await upload(client, author, card["id"], "before", filename="IMG_0002.HEIC", content=buf.getvalue())
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
    await client.post(f"/api/cards/{card['id']}/return", json={"comment": "Не видно крышку"}, headers=admin)
    # Новая попытка — новый лимит.
    r = await upload(client, author, card["id"], "after")
    assert r.status_code == 201
    assert r.json()["attempt"] == 2
