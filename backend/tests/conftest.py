"""Инфраструктура тестов: отдельная одноразовая БД (создаётся и мигрируется
один раз на сессию), клиент приложения через ASGITransport и поддельный
журнал обходов на httpx.MockTransport — в сеть тесты не ходят.

DATABASE_URL/UPLOAD_DIR выставляются до первого `import app...`: engine и
каталог загрузок создаются при импорте модулей.
"""
import gzip
import io
import json
import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/luki_sao_test",
)
os.environ["DATABASE_URL"] = TEST_DB_URL
os.environ["UPLOAD_DIR"] = tempfile.mkdtemp(prefix="luki-uploads-")
os.environ["APP_ENV"] = "test"
os.environ["JIRAJURA_API_URL"] = "http://jirajura.test"

import httpx  # noqa: E402
import psycopg2  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

SYNC_DB_URL = TEST_DB_URL.replace("postgresql+asyncpg://", "postgresql://")

# 16 районов САО + служебный «Неизвестный район», как в журнале обходов.
SAO_DISTRICTS = [
    "Аэропорт", "Беговой", "Бескудниковский", "Войковский", "Восточное Дегунино",
    "Головинский", "Дмитровский", "Западное Дегунино", "Коптево", "Левобережный",
    "Молжаниновский", "Савёловский", "Сокол", "Тимирязевский", "Ховрино", "Хорошёвский",
]
DISTRICT_IDS = {name: str(uuid.uuid5(uuid.NAMESPACE_URL, f"sao/{name}")) for name in SAO_DISTRICTS}
UNKNOWN_DISTRICT_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, "sao/unknown"))


def _square(lat: float, lon: float, size: float = 0.001) -> list:
    return [[[[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]]]


def district_corner(name: str) -> tuple[float, float]:
    """Юго-западный угол ДТ района в тестовом справочнике; ОДХ района — в
    0,002° восточнее, следующий район — в 0,01° севернее."""
    return 55.70 + SAO_DISTRICTS.index(name) * 0.01, 37.50


def territories_dataset() -> dict:
    """Тестовый справочник: по одному ДТ и ОДХ на район. Названия районов —
    как в реестре, без «ё», — проверяем то же сопоставление, что на проде."""
    items = []
    for name in SAO_DISTRICTS:
        lat, lon = district_corner(name)
        registry_name = name.replace("ё", "е")
        items.append({"kind": "dt", "registry_id": f"dt-{name}", "name": f"Двор района {name}",
                      "districts": [registry_name], "owner": f"Жилищник {name}", "category": "3 категория",
                      "area_m2": 1000, "passport_url": f"https://reestr-ogh.mos.ru/ogh/dt-{name}",
                      "polygons": _square(lat, lon)})
        items.append({"kind": "odh", "registry_id": f"odh-{name}", "name": f"Улица района {name}",
                      "districts": [registry_name], "owner": "АвД САО", "category": "4 категория",
                      "area_m2": 5000, "passport_url": f"https://reestr-ogh.mos.ru/ogh/odh-{name}",
                      "polygons": _square(lat, lon + 0.002)})
    return {"source": "test", "source_date": "2026-10-01", "items": items}


TERRITORY_IDS: dict[tuple[str, str], str] = {}


def _admin_sql(sql: str) -> None:
    url = make_url(TEST_DB_URL)
    conn = psycopg2.connect(
        host=url.host, port=url.port or 5432, user=url.username,
        password=url.password, dbname="postgres",
    )
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
    finally:
        conn.close()


def run_sql(sql: str, params: tuple | dict | None = None) -> list[tuple]:
    conn = psycopg2.connect(SYNC_DB_URL)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall() if cur.description else []
    finally:
        conn.close()


@pytest.fixture(scope="session", autouse=True)
def _prepare_test_database():
    dbname = make_url(TEST_DB_URL).database
    _admin_sql(f'DROP DATABASE IF EXISTS "{dbname}"')
    _admin_sql(f'CREATE DATABASE "{dbname}"')
    env = os.environ.copy()
    env["DATABASE_URL"] = TEST_DB_URL
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(BACKEND_DIR), env=env, check=True,
    )
    dataset_path = Path(tempfile.mkdtemp(prefix="luki-territories-")) / "territories.json.gz"
    dataset_path.write_bytes(gzip.compress(json.dumps(territories_dataset(), ensure_ascii=False).encode()))
    subprocess.run(
        [sys.executable, "-m", "app.load_territories", str(dataset_path)],
        cwd=str(BACKEND_DIR), env=env, check=True,
    )
    for tid, registry_id in run_sql("SELECT id, registry_id FROM territories"):
        kind, name = registry_id.split("-", 1)
        TERRITORY_IDS[(name, kind)] = str(tid)
    yield


@pytest.fixture(autouse=True)
def _clean_database():
    run_sql(
        "TRUNCATE audit_log, card_events, card_photos, cards, users, districts CASCADE;"
        "ALTER SEQUENCE card_number_seq RESTART WITH 1;"
    )
    yield


class FakeJiraJura:
    """Поддельный журнал обходов: /api/v1/auth/login и /api/v1/districts/
    с тем же ограничением выдачи районов по роли, что у настоящего."""

    def __init__(self) -> None:
        self.users: dict[str, dict] = {}
        self.tokens: dict[str, dict] = {}
        self.districts = [{"id": DISTRICT_IDS[n], "name": n} for n in SAO_DISTRICTS]
        self.districts.append({"id": UNKNOWN_DISTRICT_ID, "name": "Неизвестный район"})
        self.requests: list[httpx.Request] = []
        self.login_response: httpx.Response | None = None
        self.districts_fail = False
        self.down = False

    def add_user(self, login: str, role: str = "inspector", district: str | None = "Аэропорт",
                 password: str = "secret123", must_change: bool = False,
                 full_name: str | None = None) -> dict:
        user = {
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"user/{login}")),
            "login": login,
            "full_name": full_name or f"Сотрудник {login}",
            "role": role,
            "district_id": DISTRICT_IDS[district] if district else None,
            "phone": None,
            "is_developer": False,
        }
        self.users[login.lower()] = {"password": password, "user": user, "must_change": must_change}
        return user

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.down:
            raise httpx.ConnectError("connection refused", request=request)
        if request.method == "POST" and request.url.path == "/api/v1/auth/login":
            if self.login_response is not None:
                return self.login_response
            body = json.loads(request.content)
            entry = self.users.get(body["login"].lower())
            if entry is None or entry["password"] != body["password"]:
                return httpx.Response(401, json={"detail": "Неверный логин или пароль"})
            token = f"jj-{uuid.uuid4().hex}"
            self.tokens[token] = entry
            return httpx.Response(200, json={
                "access_token": token,
                "user": entry["user"],
                "must_change_password": entry["must_change"],
            })
        if request.method == "GET" and request.url.path == "/api/v1/districts/":
            if self.districts_fail:
                return httpx.Response(500, json={"detail": "Internal Server Error"})
            token = request.headers.get("authorization", "").removeprefix("Bearer ")
            entry = self.tokens.get(token)
            if entry is None:
                return httpx.Response(401, json={"detail": "Недействительный токен"})
            role = entry["user"]["role"]
            district_id = entry["user"]["district_id"]
            if role == "inspector":
                visible = [d for d in self.districts if d["id"] == district_id] if district_id else []
            elif role == "reviewer" and district_id:
                visible = [d for d in self.districts if d["id"] == district_id]
            else:
                visible = self.districts
            return httpx.Response(200, json=visible)
        return httpx.Response(404, json={"detail": "Not Found"})

    def last_request(self, path: str) -> httpx.Request:
        return [r for r in self.requests if r.url.path == path][-1]


@pytest.fixture
def jj() -> FakeJiraJura:
    return FakeJiraJura()


@pytest_asyncio.fixture
async def client(jj: FakeJiraJura):
    from app.main import app
    from app.services.jirajura import get_jirajura_client

    async def _fake_client():
        async with httpx.AsyncClient(
            base_url="http://jirajura.test", transport=httpx.MockTransport(jj.handler)
        ) as c:
            yield c

    app.dependency_overrides[get_jirajura_client] = _fake_client
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
    # Пул asyncpg привязан к event loop'у теста — у каждого теста свой loop.
    from app.database import engine
    await engine.dispose()


async def login_as(client: httpx.AsyncClient, jj: FakeJiraJura, login: str, role: str = "inspector",
                   district: str | None = "Аэропорт") -> dict[str, str]:
    if login.lower() not in jj.users:
        jj.add_user(login, role=role, district=district)
    r = await client.post("/api/auth/login", json={"login": login, "password": "secret123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def admin(client, jj) -> dict[str, str]:
    """Администратор префектуры; его вход синхронизирует все районы."""
    return await login_as(client, jj, "prefect", role="admin", district=None)


_JPEG_CACHE: dict[tuple, bytes] = {}


def image_bytes(fmt: str = "JPEG", size: tuple[int, int] = (64, 48), color=(200, 60, 40)) -> bytes:
    key = (fmt, size, color)
    if key not in _JPEG_CACHE:
        buf = io.BytesIO()
        mode = "RGBA" if fmt == "PNG" else "RGB"
        Image.new(mode, size, color).save(buf, fmt)
        _JPEG_CACHE[key] = buf.getvalue()
    return _JPEG_CACHE[key]


def place(district: str, kind: str = "dt") -> dict:
    """Поля места люка для POST /api/cards: объект справочника района."""
    return {"place_kind": kind, "territory_id": TERRITORY_IDS[(district, kind)]}


async def create_card(client, headers, district: str | None = None, address: str | None = "ул. Усиевича, д. 10",
                      kind: str = "dt", **extra) -> dict:
    """district — для префектуры (район карточки); у сотрудника района
    берётся его район. address — уточнение к объекту справочника."""
    if district is None:
        me = (await client.get("/api/auth/me", headers=headers)).json()
        district_name = next(n for n, i in DISTRICT_IDS.items() if i == me["district_id"])
    else:
        district_name = district
    payload = {**place(district_name, kind), "address_note": address, **extra}
    if district:
        payload["district_id"] = DISTRICT_IDS[district]
    r = await client.post("/api/cards", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def upload(client, headers, card_id: str, kind: str, filename: str = "photo.jpg",
                 content: bytes | None = None) -> httpx.Response:
    return await client.post(
        f"/api/cards/{card_id}/photos",
        params={"kind": kind},
        files={"file": (filename, content if content is not None else image_bytes(), "image/jpeg")},
        headers=headers,
    )


def set_created_at(card_id: str, iso: str) -> None:
    run_sql("UPDATE cards SET created_at = %s WHERE id = %s", (iso, card_id))
