"""Клиент журнала обходов (JiraJura): вход по его логину/паролю и список районов.

Своих паролей у приложения нет — владелец продукта решил, что сотрудники
входят теми же учётными данными, что и в журнал обходов.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import settings

DEFAULT_UNAVAILABLE = "Журнал обходов сейчас недоступен — попробуйте войти через пару минут"


class JiraJuraError(Exception):
    def __init__(self, status_code: int, detail: str, headers: dict[str, str] | None = None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.headers = headers or {}


@dataclass
class JiraJuraLogin:
    access_token: str
    user: dict[str, Any]
    must_change_password: bool


async def get_jirajura_client() -> AsyncIterator[httpx.AsyncClient]:
    # trust_env=False: внутренний адрес http://api:8000 не должен уходить в
    # HTTP(S)_PROXY, который docker-клиент умеет подкладывать в окружение
    # контейнеров (~/.docker/config.json "proxies") — такой прокси не видит
    # docker-сеть jirajura_default, и вход сломался бы целиком.
    async with httpx.AsyncClient(
        base_url=settings.JIRAJURA_API_URL,
        timeout=settings.JIRAJURA_TIMEOUT_SECONDS,
        trust_env=False,
    ) as client:
        yield client


def _detail(response: httpx.Response, fallback: str) -> str:
    try:
        data = response.json()
    except ValueError:
        return fallback
    detail = data.get("detail") if isinstance(data, dict) else None
    return detail if isinstance(detail, str) and detail else fallback


async def login(
    client: httpx.AsyncClient, login: str, password: str, client_ip: str
) -> JiraJuraLogin:
    try:
        response = await client.post(
            "/api/v1/auth/login",
            json={"login": login, "password": password},
            # Журнал обходов ограничивает число попыток входа по X-Real-IP —
            # без этого заголовка все сотрудники выглядели бы для него одним
            # адресом (нашим контейнером) и блокировали бы друг друга.
            headers={"X-Real-IP": client_ip},
        )
    except httpx.HTTPError:
        raise JiraJuraError(503, DEFAULT_UNAVAILABLE)

    if response.status_code == 401:
        raise JiraJuraError(401, _detail(response, "Неверный логин или пароль"))
    if response.status_code == 429:
        headers = {}
        if response.headers.get("retry-after"):
            headers["Retry-After"] = response.headers["retry-after"]
        raise JiraJuraError(
            429,
            _detail(response, "Слишком много попыток входа — попробуйте позже"),
            headers,
        )
    if response.status_code == 422:
        raise JiraJuraError(401, "Неверный логин или пароль")
    if response.status_code != 200:
        raise JiraJuraError(502, DEFAULT_UNAVAILABLE)

    try:
        data = response.json()
        token = data["access_token"]
        user = data["user"]
        user["id"]
        user["role"]
    except (ValueError, KeyError, TypeError):
        raise JiraJuraError(502, DEFAULT_UNAVAILABLE)
    return JiraJuraLogin(
        access_token=token,
        user=user,
        must_change_password=bool(data.get("must_change_password")),
    )


async def list_districts(client: httpx.AsyncClient, token: str) -> list[dict[str, Any]]:
    """Список районов, видимых этому пользователю в журнале обходов.

    Журнал обходов сам ограничивает выдачу: сотрудник района получает только
    свой район, администратор — все. Поэтому полный список появляется у нас
    после первого входа администратора префектуры.
    """
    response = await client.get("/api/v1/districts/", headers={"Authorization": f"Bearer {token}"})
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, list):
        raise ValueError("districts: ожидался список")
    return [d for d in data if isinstance(d, dict) and d.get("id") and d.get("name")]
