"""Приём и хранение фотографий: проверка типа и размера, превью JPEG."""
import logging
import os
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from app.config import settings

log = logging.getLogger(__name__)

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
    HEIF_SUPPORTED = True
except ImportError:  # pragma: no cover — зависит от сборки окружения
    HEIF_SUPPORTED = False

# Белый список расширений — защита от stored XSS: /uploads/ раздаётся как
# статика, и Content-Type берётся по расширению. Без списка можно было бы
# загрузить .html/.svg и получить исполнение скрипта в origin приложения у
# того, кто откроет ссылку (тот же приём, что в JiraJura issues.py).
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "heic", "heif", "webp"}
HEIF_EXTENSIONS = {"heic", "heif"}

THUMBNAIL_SIZE = (480, 480)
PREVIEW_SIZE = (2048, 2048)

# HEIC libheif декодирует только целиком: 48-Мп кадр даже без лишних копий
# занимает ~350 МБ, и две параллельные загрузки упёрлись бы в mem_limit api.
_DECODE_SLOT = threading.BoundedSemaphore(1)


@dataclass
class StoredPhoto:
    storage_path: str
    thumbnail_path: str | None
    preview_path: str | None

    def all_paths(self) -> list[str]:
        return [p for p in (self.storage_path, self.thumbnail_path, self.preview_path) if p]


def upload_root() -> Path:
    return Path(settings.UPLOAD_DIR)


def _extension(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower().strip()


def _make_derivatives(abs_original: Path, ext: str, stem: str) -> tuple[str | None, str | None]:
    """Превью 480px для списков и, для HEIC, JPEG до 2048px — HEIC не
    показывает ни один браузер, кроме Safari. Возвращает относительные пути."""
    root = upload_root()
    heif = ext in HEIF_EXTENSIONS
    with _DECODE_SLOT, Image.open(abs_original) as img:
        # Сначала уменьшаем, потом поворачиваем по EXIF: thumbnail() декодирует
        # JPEG сразу в уменьшенном масштабе, а exif_transpose/copy() делают
        # полноразмерные копии — 48-Мп HEIC или 50-Мп JPEG с телефона занимали
        # так ~650 МБ при mem_limit 512m у api. Рамки квадратные, поэтому
        # поворот после уменьшения даёт тот же результат.
        img.thumbnail(PREVIEW_SIZE if heif else THUMBNAIL_SIZE)
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        preview_rel = None
        if heif:
            preview_rel = f"preview/{stem}.jpg"
            (root / "preview").mkdir(parents=True, exist_ok=True)
            img.save(root / preview_rel, "JPEG", quality=85)
            img.thumbnail(THUMBNAIL_SIZE)

        thumb_rel = f"thumbs/{stem}.jpg"
        (root / "thumbs").mkdir(parents=True, exist_ok=True)
        img.save(root / thumb_rel, "JPEG", quality=80)
    return thumb_rel, preview_rel


async def save_photo(file: UploadFile, subdir: str) -> StoredPhoto:
    ext = _extension(file.filename)
    if not ext:
        ext = "jpg"
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Недопустимый тип файла: .{ext} — подойдут только фотографии")

    stem = uuid.uuid4().hex
    rel_path = f"{subdir}/{stem}.{ext}"
    abs_path = upload_root() / rel_path
    abs_path.parent.mkdir(parents=True, exist_ok=True)

    max_bytes = settings.max_photo_bytes
    size = 0
    try:
        with open(abs_path, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(413, f"Файл больше {settings.MAX_PHOTO_SIZE_MB} МБ")
                out.write(chunk)
        if size == 0:
            raise HTTPException(400, "Файл пустой")
    except BaseException:
        abs_path.unlink(missing_ok=True)
        raise

    try:
        thumb_rel, preview_rel = await run_in_threadpool(_make_derivatives, abs_path, ext, stem)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        if ext in HEIF_EXTENSIONS:
            # Редкие варианты HEIC с камер телефонов libheif может не
            # разобрать — фото всё равно нужно сохранить как доказательство,
            # просто без превью (отдаём оригинал как есть).
            log.warning("HEIC без превью (%s): %s", rel_path, exc)
            return StoredPhoto(rel_path, None, None)
        abs_path.unlink(missing_ok=True)
        raise HTTPException(400, "Файл не распознан как фотография")

    return StoredPhoto(rel_path, thumb_rel, preview_rel)


def delete_stored(stored: StoredPhoto) -> None:
    for rel in stored.all_paths():
        try:
            os.remove(upload_root() / rel)
        except OSError:
            pass


def public_url(rel_path: str | None) -> str | None:
    return f"/uploads/{rel_path}" if rel_path else None
