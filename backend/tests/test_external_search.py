from typing import Any

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Language, Product, User
from app.services import open_food_facts
from tests.conftest import MakeUser, OffStub
from tests.nutrition import (
    EAN_8,
    EAN_13,
    OFF_COTTAGE_CHEESE,
    UPC_A,
    UPC_A_AS_EAN_13,
    add_product,
    lookup,
    off_hit,
    search,
    search_outside,
)

pytestmark = pytest.mark.anyio

NOTHING: dict[str, Any] = {"status": "ok", "items": [], "next_page": None}
COTTAGE_CHEESE_OUTSIDE = {
    "barcode": EAN_13,
    "name": "Творог 5 %, Простоквашино",
    "unit": "g",
    "kcal": 121,
    "protein_g": 17.2,
    "fat_g": 5,
    "carbs_g": 1.8,
}


def barcodes_of(response: httpx.Response) -> list[str]:
    assert response.status_code == 200, response.text
    return [item["barcode"] for item in response.json()["items"]]


async def test_products_are_found_outside_by_name(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, off: OffStub
) -> None:
    off.hits = [
        off_hit(EAN_13),
        off_hit(EAN_8, product_name="Кефир", quantity="930 мл", nutriments={}),
    ]

    response = await search_outside(client, await make_user(), "  Творог 5% ")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "items": [
            COTTAGE_CHEESE_OUTSIDE,
            # Состава в источнике нет: продукт показывается, а дополнят его при выборе.
            {
                "barcode": EAN_8,
                "name": "Кефир, Простоквашино",
                "unit": "ml",
                "kcal": None,
                "protein_g": None,
                "fat_g": None,
                "carbs_g": None,
            },
        ],
        "next_page": None,
    }
    assert [request.url.params["q"] for request in off.requests] == ["творог 5%"]
    # Поиск ничего не сохраняет: в каталог продукт попадает, когда его выберут.
    assert list(await db.scalars(select(Product))) == []


async def test_what_the_catalog_already_has_is_not_listed_again(
    client: AsyncClient, make_user: MakeUser, off: OffStub
) -> None:
    user = await make_user()
    await add_product(client, user, barcode=UPC_A)
    # Один продукт в источнике записан дважды, а ещё один уже есть в каталоге.
    off.hits = [off_hit(EAN_13), off_hit(UPC_A), off_hit(EAN_13, product_name="Дубль")]

    response = await search_outside(client, user, "творог")

    assert response.json()["items"] == [COTTAGE_CHEESE_OUTSIDE]


async def test_chosen_product_moves_into_the_catalog(
    client: AsyncClient, make_user: MakeUser, off: OffStub
) -> None:
    user, other = await make_user(), await make_user()
    off.hits = [off_hit(EAN_13), off_hit(EAN_8)]
    off.products[EAN_13] = OFF_COTTAGE_CHEESE
    assert barcodes_of(await search_outside(client, user, "творог")) == [EAN_13, EAN_8]

    # Выбор — тот же запрос по штрихкоду, что и при сканировании.
    chosen = (await lookup(client, user, EAN_13)).json()

    assert chosen["status"] == "found"
    assert chosen["product"]["source"] == "open_food_facts"
    assert [item["id"] for item in await search(client, user, "творог")] == [
        chosen["product"]["id"]
    ]
    # Из выдачи источника он пропал — у всех, и новый запрос наружу для этого не нужен.
    assert barcodes_of(await search_outside(client, other, "творог")) == [EAN_8]
    assert [request.url.path for request in off.requests] == [
        "/search",
        f"/api/v2/product/{EAN_13}",
    ]


async def test_search_outside_comes_page_by_page(
    client: AsyncClient, make_user: MakeUser, off: OffStub
) -> None:
    user = await make_user()
    off.hits = [off_hit(EAN_13)] * 20 + [off_hit(EAN_8)] * 20 + [off_hit(UPC_A)]

    first, second, third = [
        (await search_outside(client, user, "творог", page)).json() for page in (None, 2, 3)
    ]

    assert [page["next_page"] for page in (first, second, third)] == [2, 3, None]
    assert [[item["barcode"] for item in page["items"]] for page in (first, second, third)] == [
        [EAN_13],
        [EAN_8],
        [UPC_A_AS_EAN_13],
    ]
    assert [request.url.params["page"] for request in off.requests] == ["1", "2", "3"]


async def test_page_stays_even_when_the_catalog_has_all_of_it(
    client: AsyncClient, make_user: MakeUser, off: OffStub
) -> None:
    user = await make_user()
    await add_product(client, user, barcode=EAN_13)
    off.hits = [off_hit(EAN_13)] * 20 + [off_hit(EAN_8)]

    response = await search_outside(client, user, "творог")

    # Страница пуста, но за ней есть следующая.
    assert response.json() == {"status": "ok", "items": [], "next_page": 2}


async def test_name_follows_the_language_of_whoever_searches(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, off: OffStub
) -> None:
    russian, english = await make_user(), await make_user()
    await db.execute(update(User).where(User.email == english.email).values(language=Language.EN))
    await db.commit()
    off.hits = [off_hit(EAN_13, brands=[], product_name_en="Cottage cheese")]

    names = [
        (await search_outside(client, user, "творог")).json()["items"][0]["name"]
        for user in (russian, english)
    ]

    assert names == ["Творог 5 %", "Cottage cheese"]
    # Второй ответ собран из первого: язык на запрос наружу не влияет.
    assert len(off.requests) == 1


@pytest.mark.parametrize("q", ["", " ", "я", "?!", " - я - "])
async def test_too_short_a_text_is_not_sent_outside(
    client: AsyncClient, make_user: MakeUser, off: OffStub, q: str
) -> None:
    off.hits = [off_hit(EAN_13)]

    response = await search_outside(client, await make_user(), q)

    assert response.json() == NOTHING
    assert off.requests == []


@pytest.mark.parametrize(
    "params",
    [{"q": "я" * 121}, {"q": "творог", "page": 0}, {"q": "творог", "page": 501}],
)
async def test_implausible_search_is_rejected(
    client: AsyncClient, make_user: MakeUser, off: OffStub, params: dict[str, Any]
) -> None:
    user = await make_user()

    response = await client.get("/api/products/external", params=params, headers=user.headers)

    assert response.status_code == 422
    assert off.requests == []


async def test_without_the_source_nothing_is_found_outside(
    client: AsyncClient, make_user: MakeUser
) -> None:
    response = await search_outside(client, await make_user(), "творог")

    assert response.json() == NOTHING


async def test_unavailable_source_is_reported_and_asked_again(
    client: AsyncClient, make_user: MakeUser, off: OffStub
) -> None:
    user = await make_user()
    off.hits = [off_hit(EAN_13)]
    off.broken = httpx.ConnectError("нет сети")

    failed = await search_outside(client, user, "творог")
    off.broken = None
    retried = await search_outside(client, user, "творог")

    assert failed.status_code == 200
    assert failed.json() == {**NOTHING, "status": "unavailable"}
    assert barcodes_of(retried) == [EAN_13]


async def test_each_user_has_a_budget_of_searches_outside(
    client: AsyncClient,
    make_user: MakeUser,
    off: OffStub,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(open_food_facts, "SEARCH_USER_LIMIT", 2)
    off.connect()
    hasty, calm = await make_user(), await make_user()
    off.hits = [off_hit(EAN_13)]
    off.products[EAN_13] = OFF_COTTAGE_CHEESE

    answers = [await search_outside(client, hasty, text) for text in ("творог", "кефир", "хлеб")]

    assert [answer.status_code for answer in answers] == [200, 200, 429]
    assert answers[2].json() == {"detail": "too_many_attempts"}
    assert len(off.requests) == 2
    # Уже спрошенное отдаётся из памяти и в счёт не идёт; у другого человека счёт свой.
    assert barcodes_of(await search_outside(client, hasty, "ТВОРОГ")) == [EAN_13]
    assert barcodes_of(await search_outside(client, calm, "хлеб")) == [EAN_13]
    # Выбор найденного — запрос по штрихкоду: у него свой счёт.
    assert (await lookup(client, hasty, EAN_13)).json()["status"] == "found"
