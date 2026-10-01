"""Вход через журнал обходов (подделан MockTransport'ом)."""

import httpx

from tests.conftest import (
    DISTRICT_IDS,
    SAO_DISTRICTS,
    UNKNOWN_DISTRICT_ID,
    login_as,
    run_sql,
)


async def test_admin_login_issues_own_token_and_syncs_districts(client, jj):
    jj.add_user("prefect", role="admin", district=None, full_name="Иванова Анна Петровна")
    r = await client.post(
        "/api/auth/login",
        json={"login": "  prefect ", "password": "secret123"},
        headers={"X-Real-IP": "203.0.113.7"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["is_prefecture"] is True
    assert body["user"]["can_create_cards"] is True
    assert body["user"]["full_name"] == "Иванова Анна Петровна"
    # Токен журнала обходов клиенту не отдаём — только свой.
    assert "jj-" not in r.text
    assert set(body) == {"access_token", "user"}

    login_req = jj.last_request("/api/v1/auth/login")
    assert login_req.headers["x-real-ip"] == "203.0.113.7"
    assert login_req.read() == b'{"login":"prefect","password":"secret123"}'
    districts_req = jj.last_request("/api/v1/districts/")
    assert districts_req.headers["authorization"].startswith("Bearer jj-")

    stored = run_sql("SELECT count(*) FROM districts")[0][0]
    assert stored == 17  # вместе с «Неизвестным районом»

    headers = {"Authorization": f"Bearer {body['access_token']}"}
    r = await client.get("/api/districts", headers=headers)
    names = [d["name"] for d in r.json()]
    assert names == sorted(SAO_DISTRICTS)
    assert "Неизвестный район" not in names

    me = (await client.get("/api/auth/me", headers=headers)).json()
    assert me["login"] == "prefect"
    assert me["role"] == "admin"

    audit = run_sql("SELECT action, ip FROM audit_log")
    assert ("login_success", "203.0.113.7") in audit


async def test_bad_password_relays_jirajura_message(client, jj):
    jj.add_user("inspector1")
    r = await client.post("/api/auth/login", json={"login": "inspector1", "password": "wrong"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Неверный логин или пароль"
    assert run_sql("SELECT count(*) FROM users")[0][0] == 0
    assert run_sql("SELECT action FROM audit_log") == [("login_failed",)]


async def test_rate_limit_relays_status_message_and_retry_after(client, jj):
    jj.add_user("inspector1")
    jj.login_response = httpx.Response(
        429,
        json={"detail": "Слишком много попыток входа — попробуйте позже"},
        headers={"Retry-After": "900"},
    )
    r = await client.post("/api/auth/login", json={"login": "inspector1", "password": "secret123"})
    assert r.status_code == 429
    assert r.json()["detail"] == "Слишком много попыток входа — попробуйте позже"
    assert r.headers["retry-after"] == "900"


async def test_must_change_password_blocks_login(client, jj):
    jj.add_user("newbie", must_change=True)
    r = await client.post("/api/auth/login", json={"login": "newbie", "password": "secret123"})
    assert r.status_code == 403
    assert r.json()["detail"] == (
        "Сначала смените пароль в журнале обходов (obhod-sao.ru), затем войдите снова"
    )
    assert run_sql("SELECT count(*) FROM users")[0][0] == 0


async def test_jirajura_unavailable(client, jj):
    jj.add_user("inspector1")
    jj.down = True
    r = await client.post("/api/auth/login", json={"login": "inspector1", "password": "secret123"})
    assert r.status_code == 503
    assert "недоступен" in r.json()["detail"]


async def test_unexpected_jirajura_error_is_502(client, jj):
    jj.login_response = httpx.Response(500, text="boom")
    r = await client.post("/api/auth/login", json={"login": "inspector1", "password": "secret123"})
    assert r.status_code == 502


async def test_short_login_rejected_before_calling_jirajura(client, jj):
    r = await client.post("/api/auth/login", json={"login": "ab", "password": "x"})
    assert r.status_code == 422
    assert jj.requests == []


async def test_inspector_sees_own_district_and_snapshot_updates_on_relogin(client, jj):
    user = jj.add_user("inspector1", district="Аэропорт", full_name="Петров П. П.")
    headers = await login_as(client, jj, "inspector1")
    me = (await client.get("/api/auth/me", headers=headers)).json()
    assert me["district_id"] == DISTRICT_IDS["Аэропорт"]
    assert me["district_name"] == "Аэропорт"
    assert me["is_prefecture"] is False
    assert me["can_create_cards"] is True
    # Журнал обходов отдаёт инспектору только его район — синхронизируется он один.
    assert run_sql("SELECT name FROM districts") == [("Аэропорт",)]

    # Переименование района и перевод сотрудника подхватываются при следующем входе.
    jj.districts[0]["name"] = "Аэропорт (переименован)"
    user["full_name"] = "Петров Пётр Петрович"
    user["district_id"] = DISTRICT_IDS["Беговой"]
    headers = await login_as(client, jj, "inspector1")
    me = (await client.get("/api/auth/me", headers=headers)).json()
    assert me["full_name"] == "Петров Пётр Петрович"
    assert me["district_name"] == "Беговой"
    names = {r[0] for r in run_sql("SELECT name FROM districts")}
    assert names == {"Аэропорт", "Беговой"}
    assert run_sql("SELECT count(*) FROM users")[0][0] == 1


async def test_district_sync_failure_does_not_block_login(client, jj):
    jj.add_user("inspector1")
    jj.districts_fail = True
    r = await client.post("/api/auth/login", json={"login": "inspector1", "password": "secret123"})
    assert r.status_code == 200
    assert r.json()["user"]["district_name"] is None


async def test_reviewer_without_district_cannot_create(client, jj):
    headers = await login_as(client, jj, "okrug_reviewer", role="reviewer", district=None)
    me = (await client.get("/api/auth/me", headers=headers)).json()
    assert me["is_prefecture"] is False
    assert me["can_create_cards"] is False
    # Проверяющий округа видит в журнале обходов все районы — они и синхронизируются.
    assert (
        run_sql("SELECT count(*) FROM districts WHERE id = %s", (UNKNOWN_DISTRICT_ID,))[0][0] == 1
    )


async def test_client_ip_falls_back_to_peer_address(client, jj):
    await login_as(client, jj, "inspector1")
    assert jj.last_request("/api/v1/auth/login").headers["x-real-ip"] == "127.0.0.1"


async def test_protected_endpoints_require_valid_token(client):
    assert (await client.get("/api/auth/me")).status_code == 401
    r = await client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401
    assert (await client.get("/api/districts")).status_code == 401


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
