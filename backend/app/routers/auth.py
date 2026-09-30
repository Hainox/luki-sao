"""Вход через журнал обходов и данные текущего пользователя."""
import logging
from datetime import datetime, timezone
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import District, User
from app.schemas import LoginRequest, TokenResponse, UserOut
from app.services import jirajura
from app.services.access import can_create
from app.services.audit import log_action
from app.services.security import client_ip, create_access_token, get_current_user

log = logging.getLogger(__name__)
router = APIRouter()

MUST_CHANGE_PASSWORD_MESSAGE = (
    "Сначала смените пароль в журнале обходов (obhod-sao.ru), затем войдите снова"
)
KNOWN_ROLES = {"inspector", "reviewer", "admin"}


async def user_out(db: AsyncSession, user: User) -> UserOut:
    district_name = None
    if user.district_id is not None:
        district_name = (await db.execute(
            select(District.name).where(District.id == user.district_id)
        )).scalar_one_or_none()
    return UserOut(
        id=user.id,
        login=user.login,
        full_name=user.full_name,
        role=user.role,
        district_id=user.district_id,
        district_name=district_name,
        is_prefecture=user.is_prefecture,
        can_create_cards=can_create(user),
    )


async def _sync_districts(db: AsyncSession, client: httpx.AsyncClient, token: str) -> None:
    try:
        districts = await jirajura.list_districts(client, token)
    except (httpx.HTTPError, ValueError) as exc:
        # Вход не должен ломаться из-за списка районов — уже известные
        # районы остаются, обновятся при следующем входе.
        log.warning("Не удалось синхронизировать районы: %s", exc)
        return
    now = datetime.now(timezone.utc)
    for d in districts:
        try:
            district_id = UUID(str(d["id"]))
        except ValueError:
            continue
        stmt = insert(District).values(id=district_id, name=str(d["name"]).strip(), synced_at=now)
        stmt = stmt.on_conflict_do_update(
            index_elements=[District.id],
            set_={"name": stmt.excluded.name, "synced_at": stmt.excluded.synced_at},
        )
        await db.execute(stmt)


def _parse_uuid(value) -> UUID | None:
    if value in (None, ""):
        return None
    try:
        return UUID(str(value))
    except ValueError:
        return None


@router.post("/login", response_model=TokenResponse)
async def login(
    data: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    client: httpx.AsyncClient = Depends(jirajura.get_jirajura_client),
):
    ip = client_ip(request)
    try:
        result = await jirajura.login(client, data.login, data.password, ip)
    except jirajura.JiraJuraError as exc:
        log_action(db, None, "login_failed", "auth", None,
                   {"login": data.login.lower(), "status": exc.status_code}, ip)
        await db.commit()
        raise HTTPException(exc.status_code, exc.detail, headers=exc.headers or None)

    jj_user = result.user
    user_id = _parse_uuid(jj_user.get("id"))
    role = str(jj_user.get("role"))
    if user_id is None or role not in KNOWN_ROLES:
        raise HTTPException(502, jirajura.DEFAULT_UNAVAILABLE)

    if result.must_change_password:
        log_action(db, user_id, "login_must_change_password", "auth", user_id, {"login": data.login.lower()}, ip)
        await db.commit()
        raise HTTPException(403, MUST_CHANGE_PASSWORD_MESSAGE)

    await _sync_districts(db, client, result.access_token)

    now = datetime.now(timezone.utc)
    values = {
        "id": user_id,
        "login": str(jj_user.get("login") or data.login),
        "full_name": str(jj_user.get("full_name") or ""),
        "role": role,
        "district_id": _parse_uuid(jj_user.get("district_id")),
        "last_login_at": now,
    }
    stmt = insert(User).values(**values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[User.id],
        set_={k: stmt.excluded[k] for k in values if k != "id"},
    )
    await db.execute(stmt)
    log_action(db, user_id, "login_success", "auth", user_id, {"login": values["login"]}, ip)
    await db.commit()

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
    return TokenResponse(
        access_token=create_access_token(str(user.id), user.role),
        user=await user_out(db, user),
    )


@router.get("/me", response_model=UserOut)
async def me(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await user_out(db, user)
