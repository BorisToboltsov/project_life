import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import products
from app.models import BarcodeMiss, Language, Product, User
from app.services import open_food_facts
from tests.conftest import MakeUser, OffStub
from tests.nutrition import (
    BY_HAND,
    COTTAGE_CHEESE,
    EAN_8,
    EAN_13,
    LABEL,
    NO_LABEL,
    OFF_COTTAGE_CHEESE,
    OFF_LABEL,
    UPC_A,
    UPC_A_AS_EAN_13,
    add_entry,
    add_product,
    lookup,
    read_day,
)

pytestmark = pytest.mark.anyio

NOT_FOUND = {"status": "not_found", "barcode": EAN_13, "product": None, "draft": None}


# --- Свой каталог ------------------------------------------------------------------------


async def test_product_of_the_catalog_is_found_without_asking_outside(
    client: AsyncClient, make_user: MakeUser, off: OffStub
) -> None:
    author, reader = await make_user(), await make_user()
    product_id = await add_product(client, author, barcode=EAN_13)

    response = await lookup(client, reader, EAN_13)

    assert response.status_code == 200
    assert response.json() == {
        "status": "found",
        "barcode": EAN_13,
        "product": {
            **COTTAGE_CHEESE,
            **NO_LABEL,
            "id": product_id,
            "barcode": EAN_13,
            "source": "user",
            # Продукт чужой: найти и внести можно, править — нет.
            "editable": False,
        },
        "draft": None,
    }
    assert off.requests == []


async def test_scanners_read_one_package_differently(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author = await make_user()
    product_id = await add_product(client, author, barcode=UPC_A)

    as_upc, as_ean = (
        await lookup(client, author, UPC_A),
        await lookup(client, author, UPC_A_AS_EAN_13),
    )

    assert as_upc.json()["barcode"] == as_ean.json()["barcode"] == UPC_A_AS_EAN_13
    assert as_upc.json()["product"]["id"] == as_ean.json()["product"]["id"] == product_id


@pytest.mark.parametrize("barcode", ["", "4600000000000", "460000000", "abc", "1" * 40])
async def test_misread_barcode_is_rejected(
    client: AsyncClient, make_user: MakeUser, off: OffStub, barcode: str
) -> None:
    response = await lookup(client, await make_user(), barcode)

    assert response.status_code == 422
    assert off.requests == []


async def test_without_the_source_only_the_catalog_is_searched(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    response = await lookup(client, await make_user(), EAN_13)

    assert response.json() == NOT_FOUND
    # Наружу не спрашивали — запоминать нечего.
    assert list(await db.scalars(select(BarcodeMiss))) == []


# --- Open Food Facts ---------------------------------------------------------------------


async def test_complete_product_goes_straight_into_the_catalog(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, off: OffStub
) -> None:
    scanner, reader = await make_user(), await make_user()
    off.products[EAN_13] = OFF_COTTAGE_CHEESE

    response = await lookup(client, scanner, EAN_13)

    found = response.json()["product"]
    assert response.json()["status"] == "found"
    assert found == {
        **COTTAGE_CHEESE,
        **NO_LABEL,
        "name": "Творог 5 %, Простоквашино",
        "id": found["id"],
        "barcode": EAN_13,
        "source": "open_food_facts",
        # Кто сканировал, тот и исправит ошибку в составе.
        "editable": True,
    }
    assert uuid.UUID(found["id"]).version == 7
    stored = await db.get_one(Product, uuid.UUID(found["id"]))
    assert str(stored.created_by) == scanner.id
    # Продукт в общем каталоге: другой человек находит его уже без обращения наружу.
    again = await lookup(client, reader, EAN_13)
    assert again.json()["product"] == {**found, "editable": False}
    assert len(off.requests) == 1


async def test_found_product_is_ready_for_the_diary(
    client: AsyncClient, make_user: MakeUser, off: OffStub
) -> None:
    user = await make_user()
    off.products[EAN_13] = OFF_COTTAGE_CHEESE

    product_id = (await lookup(client, user, EAN_13)).json()["product"]["id"]
    await add_entry(client, user, product_id, 150)

    assert (await read_day(client, user))["totals"]["kcal"] == 181.5


async def test_what_else_is_on_the_label_comes_with_the_product(
    client: AsyncClient, make_user: MakeUser, off: OffStub
) -> None:
    nutriments = {**OFF_COTTAGE_CHEESE["nutriments"], **OFF_LABEL}
    off.products[EAN_13] = {**OFF_COTTAGE_CHEESE, "nutriments": nutriments}
    # Сахаров больше, чем углеводов, насыщенных жиров — чем жиров: в источнике ошибка.
    # Продукт всё равно полный, только без этих двух значений.
    off.products[EAN_8] = {
        **OFF_COTTAGE_CHEESE,
        "nutriments": {**nutriments, "sugars_100g": 1.81, "saturated-fat_100g": 5.5},
    }
    # Неполному продукту известное с этикетки тоже подставляется в форму.
    off.products[UPC_A_AS_EAN_13] = {"product_name": "Творог", "nutriments": OFF_LABEL}
    user = await make_user()

    complete, doubtful, partial = [
        (await lookup(client, user, barcode)).json() for barcode in (EAN_13, EAN_8, UPC_A)
    ]

    assert {name: complete["product"][name] for name in LABEL} == LABEL
    assert doubtful["status"] == "found"
    assert {name: doubtful["product"][name] for name in LABEL} == {
        **LABEL,
        "sugars_g": None,
        "saturated_fat_g": None,
    }
    assert partial["status"] == "draft"
    assert {name: partial["draft"][name] for name in LABEL} == LABEL


async def test_name_follows_the_language_of_whoever_scans(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, off: OffStub
) -> None:
    user = await make_user()
    await db.execute(update(User).values(language=Language.EN))
    await db.commit()
    off.products[EAN_13] = {**OFF_COTTAGE_CHEESE, "brands": "", "product_name_en": "Cottage cheese"}

    response = await lookup(client, user, EAN_13)

    assert response.json()["product"]["name"] == "Cottage cheese"


async def test_drink_from_the_source_is_measured_in_millilitres(
    client: AsyncClient, make_user: MakeUser, off: OffStub
) -> None:
    off.products[EAN_8] = {
        "product_name": "Кефир 1 %",
        "quantity": "930 мл",
        "nutriments": {"proteins_100g": 3, "fat_100g": 1, "carbohydrates_100g": 4},
    }

    found = (await lookup(client, await make_user(), EAN_8)).json()["product"]

    # Калорий в источнике нет — посчитаны по белкам, жирам и углеводам.
    assert (found["unit"], found["kcal"], found["barcode"]) == ("ml", 37, EAN_8)


@pytest.mark.parametrize(
    ("product", "draft"),
    [
        # Нет углеводов: калории есть, но продукт каталога из этого не собрать.
        (
            {
                "product_name": "Творог",
                "nutriments": {"energy-kcal_100g": 121, "proteins_100g": 17.2, "fat_100g": 5},
            },
            {"name": "Творог", "kcal": 121, "protein_g": 17.2, "fat_g": 5, "carbs_g": None},
        ),
        # Название есть, состава нет вовсе.
        (
            {"product_name": "Чай чёрный", "brands": "Гринфилд"},
            {
                "name": "Чай чёрный, Гринфилд",
                "kcal": None,
                "protein_g": None,
                "fat_g": None,
                "carbs_g": None,
            },
        ),
        # Состав полный, названия нет.
        (
            {"nutriments": OFF_COTTAGE_CHEESE["nutriments"]},
            {"name": None, "kcal": 121, "protein_g": 17.2, "fat_g": 5, "carbs_g": 1.8},
        ),
        # Белки, жиры и углеводы не помещаются в 100 г: такому составу верить нельзя.
        (
            {
                "product_name": "Чудо",
                "nutriments": {
                    "energy-kcal_100g": 500,
                    "proteins_100g": 50,
                    "fat_100g": 40,
                    "carbohydrates_100g": 30,
                },
            },
            {"name": "Чудо", "kcal": 500, "protein_g": 50, "fat_g": 40, "carbs_g": 30},
        ),
    ],
)
async def test_incomplete_product_comes_back_as_a_draft(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    off: OffStub,
    product: dict[str, Any],
    draft: dict[str, Any],
) -> None:
    off.products[EAN_13] = product

    response = await lookup(client, await make_user(), EAN_13)

    assert response.json() == {
        "status": "draft",
        "barcode": EAN_13,
        "product": None,
        "draft": {"unit": "g", **NO_LABEL, **draft},
    }
    # В каталог неполный продукт не попал, а в «не найдено» не записан.
    assert list(await db.scalars(select(Product))) == []
    assert list(await db.scalars(select(BarcodeMiss))) == []


async def test_draft_becomes_a_product_when_the_user_completes_it(
    client: AsyncClient, make_user: MakeUser, off: OffStub
) -> None:
    user = await make_user()
    off.products[EAN_13] = {"product_name": "Творог 5 %"}
    draft = (await lookup(client, user, EAN_13)).json()

    product_id = await add_product(client, user, name=draft["draft"]["name"], barcode=EAN_13)

    found = (await lookup(client, user, EAN_13)).json()
    assert found["status"] == "found"
    # Состав внёс человек: источник продукта — он.
    assert found["product"] == {
        **COTTAGE_CHEESE,
        **BY_HAND,
        "id": product_id,
        "barcode": EAN_13,
        "editable": True,
    }
    assert len(off.requests) == 1


# --- Не найдено и недоступно -------------------------------------------------------------


async def test_unknown_barcode_is_remembered(
    client: AsyncClient, make_user: MakeUser, off: OffStub
) -> None:
    first, second = await make_user(), await make_user()

    answers = [await lookup(client, user, EAN_13) for user in (first, second, first)]

    assert [answer.json() for answer in answers] == [NOT_FOUND] * 3
    # Наружу спросили один раз — и не важно, кто спрашивает потом.
    assert len(off.requests) == 1


async def test_remembered_miss_expires(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, off: OffStub
) -> None:
    user = await make_user()
    await lookup(client, user, EAN_13)
    await lookup(client, user, EAN_8)
    stale = datetime.now(UTC) - products.MISS_TTL - timedelta(minutes=1)
    await db.execute(update(BarcodeMiss).values(checked_at=stale))
    await db.commit()
    # За это время продукт в источнике появился.
    off.products[EAN_13] = OFF_COTTAGE_CHEESE

    found = await lookup(client, user, EAN_13)
    await lookup(client, user, UPC_A)

    assert found.json()["status"] == "found"
    # Устаревшие записи убраны при следующей же новой.
    assert [miss.barcode for miss in await db.scalars(select(BarcodeMiss))] == [UPC_A_AS_EAN_13]


async def test_repeated_miss_is_refreshed_not_duplicated(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, off: OffStub
) -> None:
    user = await make_user()
    await lookup(client, user, EAN_13)
    almost_stale = datetime.now(UTC) - products.MISS_TTL + timedelta(minutes=1)
    await db.execute(update(BarcodeMiss).values(checked_at=almost_stale))
    await db.commit()

    # Запись ещё свежая — наружу не идём.
    await lookup(client, user, EAN_13)
    assert len(off.requests) == 1

    await db.execute(update(BarcodeMiss).values(checked_at=almost_stale - timedelta(minutes=2)))
    await db.commit()
    await lookup(client, user, EAN_13)

    (miss,) = list(await db.scalars(select(BarcodeMiss)))
    await db.refresh(miss)
    assert len(off.requests) == 2
    assert miss.checked_at > datetime.now(UTC) - timedelta(minutes=1)


async def test_unavailable_source_is_not_remembered(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, off: OffStub
) -> None:
    user = await make_user()
    off.broken = httpx.ConnectError("нет сети")

    failed = await lookup(client, user, EAN_13)
    off.broken = None
    off.products[EAN_13] = OFF_COTTAGE_CHEESE
    retried = await lookup(client, user, EAN_13)

    assert failed.status_code == 200
    assert failed.json() == {**NOT_FOUND, "status": "unavailable"}
    assert retried.json()["status"] == "found"
    assert list(await db.scalars(select(BarcodeMiss))) == []


async def test_each_user_has_a_budget_of_requests_outside(
    client: AsyncClient,
    make_user: MakeUser,
    off: OffStub,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(open_food_facts, "USER_LIMIT", 2)
    off.connect()
    hasty, calm = await make_user(), await make_user()
    known = await add_product(client, calm, barcode=UPC_A)
    off.broken = httpx.Response(503)

    answers = [await lookup(client, hasty, EAN_13) for _ in range(3)]

    assert [answer.status_code for answer in answers] == [200, 200, 429]
    assert answers[2].json() == {"detail": "too_many_attempts"}
    assert len(off.requests) == 2
    # Свой каталог предел не задевает, и у другого человека счёт свой.
    assert (await lookup(client, hasty, UPC_A)).json()["product"]["id"] == known
    assert (await lookup(client, calm, EAN_13)).status_code == 200


async def test_two_scans_of_one_new_product_make_one_product(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, off: OffStub
) -> None:
    first, second = await make_user(), await make_user()
    off.products[EAN_13] = OFF_COTTAGE_CHEESE
    # Пока первый запрос ждал источник, второй успел сохранить тот же штрихкод.
    off.meanwhile = lambda: add_product(
        client, second, name="Творог, внесён раньше", barcode=EAN_13
    )

    response = await lookup(client, first, EAN_13)

    assert response.json()["status"] == "found"
    assert response.json()["product"]["name"] == "Творог, внесён раньше"
    assert response.json()["product"]["editable"] is False
    assert len(list(await db.scalars(select(Product)))) == 1
