"""Люки САО — журнал самоконтроля: точка входа FastAPI."""
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import DEV_SECRET_KEY, settings
from app.routers import auth, cards, districts, summary


def _check_production_secret() -> None:
    if settings.APP_ENV != "production":
        return
    key = settings.SECRET_KEY
    if key == DEV_SECRET_KEY or len(key) < 32 or "change-me" in key:
        raise RuntimeError(
            "APP_ENV=production, но SECRET_KEY не задан или остался заготовкой. "
            "Сгенерируйте ключ (openssl rand -hex 32) и пропишите его в .env."
        )


_check_production_secret()

app = FastAPI(title="Люки САО — журнал самоконтроля", version="1.0.0", docs_url="/api/docs",
              openapi_url="/api/openapi.json")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    # Без nosniff браузер может «угадать» HTML в загруженном файле, даже
    # если он отдан как image/jpeg.
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    if request.url.path.startswith("/uploads/"):
        # Имена файлов — случайные UUID и никогда не перезаписываются.
        response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
    return response


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(districts.router, prefix="/api/districts", tags=["districts"])
app.include_router(cards.router, prefix="/api/cards", tags=["cards"])
app.include_router(summary.router, prefix="/api", tags=["summary"])

Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
