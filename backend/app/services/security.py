"""Собственный JWT приложения и зависимости авторизации.

Токен журнала обходов после входа не хранится и не передаётся клиенту —
клиент получает только наш токен, подписанный SECRET_KEY этого приложения.
"""
from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import PyJWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User

_bearer = HTTPBearer(auto_error=False)


def create_access_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(401, "Требуется вход")
    try:
        payload = jwt.decode(credentials.credentials, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = UUID(str(payload.get("sub")))
    except (PyJWTError, ValueError):
        raise HTTPException(401, "Сессия истекла — войдите заново")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(401, "Сессия истекла — войдите заново")
    return user


async def require_prefecture(user: User = Depends(get_current_user)) -> User:
    if not user.is_prefecture:
        raise HTTPException(403, "Действие доступно только администратору префектуры")
    return user


def client_ip(request: Request) -> str:
    """X-Real-IP выставляет наш nginx (web-контейнер) — клиент его подделать
    не может: порт api наружу не опубликован."""
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"
