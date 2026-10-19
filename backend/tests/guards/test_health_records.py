"""Гейт анализов и давления (инвариант I22): запись — как на бланке и на тонометре.

Значение анализа хранит число, единицу и референс так, как они напечатаны, а показание —
верхнее, нижнее и пульс. Отметки «вне референса» и «выше 135/85» вычисляются при выводе:
сохранённая отметка молча разошлась бы с исправленным значением. Показатель значения и
единица своего показателя задаются при создании: их смена превратила бы гемоглобин в
ферритин.
"""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from app.models import BloodPressureReading, LabAnalyte, LabReport, LabValue
from tests.conftest import MakeUser
from tests.labs import (
    add_analyte,
    add_report,
    analytes,
    own_value,
    preset_value,
    put_analyte,
    put_value,
    reports,
)
from tests.pressure import bp, put_bp, readings

pytestmark = pytest.mark.anyio

TIMESTAMPS = {"created_at", "updated_at"}

# Всё, что лежит в записях. Новая колонка — только вместе с правкой инварианта I22:
# вычисленное значение (отметка, категория, среднее) сюда не добавляется.
COLUMNS: dict[type[Any], set[str]] = {
    LabReport: {"id", "user_id", "local_date", "lab", "note", *TIMESTAMPS},
    LabValue: {
        "id",
        "report_id",
        "preset",
        "analyte_id",
        "value",
        "original_value",
        "original_unit",
        "ref_low",
        "ref_high",
        *TIMESTAMPS,
    },
    LabAnalyte: {"id", "user_id", "name", "unit", "archived_at", *TIMESTAMPS},
    BloodPressureReading: {
        "id",
        "user_id",
        "measured_at",
        "local_date",
        "systolic",
        "diastolic",
        "pulse",
        *TIMESTAMPS,
    },
}

VALUE_FIELDS = {
    "id",
    "preset",
    "analyte_id",
    "value",
    "original_value",
    "original_unit",
    "ref_low",
    "ref_high",
}


@pytest.mark.parametrize("model", COLUMNS, ids=lambda model: model.__tablename__)
def test_record_stores_nothing_computed(model: Any) -> None:
    assert set(model.__table__.columns.keys()) == COLUMNS[model]


async def test_answers_carry_nothing_computed(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    report_id = await add_report(client, user)

    value = await put_value(client, user, report_id)
    reading = await put_bp(client, user, bp())
    [report] = await reports(client, user)

    assert set(value.json()) == VALUE_FIELDS
    assert set(report) == {"id", "local_date", "lab", "note", "values"}
    assert set(report["values"][0]) == VALUE_FIELDS
    assert set(reading.json()) == {
        "id",
        "measured_at",
        "local_date",
        "systolic",
        "diastolic",
        "pulse",
    }


async def test_value_and_reference_come_back_in_the_unit_of_the_blank(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    report_id = await add_report(client, user)

    await put_value(
        client,
        user,
        report_id,
        preset_value("testosterone", 450, "ng_dl", ref_low=264, ref_high=916),
    )
    [report] = await reports(client, user)

    [value] = report["values"]
    assert (value["original_value"], value["original_unit"]) == (450, "ng_dl")
    assert (value["ref_low"], value["ref_high"]) == (264, 916)


@pytest.mark.parametrize(
    ("second", "field"),
    [
        pytest.param({"preset": "ferritin", "unit": "ug_l"}, "preset", id="another preset"),
        pytest.param({"preset": None, "unit": None, "analyte_id": "own"}, "preset", id="to own"),
    ],
)
async def test_preset_of_a_value_is_fixed_at_creation(
    client: AsyncClient, make_user: MakeUser, second: dict[str, Any], field: str
) -> None:
    user = await make_user()
    report_id = await add_report(client, user)
    own = await add_analyte(client, user)
    key = str(uuid.uuid7())
    await put_value(client, user, report_id, preset_value(), key)
    before = await reports(client, user)
    body = {**preset_value(), **second}
    if body.get("analyte_id") == "own":
        body["analyte_id"] = own

    response = await put_value(client, user, report_id, body, key)

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", field]
    assert await reports(client, user) == before


async def test_own_analyte_of_a_value_is_fixed_at_creation(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    report_id = await add_report(client, user)
    first = await add_analyte(client, user)
    second = await add_analyte(client, user, name="Антитела к ТГ")
    key = str(uuid.uuid7())
    await put_value(client, user, report_id, own_value(first), key)
    before = await reports(client, user)

    response = await put_value(client, user, report_id, own_value(second), key)

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "analyte_id"]
    assert await reports(client, user) == before


async def test_unit_of_an_own_analyte_is_fixed_at_creation(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    analyte = await add_analyte(client, user)
    before = await analytes(client, user)

    response = await put_analyte(client, user, "Антитела к ТПО", "Ед/мл", analyte_id=analyte)

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "unit"]
    assert await analytes(client, user) == before


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(preset_value("glucose", 5.4, "g_l"), id="unit of another analyte"),
        pytest.param({**preset_value(), "out_of_range": False}, id="computed mark"),
    ],
)
async def test_value_beside_the_analyte_is_rejected(
    client: AsyncClient, make_user: MakeUser, body: dict[str, Any]
) -> None:
    user = await make_user()
    report_id = await add_report(client, user)

    response = await put_value(client, user, report_id, body)

    assert response.status_code == 422
    assert [item["values"] for item in await reports(client, user)] == [[]]


async def test_pressure_reading_rejects_a_computed_mark(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()

    response = await put_bp(client, user, {**bp(142, 91), "above_home_limit": True})

    assert response.status_code == 422
    assert await readings(client, user) == []
