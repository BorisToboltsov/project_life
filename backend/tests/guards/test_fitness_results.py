"""Гейт результатов тестов (инвариант I21): результат сырой и со своим протоколом.

Запись хранит то, что человек сделал, — дистанцию с исходной единицей или повторы, а у
отжиманий ещё и вариант. VO2max и оценка по нормам не хранятся: сохранённая оценка молча
разошлась бы с таблицей норм или профилем. Тест и вариант задаются при создании и потом
не меняются.
"""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from app.models import FitnessResult
from tests.conftest import MakeUser
from tests.fitness import cooper, pull_ups, push_ups, put_result, results

pytestmark = pytest.mark.anyio

# Всё, что лежит в записи. Новая колонка — только вместе с правкой инварианта I21:
# вычисленное значение (VO2max, оценка, возраст) сюда не добавляется.
COLUMNS = {
    "id",
    "user_id",
    "test",
    "tested_at",
    "local_date",
    "reps",
    "distance_m",
    "distance_value",
    "distance_unit",
    "variant",
    "created_at",
    "updated_at",
}


def test_result_stores_nothing_computed() -> None:
    assert set(FitnessResult.__table__.columns.keys()) == COLUMNS


async def test_answer_carries_nothing_computed(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()

    created = await put_result(client, user, cooper())

    assert set(created.json()) == {
        "id",
        "test",
        "tested_at",
        "local_date",
        "reps",
        "distance_m",
        "distance_value",
        "distance_unit",
        "variant",
    }


@pytest.mark.parametrize(
    ("first", "second", "field"),
    [
        pytest.param(
            push_ups(variant="knee"), push_ups(variant="classic"), "variant", id="variant"
        ),
        pytest.param(push_ups(), pull_ups(), "test", id="push-ups to pull-ups"),
        pytest.param(cooper(), pull_ups(), "test", id="cooper to pull-ups"),
    ],
)
async def test_test_and_variant_are_fixed_at_creation(
    client: AsyncClient,
    make_user: MakeUser,
    first: dict[str, Any],
    second: dict[str, Any],
    field: str,
) -> None:
    user = await make_user()
    key = str(uuid.uuid7())
    await put_result(client, user, first, key)
    before = await results(client, user)

    response = await put_result(client, user, second, key)

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", field]
    assert await results(client, user) == before


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({**cooper(), "reps": 40}, id="cooper with reps"),
        pytest.param({**pull_ups(), "distance_value": 2000, "distance_unit": "m"}, id="distance"),
        pytest.param({**pull_ups(), "variant": "classic"}, id="pull-ups with a variant"),
        pytest.param({k: v for k, v in push_ups().items() if k != "variant"}, id="no variant"),
        pytest.param({k: v for k, v in cooper().items() if k != "distance_unit"}, id="no unit"),
        pytest.param({**pull_ups(), "vo2max": 47.1}, id="computed value"),
    ],
)
async def test_fields_of_another_test_are_rejected(
    client: AsyncClient, make_user: MakeUser, body: dict[str, Any]
) -> None:
    user = await make_user()

    response = await put_result(client, user, body)

    assert response.status_code == 422
    assert await results(client, user) == []
