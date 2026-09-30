"""Фильтры журнала и счётчики рядом с ними: учитывают район и период."""
from datetime import datetime, timedelta, timezone

from tests.conftest import DISTRICT_IDS, create_card, login_as, set_created_at, upload


async def _card_with_status(client, author, admin, status: str) -> dict:
    card = await create_card(client, author)
    if status in ("on_review", "accepted", "returned"):
        assert (await upload(client, author, card["id"], "after")).status_code == 201
    if status == "accepted":
        assert (await client.post(f"/api/cards/{card['id']}/accept", headers=admin)).status_code == 200
    if status == "returned":
        r = await client.post(f"/api/cards/{card['id']}/return", json={"comment": "Переделать"}, headers=admin)
        assert r.status_code == 200
    return card


async def test_counts_and_filter_groups(client, jj, admin):
    aero = await login_as(client, jj, "inspector1", district="Аэропорт")
    sokol = await login_as(client, jj, "inspector2", district="Сокол")
    aero_cards = {}
    for status in ("detected", "detected", "returned", "on_review", "accepted", "accepted"):
        aero_cards.setdefault(status, []).append(await _card_with_status(client, aero, admin, status))
    await _card_with_status(client, sokol, admin, "on_review")
    await _card_with_status(client, sokol, admin, "detected")

    counts = (await client.get("/api/cards", headers=aero)).json()["counts"]
    # «Выявлено (не исправлено)» = выявлено + возвращено.
    assert counts == {"all": 6, "open": 3, "on_review": 1, "accepted": 2}

    everything = (await client.get("/api/cards", headers=admin)).json()["counts"]
    assert everything == {"all": 8, "open": 4, "on_review": 2, "accepted": 2}

    only_sokol = (await client.get("/api/cards", params={"district_id": DISTRICT_IDS["Сокол"]},
                                   headers=admin)).json()["counts"]
    assert only_sokol == {"all": 2, "open": 1, "on_review": 1, "accepted": 0}

    r = (await client.get("/api/cards", params={"filter": "open"}, headers=aero)).json()
    assert r["total"] == 3
    assert {c["status"] for c in r["items"]} == {"detected", "returned"}
    r = (await client.get("/api/cards", params={"filter": "accepted"}, headers=aero)).json()
    assert [c["status"] for c in r["items"]] == ["accepted", "accepted"]
    r = (await client.get("/api/cards", params={"filter": "on_review"}, headers=admin)).json()
    assert r["total"] == 2
    # Счётчики не зависят от выбранного фильтра — только от района и периода.
    assert r["counts"] == everything

    r = await client.get("/api/cards", params={"filter": "bogus"}, headers=admin)
    assert r.status_code == 422


async def test_counts_respect_period(client, jj, admin):
    aero = await login_as(client, jj, "inspector1", district="Аэропорт")
    fresh = await _card_with_status(client, aero, admin, "accepted")
    old = await _card_with_status(client, aero, admin, "detected")
    ancient = await _card_with_status(client, aero, admin, "on_review")
    now = datetime.now(timezone.utc)
    set_created_at(old["id"], (now - timedelta(days=10)).isoformat())
    set_created_at(ancient["id"], (now - timedelta(days=60)).isoformat())

    async def counts(**params):
        r = await client.get("/api/cards", params=params, headers=aero)
        assert r.status_code == 200, r.text
        return r.json()

    assert (await counts(period="all"))["counts"] == {"all": 3, "open": 1, "on_review": 1, "accepted": 1}
    today = await counts(period="today")
    assert today["counts"] == {"all": 1, "open": 0, "on_review": 0, "accepted": 1}
    assert [c["id"] for c in today["items"]] == [fresh["id"]]
    assert today["period"]["date_from"] == today["period"]["date_to"]
    assert (await counts(period="week"))["counts"]["all"] == 1
    assert (await counts(period="month"))["counts"] == {"all": 2, "open": 1, "on_review": 0, "accepted": 1}

    day = (now - timedelta(days=60)).astimezone(timezone(timedelta(hours=3))).date().isoformat()
    custom = await counts(period="custom", date_from=day, date_to=day)
    assert [c["id"] for c in custom["items"]] == [ancient["id"]]
    assert custom["period"]["label"] == datetime.fromisoformat(day).strftime("%d.%m.%Y")

    r = await client.get("/api/cards", params={"period": "custom"}, headers=aero)
    assert r.status_code == 422
    r = await client.get("/api/cards", params={"period": "custom", "date_from": "2026-09-10",
                                               "date_to": "2026-09-01"}, headers=aero)
    assert r.status_code == 422


async def test_list_is_newest_first_and_paginated(client, jj):
    aero = await login_as(client, jj, "inspector1", district="Аэропорт")
    labels = [(await create_card(client, aero, address=f"Дом {i}"))["label"] for i in range(5)]
    page1 = (await client.get("/api/cards", params={"page_size": 2}, headers=aero)).json()
    page3 = (await client.get("/api/cards", params={"page_size": 2, "page": 3}, headers=aero)).json()
    assert [c["label"] for c in page1["items"]] == labels[::-1][:2]
    assert [c["label"] for c in page3["items"]] == [labels[0]]
    assert page1["total"] == 5
