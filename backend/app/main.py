"""Люки САО — журнал самоконтроля: точка входа FastAPI."""

import logging
import mimetypes
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import DEV_SECRET_KEY, settings
from app.database import dispose_engine, get_engine
from app.routers import auth, cards, districts, summary, territories

log = logging.getLogger("luki-sao")

IS_PRODUCTION = settings.APP_ENV == "production"


def _check_secret() -> None:
    # SECRET_KEY без значения по умолчанию: pydantic уже не даёт стартовать
    # без него. Здесь ловим только явную заготовку из .env.example.
    key = settings.SECRET_KEY
    if key == DEV_SECRET_KEY or "change-me" in key:
        raise RuntimeError(
            "SECRET_KEY остался заготовкой из .env.example. "
            "Сгенерируйте ключ (openssl rand -hex 32) и пропишите его в .env."
        )


_check_secret()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s"
    )
    # StaticFiles берёт Content-Type из mimetypes, а в образе python:3.12-slim
    # нет /etc/mime.types, и во встроенной таблице Python 3.12 нет .webp —
    # оригинал отдавался бы как application/octet-stream и скачивался бы
    # вместо показа.
    mimetypes.add_type("image/webp", ".webp")
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    get_engine()
    yield
    await dispose_engine()


app = FastAPI(
    title="Люки САО — журнал самоконтроля",
    version="1.0.0",
    # В проде документация закрыта: меньше поверхности и подсказок сканерам.
    docs_url=None if IS_PRODUCTION else "/api/docs",
    openapi_url=None if IS_PRODUCTION else "/api/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = uuid.uuid4().hex[:12]
    request.state.request_id = request_id
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception(
            "unhandled error request_id=%s %s %s",
            request_id,
            request.method,
            request.url.path,
        )
        return JSONResponse({"detail": "Внутренняя ошибка сервера"}, status_code=500)
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    log.info(
        "%s %s -> %s %.0fms request_id=%s",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
        request_id,
    )
    return response


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    # Без nosniff браузер может «угадать» HTML в загруженном файле, даже
    # если он отдан как image/jpeg.
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; "
        "script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; "
        "base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    )
    response.headers.setdefault(
        "Permissions-Policy", "camera=(), microphone=(), geolocation=(self)"
    )
    if request.url.path.startswith("/uploads/"):
        # Имена файлов — случайные UUID и никогда не перезаписываются.
        response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
    return response


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(districts.router, prefix="/api/districts", tags=["districts"])
app.include_router(cards.router, prefix="/api/cards", tags=["cards"])
app.include_router(territories.router, prefix="/api/territories", tags=["territories"])
app.include_router(summary.router, prefix="/api", tags=["summary"])

app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
