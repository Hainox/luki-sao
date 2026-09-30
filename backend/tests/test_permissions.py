"""Права: сотрудник района — только свой район, решения — только префектура."""
from tests.conftest import DISTRICT_IDS, create_card, login_as, upload


async def test_district_staff_journal_is_scoped_to_own_district(client, jj, admin):
    aero = await login_as(client, jj, "inspector1", district="Аэропорт")
    sokol = await login_as(client, jj, "inspector2", district="Сокол")
    aero_card = await create_card(client, aero)
    sokol_card = await create_card(client, sokol)

    listed = (await client.get("/api/cards", headers=aero)).json()
    assert [c["id"] for c in listed["items"]] == [aero_card["id"]]
    assert listed["counts"]["all"] == 1

    r = await client.get("/api/cards", params={"district_id": DISTRICT_IDS["Сокол"]}, headers=aero)
    assert r.status_code == 403
    r = await client.get(f"/api/cards/{sokol_card['id']}", headers=aero)
    assert r.status_code == 403

    # Префектура видит всё и может фильтровать по району.
    everything = (await client.get("/api/cards", headers=admin)).json()
    assert everything["counts"]["all"] == 2
    only_sokol = (await client.get("/api/cards", params={"district_id": DISTRICT_IDS["Сокол"]},
                                   headers=admin)).json()
    assert [c["id"] for c in only_sokol["items"]] == [sokol_card["id"]]


async def test_card_is_created_only_in_own_district(client, jj, admin):
    aero = await login_as(client, jj, "inspector1", district="Аэропорт")
    r = await client.post("/api/cards", json={"address": "ул. Зорге, 1", "district_id": DISTRICT_IDS["Сокол"]},
                          headers=aero)
    assert r.status_code == 403
    card = await create_card(client, aero)
    assert card["district_id"] == DISTRICT_IDS["Аэропорт"]
    card = await create_card(client, aero, district="Аэропорт")
    assert card["district_id"] == DISTRICT_IDS["Аэропорт"]


async def test_after_photo_only_by_card_district_or_prefecture(client, jj, admin):
    aero = await login_as(client, jj, "inspector1", district="Аэропорт")
    aero_reviewer = await login_as(client, jj, "aero_reviewer", role="reviewer", district="Аэропорт")
    sokol = await login_as(client, jj, "inspector2", district="Сокол")
    card = await create_card(client, aero)

    r = await upload(client, sokol, card["id"], "after")
    assert r.status_code == 403
    # Проверяющий района — тоже сотрудник района: может приложить фото ПОСЛЕ.
    r = await upload(client, aero_reviewer, card["id"], "after")
    assert r.status_code == 201
    # Префектура может добавить фото ПОСЛЕ в любом районе.
    r = await upload(client, admin, card["id"], "after")
    assert r.status_code == 201


async def test_before_photo_only_by_creator(client, jj):
    author = await login_as(client, jj, "inspector1", district="Аэропорт")
    colleague = await login_as(client, jj, "inspector2", district="Аэропорт")
    card = await create_card(client, author)
    assert (await upload(client, colleague, card["id"], "before")).status_code == 403
    assert (await upload(client, author, card["id"], "before")).status_code == 201
    detail = (await client.get(f"/api/cards/{card['id']}", headers=colleague)).json()
    assert detail["permissions"]["can_add_before"] is False
    assert detail["permissions"]["can_add_after"] is True


async def test_only_prefecture_accepts_and_returns(client, jj, admin):
    aero = await login_as(client, jj, "inspector1", district="Аэропорт")
    reviewer = await login_as(client, jj, "aero_reviewer", role="reviewer", district="Аэропорт")
    card = await create_card(client, aero)
    await upload(client, aero, card["id"], "after")

    for headers in (aero, reviewer):
        assert (await client.post(f"/api/cards/{card['id']}/accept", headers=headers)).status_code == 403
        r = await client.post(f"/api/cards/{card['id']}/return", json={"comment": "нет"}, headers=headers)
        assert r.status_code == 403
        assert (await client.get("/api/cards/review-queue", headers=headers)).status_code == 403
        detail = (await client.get(f"/api/cards/{card['id']}", headers=headers)).json()
        assert detail["permissions"]["can_review"] is False

    detail = (await client.get(f"/api/cards/{card['id']}", headers=admin)).json()
    assert detail["permissions"]["can_review"] is True
    assert (await client.post(f"/api/cards/{card['id']}/accept", headers=admin)).status_code == 200


async def test_reviewer_without_district_reads_okrug_but_cannot_act(client, jj, admin):
    aero = await login_as(client, jj, "inspector1", district="Аэропорт")
    sokol = await login_as(client, jj, "inspector2", district="Сокол")
    okrug = await login_as(client, jj, "okrug_reviewer", role="reviewer", district=None)
    card = await create_card(client, aero)
    await create_card(client, sokol)

    listed = (await client.get("/api/cards", headers=okrug)).json()
    assert listed["counts"]["all"] == 2
    r = await client.get("/api/cards", params={"district_id": DISTRICT_IDS["Сокол"]}, headers=okrug)
    assert r.status_code == 200 and r.json()["counts"]["all"] == 1

    r = await client.post("/api/cards", json={"address": "ул. Зорге, 1"}, headers=okrug)
    assert r.status_code == 403
    assert "не назначен район" in r.json()["detail"]
    assert (await upload(client, okrug, card["id"], "after")).status_code == 403
    detail = (await client.get(f"/api/cards/{card['id']}", headers=okrug)).json()
    assert detail["permissions"] == {"can_add_before": False, "can_add_after": False, "can_review": False}


async def test_inspector_without_district_sees_no_journal(client, jj, admin):
    # Журнал обходов отдаёт инспектору без района пустой список районов —
    # это незавершённая настройка аккаунта, а не «проверяющий округа».
    aero = await login_as(client, jj, "inspector1", district="Аэропорт")
    card = await create_card(client, aero)
    orphan = await login_as(client, jj, "orphan", role="inspector", district=None)

    r = await client.get("/api/cards", headers=orphan)
    assert r.status_code == 403
    assert "не назначен район" in r.json()["detail"]
    r = await client.get("/api/cards", params={"district_id": DISTRICT_IDS["Аэропорт"]}, headers=orphan)
    assert r.status_code == 403
    assert (await client.get(f"/api/cards/{card['id']}", headers=orphan)).status_code == 403
    assert (await upload(client, orphan, card["id"], "after")).status_code == 403
    r = await client.post("/api/cards", json={"address": "ул. Зорге, 1"}, headers=orphan)
    assert r.status_code == 403
    # Свод по люкам открыт всем вошедшим.
    assert (await client.get("/api/summary", headers=orphan)).status_code == 200


async def test_cards_require_login(client):
    assert (await client.get("/api/cards")).status_code == 401
    assert (await client.post("/api/cards", json={"address": "ул. Зорге, 1"})).status_code == 401


async def test_unknown_card_is_404(client, jj):
    aero = await login_as(client, jj, "inspector1")
    r = await client.get("/api/cards/00000000-0000-0000-0000-000000000000", headers=aero)
    assert r.status_code == 404
