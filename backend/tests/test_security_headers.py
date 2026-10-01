"""Security headers, CORS, request-id, districts и health без входа."""

from app.config import settings
from tests.conftest import create_card, login_as, run_sql, upload


async def test_security_headers_on_api_and_uploads(client, jj, admin):
    headers = await login_as(client, jj, "inspector1")
    card = await create_card(client, headers)
    photo = await upload(client, headers, card["id"], "before")
    assert photo.status_code == 201

    # Свод по округу — только префектуре (решение владельца продукта):
    # сотрудник района смотрит подробный свод своего района.
    for path, who in (
        ("/api/cards", headers),
        ("/api/summary", admin),
        (photo.json()["thumbnail_url"], headers),
    ):
        r = await client.get(path, headers=who)
        assert r.status_code == 200, path
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "DENY"
        assert r.headers["referrer-policy"] == "no-referrer"
        assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
        assert "object-src 'none'" in r.headers["content-security-policy"]
        assert "X-Request-ID" in r.headers


async def test_uploads_cache_is_immutable(client, jj):
    headers = await login_as(client, jj, "inspector1")
    card = await create_card(client, headers)
    photo = (await upload(client, headers, card["id"], "before")).json()
    r = await client.get(photo["thumbnail_url"])
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"


async def test_cors_allows_only_configured_origins(client):
    r = await client.options(
        "/api/cards",
        headers={"Origin": "https://evil.test", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in {k.lower(): v for k, v in r.headers.items()}
    assert "https://evil.test" not in settings.cors_origins_list
    assert settings.cors_origins_list, "CORS_ORIGINS не должен быть пустым"


async def test_cors_preflight_allows_only_safe_methods(client):
    r = await client.options(
        "/api/cards",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "DELETE",
        },
    )
    allow = r.headers.get("access-control-allow-methods", "")
    assert "DELETE" not in allow
    assert "GET" in allow and "POST" in allow


async def test_unhandled_errors_are_500_without_traceback(client, jj, monkeypatch):
    from app.routers import cards as cards_router

    headers = await login_as(client, jj, "inspector1")
    card = await create_card(client, headers)

    async def boom(*args, **kwargs):
        raise RuntimeError("вали всё")

    monkeypatch.setattr(cards_router, "_load_full", boom)
    r = await client.get(f"/api/cards/{card['id']}", headers=headers)
    assert r.status_code == 500
    assert r.json() == {"detail": "Внутренняя ошибка сервера"}
    assert "вали всё" not in r.text


async def test_docs_are_disabled_in_production():
    import app.main as main

    assert main.IS_PRODUCTION is (settings.APP_ENV == "production")
    assert (main.app.docs_url is None) == main.IS_PRODUCTION
    assert (main.app.openapi_url is None) == main.IS_PRODUCTION


async def test_districts_list_and_audit_log(client, jj, admin):
    r = await client.get("/api/districts", headers=admin)
    assert r.status_code == 200
    names = [d["name"] for d in r.json()]
    assert names == sorted(names) and len(names) == 16

    headers = await login_as(client, jj, "inspector1")
    card = await create_card(client, headers)
    assert (await upload(client, headers, card["id"], "before")).status_code == 201
    actions = {a for (a,) in run_sql("SELECT DISTINCT action FROM audit_log")}
    assert {"login_success", "card_create", "photo_upload"} <= actions
