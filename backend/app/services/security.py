"""Собственный JWT приложения и зависимости авторизации.

Токен журнала обходов после входа не хранится и не передаётся клиенту —
клиент получает только наш токен, подписанный SECRET_KEY этого приложения.
"""

import ipaddress
import logging
import time
import uuid
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
from app.models import TokenBlocklist, User

log = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)

_TRUSTED_PROXY_NETWORKS: list[ipaddress._BaseNetwork] | None = None


def _proxy_networks() -> list[ipaddress._BaseNetwork]:
    global _TRUSTED_PROXY_NETWORKS
    if _TRUSTED_PROXY_NETWORKS is None:
        networks: list[ipaddress._BaseNetwork] = []
        for raw in settings.FORWARDED_ALLOW_IPS.split(","):
            raw = raw.strip()
            if not raw:
                continue
            try:
                networks.append(
                    ipaddress.ip_network(raw, strict=False)
                    if "/" in raw
                    else ipaddress.ip_network(f"{raw}/32" if ":" not in raw else f"{raw}/128")
                )
            except ValueError:
                log.warning("FORWARDED_ALLOW_IPS: пропускаю некорректное значение %r", raw)
        _TRUSTED_PROXY_NETWORKS = networks
    return _TRUSTED_PROXY_NETWORKS


def reset_proxy_networks_cache() -> None:
    global _TRUSTED_PROXY_NETWORKS
    _TRUSTED_PROXY_NETWORKS = None


def is_trusted_proxy(host: str | None) -> bool:
    if not host:
        return False
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(addr in net for net in _proxy_networks())


def create_access_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(401, "Требуется вход")
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        user_id = UUID(str(payload.get("sub")))
        jti = str(payload.get("jti") or "")
    except (PyJWTError, ValueError):
        raise HTTPException(401, "Сессия истекла — войдите заново")
    if (
        jti
        and (
            await db.execute(select(TokenBlocklist.id).where(TokenBlocklist.jti == jti))
        ).scalar_one_or_none()
        is not None
    ):
        raise HTTPException(401, "Сессия истекла — войдите заново")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(401, "Сессия истекла — войдите заново")
    return user


async def revoke_token(token: str, db: AsyncSession) -> bool:
    """Отзыв токена при выходе: запоминаем jti до конца его exp. Без jti
    (старые токены) отозвать нельзя — такой выход остаётся клиентским."""
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            options={"verify_exp": False},
        )
        jti = str(payload.get("jti") or "")
        exp = payload.get("exp")
    except (PyJWTError, ValueError):
        return False
    if not jti or not isinstance(exp, (int, float)):
        return False
    expires_at = datetime.fromtimestamp(exp, tz=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        return False
    db.add(TokenBlocklist(jti=jti, expires_at=expires_at))
    try:
        async with db.begin_nested():
            await db.flush()
    except Exception:
        await db.rollback()
        return True
    return True


async def require_prefecture(user: User = Depends(get_current_user)) -> User:
    if not user.is_prefecture:
        raise HTTPException(403, "Действие доступно только администратору префектуры")
    return user


def client_ip(request: Request) -> str:
    """X-Real-IP учитываем только от доверенного прокси (наш nginx): порт api
    наружу не опубликован, но в общей docker-сети есть и другие контейнеры."""
    peer = request.client.host if request.client and request.client.host else None
    if is_trusted_proxy(peer):
        real_ip = request.headers.get("x-real-ip")
        if real_ip and real_ip.strip():
            return real_ip.strip()
    if peer:
        return peer
    return "unknown"


# Простой лимит попыток входа в памяти процесса: окно — скользящая минута
# на IP. Для одного контейнера api достаточно; счётчик именно попыток входа,
# а не всех запросов.
_login_attempts: dict[str, list[float]] = {}


def check_login_rate_limit(ip: str) -> int | None:
    """None — попытка разрешена; иначе — секунды до конца окна (для Retry-After)."""
    now = time.monotonic()
    window = 60.0
    limit = settings.LOGIN_RATE_LIMIT_PER_MINUTE
    attempts = [t for t in _login_attempts.get(ip, []) if now - t < window]
    if len(attempts) >= limit:
        oldest = min(attempts)
        return max(1, int(oldest + window - now))
    attempts.append(now)
    _login_attempts[ip] = attempts
    return None


def reset_login_rate_limit() -> None:
    _login_attempts.clear()
