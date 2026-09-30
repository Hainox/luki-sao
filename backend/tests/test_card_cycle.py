"""Полный цикл карточки: ДО → ПОСЛЕ → проверка → возврат → новое ПОСЛЕ → приёмка."""
import asyncio
import uuid

from tests.conftest import DISTRICT_IDS, create_card, login_as, run_sql, upload


async def test_full_cycle_keeps_history_and_counts_detected_once(client, jj, admin):
    inspector = await login_as(client, jj, "inspector1", district="Аэропорт")
    colleague = await login_as(client, jj, "inspector2", district="Аэропорт")

    card = await create_card(client, inspector, address="Ленинградский пр-т, 64", comment="Провал крышки",
                             lat=55.8, lon=37.53)
    assert card["label"] == "ОЛХ-001"
    assert card["status"] == "detected"
    assert card["district_name"] == "Аэропорт"
    assert card["permissions"] == {"can_add_before": True, "can_add_after": True, "can_review": False}
    card_id = card["id"]

    r = await upload(client, inspector, card_id, "before")
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "before" and r.json()["attempt"] == 0

    # Первое фото ПОСЛЕ (от коллеги из того же района) отправляет карточку на проверку.
    r = await upload(client, colleague, card_id, "after")
    assert r.status_code == 201, r.text
    assert r.json()["attempt"] == 1
    detail = (await client.get(f"/api/cards/{card_id}", headers=inspector)).json()
    assert detail["status"] == "on_review"
    assert detail["current_attempt"] == 1

    # Ещё одно фото в ту же попытку — статус не меняется, событие не дублируется.
    r = await upload(client, colleague, card_id, "after")
    assert r.status_code == 201
    detail = (await client.get(f"/api/cards/{card_id}", headers=inspector)).json()
    assert detail["status"] == "on_review"
    assert detail["after_count"] == 2
    assert [e["kind"] for e in detail["events"]] == ["created", "after_uploaded"]

    # Фото ДО после начала исправления добавить уже нельзя.
    r = await upload(client, inspector, card_id, "before")
    assert r.status_code == 409

    # Возврат без комментария — нельзя.
    r = await client.post(f"/api/cards/{card_id}/return", json={"comment": "   "}, headers=admin)
    assert r.status_code == 422
    r = await client.post(f"/api/cards/{card_id}/return", json={"comment": "Крышка не закреплена"},
                          headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "returned"
    assert r.json()["return_comment"] == "Крышка не закреплена"

    listed = (await client.get("/api/cards", headers=inspector)).json()
    assert listed["items"][0]["status"] == "returned"
    assert listed["items"][0]["return_comment"] == "Крышка не закреплена"
    assert listed["items"][0]["after_count"] == 2  # последняя попытка до нового фото

    # Новое фото ПОСЛЕ в той же карточке — попытка 2.
    r = await upload(client, inspector, card_id, "after")
    assert r.status_code == 201
    assert r.json()["attempt"] == 2
    listed = (await client.get("/api/cards", headers=inspector)).json()
    item = listed["items"][0]
    assert item["status"] == "on_review"
    assert item["after_count"] == 1
    assert item["after_photo"]["attempt"] == 2
    assert item["return_comment"] is None

    r = await client.post(f"/api/cards/{card_id}/accept", headers=admin)
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["status"] == "accepted"
    assert detail["accepted_at"] is not None
    assert detail["permissions"] == {"can_add_before": False, "can_add_after": False, "can_review": False}

    # Вся история на месте: 1 ДО, 2 ПОСЛЕ попытки 1, 1 ПОСЛЕ попытки 2.
    photos = [(p["kind"], p["attempt"]) for p in detail["photos"]]
    assert photos == [("before", 0), ("after", 1), ("after", 1), ("after", 2)]
    assert [(e["kind"], e["attempt"], e["comment"]) for e in detail["events"]] == [
        ("created", None, None),
        ("after_uploaded", 1, None),
        ("returned", 1, "Крышка не закреплена"),
        ("after_uploaded", 2, None),
        ("accepted", 2, None),
    ]
    assert detail["events"][2]["user"]["login"] == "prefect"

    # После приёмки ПОСЛЕ больше не принимается, решение повторно не выносится.
    assert (await upload(client, inspector, card_id, "after")).status_code == 409
    assert (await client.post(f"/api/cards/{card_id}/accept", headers=admin)).status_code == 409

    # Возврат и повторное исправление — та же карточка, новая не появилась.
    listed = (await client.get("/api/cards", headers=inspector)).json()
    assert listed["counts"] == {"all": 1, "open": 0, "on_review": 0, "accepted": 1}

    actions = [a for (a,) in run_sql("SELECT action FROM audit_log ORDER BY created_at")]
    for expected in ("card_create", "photo_upload", "card_return", "card_accept"):
        assert expected in actions


async def test_numbers_are_global_and_zero_padded(client, jj, admin):
    a = await login_as(client, jj, "inspector1", district="Аэропорт")
    b = await login_as(client, jj, "inspector2", district="Сокол")
    assert (await create_card(client, a))["label"] == "ОЛХ-001"
    assert (await create_card(client, b))["label"] == "ОЛХ-002"
    assert (await create_card(client, admin, district="Коптево"))["label"] == "ОЛХ-003"
    run_sql("ALTER SEQUENCE card_number_seq RESTART WITH 1000")
    card = await create_card(client, a)
    assert card["number"] == 1000
    assert card["label"] == "ОЛХ-1000"


async def test_review_queue_is_oldest_first(client, jj, admin):
    inspector = await login_as(client, jj, "inspector1", district="Аэропорт")
    first = await create_card(client, inspector, address="Первый адрес")
    second = await create_card(client, inspector, address="Второй адрес")
    untouched = await create_card(client, inspector, address="Без исправления")
    # Сначала на проверку уходит вторая карточка, потом первая.
    assert (await upload(client, inspector, second["id"], "after")).status_code == 201
    assert (await upload(client, inspector, first["id"], "after")).status_code == 201

    r = await client.get("/api/cards/review-queue", headers=admin)
    assert r.status_code == 200
    queue = r.json()
    assert queue["total"] == 2
    assert [c["id"] for c in queue["items"]] == [second["id"], first["id"]]
    assert untouched["id"] not in [c["id"] for c in queue["items"]]
    assert queue["items"][0]["permissions"]["can_review"] is True

    await client.post(f"/api/cards/{second['id']}/accept", headers=admin)
    queue = (await client.get("/api/cards/review-queue", headers=admin)).json()
    assert [c["id"] for c in queue["items"]] == [first["id"]]


async def test_decisions_only_for_cards_on_review(client, jj, admin):
    inspector = await login_as(client, jj, "inspector1")
    card = await create_card(client, inspector)
    r = await client.post(f"/api/cards/{card['id']}/accept", headers=admin)
    assert r.status_code == 409
    r = await client.post(f"/api/cards/{card['id']}/return", json={"comment": "нет"}, headers=admin)
    assert r.status_code == 409


async def test_admin_creates_card_in_chosen_district(client, jj, admin):
    r = await client.post("/api/cards", json={"address": "ул. Зорге, 1"}, headers=admin)
    assert r.status_code == 422
    assert r.json()["detail"] == "Выберите район"
    card = await create_card(client, admin, district="Сокол")
    assert card["district_id"] == DISTRICT_IDS["Сокол"]


async def test_coordinates_are_rounded_and_paired(client, jj):
    inspector = await login_as(client, jj, "inspector1")
    card = await create_card(client, inspector, lat=55.80512345678, lon=37.51234567891)
    detail = (await client.get(f"/api/cards/{card['id']}", headers=inspector)).json()
    assert detail["lat"] == "55.805123"
    assert detail["lon"] == "37.512346"
    r = await client.post("/api/cards", json={"address": "ул. Зорге, 1", "lat": 55.8}, headers=inspector)
    assert r.status_code == 422
    r = await client.post("/api/cards", json={"address": "ул. Зорге, 1", "lat": 95, "lon": 37}, headers=inspector)
    assert r.status_code == 422


async def test_parallel_first_after_photos_make_one_attempt(client, jj, admin):
    # Двойное нажатие / два телефона одновременно: обе фотографии попадают в
    # одну попытку, на проверку карточка уходит один раз.
    inspector = await login_as(client, jj, "inspector1")
    colleague = await login_as(client, jj, "inspector2")
    card = await create_card(client, inspector)
    for _ in range(3):
        results = await asyncio.gather(
            upload(client, inspector, card["id"], "after"),
            upload(client, colleague, card["id"], "after"),
        )
        assert [r.status_code for r in results] == [201, 201]
        detail = (await client.get(f"/api/cards/{card['id']}", headers=admin)).json()
        assert detail["status"] == "on_review"
        assert {r.json()["attempt"] for r in results} == {detail["current_attempt"]}
        assert detail["after_count"] == 2
        r = await client.post(f"/api/cards/{card['id']}/return", json={"comment": "Ещё раз"}, headers=admin)
        assert r.status_code == 200
    kinds = [(e["kind"], e["attempt"]) for e in detail["events"] if e["kind"] == "after_uploaded"]
    assert kinds == [("after_uploaded", 1), ("after_uploaded", 2), ("after_uploaded", 3)]



async def test_decision_during_upload_rejects_stale_after_photo(client, jj, admin, monkeypatch):
    # Фото ПОСЛЕ уходят по одному по медленной связи, а карточка попадает в
    # очередь префектуры уже после первого. Если префектура вернула её, пока
    # грузилось второе, это фото снято к отклонённой попытке — оно не должно
    # молча открыть новую попытку и снова отправить карточку на проверку.
    from app.routers import cards as cards_router

    inspector = await login_as(client, jj, "inspector1")
    card = await create_card(client, inspector)
    assert (await upload(client, inspector, card["id"], "after")).status_code == 201

    real_save = cards_router.save_photo

    async def save_while_prefecture_returns(file, kind):
        stored = await real_save(file, kind)
        r = await client.post(f"/api/cards/{card['id']}/return", json={"comment": "Не видно крышку"},
                              headers=admin)
        assert r.status_code == 200
        return stored

    monkeypatch.setattr(cards_router, "save_photo", save_while_prefecture_returns)
    r = await upload(client, inspector, card["id"], "after")
    assert r.status_code == 409
    assert "решение" in r.json()["detail"]
    monkeypatch.setattr(cards_router, "save_photo", real_save)

    detail = (await client.get(f"/api/cards/{card['id']}", headers=inspector)).json()
    assert (detail["status"], detail["current_attempt"]) == ("returned", 1)
    assert [(p["kind"], p["attempt"]) for p in detail["photos"]] == [("after", 1)]

    # Новое фото, снятое уже после возврата, открывает попытку 2 как обычно.
    r = await upload(client, inspector, card["id"], "after")
    assert r.status_code == 201 and r.json()["attempt"] == 2


async def test_repeated_create_with_same_id_does_not_duplicate_card(client, jj):
    # Ответ на «Зафиксировать» потерялся по мобильной связи, сотрудник жмёт
    # ещё раз: вторая карточка навсегда завысила бы «Выявлено» (удаления нет).
    inspector = await login_as(client, jj, "inspector1")
    colleague = await login_as(client, jj, "inspector2")
    card_id = str(uuid.uuid4())
    first = await create_card(client, inspector, id=card_id)
    again = await create_card(client, inspector, id=card_id)
    assert first["id"] == again["id"] == card_id
    assert first["label"] == again["label"]
    assert [e["kind"] for e in again["events"]] == ["created"]
    assert (await client.get("/api/cards", headers=inspector)).json()["counts"]["all"] == 1

    r = await client.post("/api/cards", json={"id": card_id, "address": "ул. Зорге, 1"}, headers=colleague)
    assert r.status_code == 409
    assert (await client.get("/api/cards", headers=inspector)).json()["counts"]["all"] == 1
