"""Вход: собственный rate-limit, доверенный X-Real-IP, отзыв токена при выходе."""

import jwt

from app.config import settings
from tests.conftest import login_as, run_sql


async def _login(client, jj, login="inspector1"):
    return await login_as(client, jj, login)


async def test_own_rate_limit_returns_429_with_retry_after(client, jj):
    from app.services import security

    jj.add_user("inspector1")
    statuses = set()
    for _ in range(settings.LOGIN_RATE_LIMIT_PER_MINUTE + 3):
        r = await client.post(
            "/api/auth/login", json={"login": "inspector1", "password": "secret123"}
        )
        statuses.add(r.status_code)
    assert 429 in statuses
    limited = await client.post(
        "/api/auth/login", json={"login": "inspector1", "password": "secret123"}
    )
    assert limited.status_code == 429
    assert "Retry-After" in limited.headers
    assert int(limited.headers["Retry-After"]) >= 1
    assert security._login_attempts, "лимит не должен зависеть от апстрима"
    assert run_sql("SELECT count(*) FROM audit_log WHERE action = 'logout'")[0][0] == 0


async def test_rate_limit_counts_per_ip(client, jj):
    jj.add_user("inspector1")
    for _ in range(settings.LOGIN_RATE_LIMIT_PER_MINUTE):
        r = await client.post(
            "/api/auth/login",
            json={"login": "inspector1", "password": "secret123"},
            headers={"X-Real-IP": "203.0.113.9"},
        )
        assert r.status_code == 200, r.text
    # Другой IP тем же логином — всё ещё пускает.
    r = await client.post(
        "/api/auth/login",
        json={"login": "inspector1", "password": "secret123"},
        headers={"X-Real-IP": "203.0.113.10"},
    )
    assert r.status_code == 200, r.text


async def test_x_real_ip_from_untrusted_peer_is_ignored(client, jj):
    jj.add_user("inspector1")
    await login_as(client, jj, "inspector1")
    # В тестах peer — 127.0.0.1 (доверенный), заголовок доходит как раньше.
    assert jj.last_request("/api/v1/auth/login").headers["x-real-ip"] == "127.0.0.1"
    # А с недоверенного пира чужой заголовок не должен подменять IP.
    from app.services import security

    class Peer:
        host = "8.8.8.8"

    class Req:
        headers = {"x-real-ip": "203.0.113.7"}
        client = Peer()

    assert security.client_ip(Req()) == "8.8.8.8"
    assert security.is_trusted_proxy("127.0.0.1") is True
    assert security.is_trusted_proxy("172.18.0.5") is True
    assert security.is_trusted_proxy("8.8.8.8") is False
    assert security.is_trusted_proxy("not-an-ip") is False


async def test_logout_revokes_token(client, jj):
    headers = await _login(client, jj)
    assert (await client.get("/api/auth/me", headers=headers)).status_code == 200
    r = await client.post("/api/auth/logout", headers=headers)
    assert r.status_code == 204, r.text
    assert (await client.get("/api/auth/me", headers=headers)).status_code == 401
    assert run_sql("SELECT action FROM audit_log WHERE action = 'logout'") == [("logout",)]


async def test_logout_is_idempotent_and_needs_login(client, jj):
    assert (await client.post("/api/auth/logout")).status_code == 401
    headers = await _login(client, jj)
    assert (await client.post("/api/auth/logout", headers=headers)).status_code == 204
    assert (await client.post("/api/auth/logout", headers=headers)).status_code == 401


async def test_token_has_jti_and_iat(client, jj):
    headers = await _login(client, jj)
    raw = headers["Authorization"].removeprefix("Bearer ")
    payload = jwt.decode(raw, options={"verify_signature": False})
    assert payload["jti"], "без jti отзыв токена невозможен"
    assert payload["iat"] <= payload["exp"] <= payload["iat"] + 8 * 3600


async def test_revoked_jti_does_not_block_other_sessions(client, jj):
    first = await _login(client, jj)
    second_headers = await login_as(client, jj, "inspector1")
    assert first["Authorization"] != second_headers["Authorization"]
    await client.post("/api/auth/logout", headers=first)
    assert (await client.get("/api/auth/me", headers=first)).status_code == 401
    assert (await client.get("/api/auth/me", headers=second_headers)).status_code == 200


async def test_login_rate_limit_window_slides(monkeypatch):
    from app.services import security

    now = [1000.0]
    monkeypatch.setattr(security.time, "monotonic", lambda: now[0])
    for _ in range(settings.LOGIN_RATE_LIMIT_PER_MINUTE):
        assert security.check_login_rate_limit("1.2.3.4") is None
    retry_after = security.check_login_rate_limit("1.2.3.4")
    assert retry_after is not None and retry_after > 0
    now[0] += 61.0
    assert security.check_login_rate_limit("1.2.3.4") is None


async def test_expired_tokens_are_not_added_to_blocklist(client, jj):
    from app.services import security
    from tests.conftest import run_sql as _run_sql

    jti = "expired-token-jti"
    expired = jwt.encode(
        {"sub": "00000000-0000-0000-0000-000000000000", "jti": jti, "exp": 1},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )
    r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401
    assert _run_sql("SELECT count(*) FROM token_blocklist WHERE jti = %s", (jti,))[0][0] == 0
    assert security.is_trusted_proxy("127.0.0.1") is True
