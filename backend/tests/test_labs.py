import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from app.labs import CATALOG, LabGroup, LabPreset
from tests.conftest import MakeUser
from tests.labs import (
    add_analyte,
    add_report,
    analytes,
    day,
    own_value,
    preset_value,
    put_analyte,
    put_report,
    put_value,
    report,
    reports,
)

pytestmark = pytest.mark.anyio


def test_catalog_describes_every_preset_with_its_unit_first() -> None:
    assert set(CATALOG) == set(LabPreset)
    for item in CATALOG.values():
        units = list(item.units.items())
        assert units[0] == (item.unit, 1)
        assert item.min_value < item.max_value


async def test_catalog_comes_with_the_own_analytes(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    await add_analyte(client, user)

    listed = await analytes(client, user)

    assert [item["name"] for item in listed["analytes"]] == ["Антитела к ТПО"]
    assert [item["code"] for item in listed["catalog"]] == [preset.value for preset in LabPreset]
    groups = [item["group"] for item in listed["catalog"]]
    # Группы идут подряд и в порядке экрана выбора.
    assert list(dict.fromkeys(groups)) == [group.value for group in LabGroup]
    glucose = next(item for item in listed["catalog"] if item["code"] == "glucose")
    assert glucose["unit"] == "mmol_l"
    assert glucose["units"] == [
        {"unit": "mmol_l", "factor": 1},
        {"unit": "mg_dl", "factor": 0.0555},
    ]


async def test_report_is_created_once_and_its_header_replaced(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    key = str(uuid.uuid7())

    created = await put_report(client, user, report(), key)
    await put_value(client, user, key)
    replaced = await put_report(client, user, report(days_ago=1, lab="  ", note="Натощак"), key)

    assert created.status_code == 201
    assert replaced.status_code == 200
    assert replaced.json()["local_date"] == day(1)
    # Пустая лаборатория — не указана; значения шапка не трогает.
    assert replaced.json()["lab"] is None
    assert replaced.json()["note"] == "Натощак"
    assert len(replaced.json()["values"]) == 1
    assert len(await reports(client, user)) == 1


async def test_value_in_another_unit_is_kept_as_entered_and_converted(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    report_id = await add_report(client, user)

    saved = await put_value(
        client,
        user,
        report_id,
        preset_value("glucose", 99, "mg_dl", ref_low=70, ref_high=99),
    )

    assert saved.status_code == 201
    assert saved.json() == {
        "id": saved.json()["id"],
        "preset": "glucose",
        "analyte_id": None,
        "value": 5.4945,
        "original_value": 99,
        "original_unit": "mg_dl",
        "ref_low": 70,
        "ref_high": 99,
    }


async def test_repeating_a_value_replaces_it(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    report_id = await add_report(client, user)
    key = str(uuid.uuid7())

    await put_value(client, user, report_id, preset_value(value=140), key)
    again = await put_value(client, user, report_id, preset_value(value=142, ref_high=None), key)

    assert again.status_code == 200
    [listed] = await reports(client, user)
    assert [(item["original_value"], item["ref_high"]) for item in listed["values"]] == [
        (142, None)
    ]


async def test_analyte_appears_once_in_a_report(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    first, second = await add_report(client, user), await add_report(client, user, days_ago=30)
    await put_value(client, user, first)

    twice = await put_value(client, user, first)
    elsewhere = await put_value(client, user, second)

    assert twice.status_code == 409
    assert twice.json() == {"detail": "lab_value_taken"}
    assert elsewhere.status_code == 201


async def test_own_analyte_value_has_no_unit_of_its_own(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    report_id = await add_report(client, user)
    analyte = await add_analyte(client, user)

    saved = await put_value(client, user, report_id, own_value(analyte, 12.5, ref_high=34))
    with_unit = await put_value(client, user, report_id, own_value(analyte, unit="g_l"))

    assert saved.status_code == 201
    assert saved.json()["value"] == 12.5
    assert saved.json()["original_unit"] is None
    assert saved.json()["ref_low"] is None
    assert with_unit.status_code == 422


async def test_value_needs_an_own_analyte_of_this_user(
    client: AsyncClient, make_user: MakeUser
) -> None:
    owner, stranger = await make_user(), await make_user()
    foreign = await add_analyte(client, stranger)
    report_id = await add_report(client, owner)

    taken = await put_value(client, owner, report_id, own_value(foreign))
    unknown = await put_value(client, owner, report_id, own_value(str(uuid.uuid7())))

    assert taken.status_code == 404
    assert taken.json() == {"detail": "lab_analyte_not_found"}
    assert unknown.json() == {"detail": "lab_analyte_not_found"}


async def test_own_analyte_is_renamed_removed_and_returned(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    analyte = await add_analyte(client, user)
    report_id = await add_report(client, user)
    await put_value(client, user, report_id, own_value(analyte))

    renamed = await put_analyte(client, user, "АТ-ТПО", analyte_id=analyte)
    removed = await client.delete(f"/api/lab-analytes/{analyte}", headers=user.headers)
    again = await client.delete(f"/api/lab-analytes/{analyte}", headers=user.headers)
    archived = (await analytes(client, user))["analytes"]
    kept = await reports(client, user)
    returned = await put_analyte(client, user, "АТ-ТПО", analyte_id=analyte)

    assert renamed.status_code == 200
    assert renamed.json() == {"id": analyte, "name": "АТ-ТПО", "unit": "МЕ/мл", "archived": False}
    assert removed.status_code == 204
    assert again.status_code == 404
    assert [item["archived"] for item in archived] == [True]
    assert len(kept[0]["values"]) == 1
    assert returned.json()["archived"] is False


async def test_deleting_a_report_takes_its_values(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    report_id = await add_report(client, user)
    await put_value(client, user, report_id)

    deleted = await client.delete(f"/api/lab-reports/{report_id}", headers=user.headers)
    again = await client.delete(f"/api/lab-reports/{report_id}", headers=user.headers)

    assert deleted.status_code == 204
    assert again.status_code == 404
    assert await reports(client, user) == []


async def test_deleting_a_value_keeps_the_report(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    report_id = await add_report(client, user)
    value = (await put_value(client, user, report_id)).json()["id"]
    path = f"/api/lab-reports/{report_id}/values/{value}"

    deleted = await client.delete(path, headers=user.headers)
    again = await client.delete(path, headers=user.headers)

    assert deleted.status_code == 204
    assert again.status_code == 404
    assert [item["values"] for item in await reports(client, user)] == [[]]


async def test_value_stays_in_its_report(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    first, second = await add_report(client, user), await add_report(client, user)
    key = (await put_value(client, user, first)).json()["id"]

    moved = await put_value(client, user, second, preset_value(), key)
    removed = await client.delete(f"/api/lab-reports/{second}/values/{key}", headers=user.headers)

    assert moved.status_code == 404
    assert removed.status_code == 404


async def test_value_needs_an_existing_report(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()

    response = await put_value(client, user, str(uuid.uuid7()))

    assert response.status_code == 404
    assert response.json() == {"detail": "not_found"}


async def test_reports_come_newest_first_with_values_in_entry_order(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    older = await add_report(client, user, days_ago=40)
    newer = await add_report(client, user, days_ago=2)
    for preset, unit, value in (("hemoglobin", "g_l", 142), ("ferritin", "ng_ml", 24)):
        await put_value(client, user, newer, preset_value(preset, value, unit))

    listed = await reports(client, user)

    assert [item["id"] for item in listed] == [newer, older]
    assert [item["preset"] for item in listed[0]["values"]] == ["hemoglobin", "ferritin"]


async def test_reports_answer_not_modified_until_a_value_changes(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    report_id = await add_report(client, user)
    first = await client.get("/api/lab-reports", headers=user.headers)
    etag = first.headers["etag"]

    same = await client.get("/api/lab-reports", headers={**user.headers, "If-None-Match": etag})
    await put_value(client, user, report_id)
    changed = await client.get("/api/lab-reports", headers={**user.headers, "If-None-Match": etag})

    assert same.status_code == 304
    assert changed.status_code == 200
    assert changed.headers["etag"] != etag


async def test_reports_of_another_user_are_not_listed(
    client: AsyncClient, make_user: MakeUser
) -> None:
    owner, stranger = await make_user(), await make_user()
    report_id = await add_report(client, owner)
    await put_value(client, owner, report_id)

    assert await reports(client, stranger) == []
    assert (await analytes(client, stranger))["analytes"] == []


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(preset_value("glucose", 5.4, "g_l"), id="unit of another analyte"),
        pytest.param({**preset_value(), "unit": None}, id="preset without a unit"),
        pytest.param(preset_value(value=2000), id="out of range"),
        pytest.param(preset_value(ref_low=160, ref_high=120), id="reference upside down"),
        pytest.param(preset_value(value=-1), id="negative"),
        pytest.param(preset_value(ref_low=-1), id="negative reference"),
        pytest.param({**preset_value(), "analyte_id": str(uuid.uuid7())}, id="both analytes"),
        pytest.param({"value": 1}, id="no analyte"),
        pytest.param(preset_value(value=1.00001), id="too precise"),
    ],
)
async def test_implausible_value_is_rejected(
    client: AsyncClient, make_user: MakeUser, body: dict[str, Any]
) -> None:
    user = await make_user()
    report_id = await add_report(client, user)

    response = await put_value(client, user, report_id, body)

    assert response.status_code == 422
    assert [item["values"] for item in await reports(client, user)] == [[]]


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(report(days_ago=-3), id="future"),
        pytest.param(report(local_date="1899-12-31"), id="too old"),
        pytest.param(report(lab="x" * 81), id="lab too long"),
        pytest.param(report(note="x" * 501), id="note too long"),
    ],
)
async def test_implausible_report_is_rejected(
    client: AsyncClient, make_user: MakeUser, body: dict[str, Any]
) -> None:
    user = await make_user()

    response = await put_report(client, user, body)

    assert response.status_code == 422
    assert await reports(client, user) == []


@pytest.mark.parametrize(
    ("name", "unit"),
    [("", "МЕ/мл"), ("x" * 61, "МЕ/мл"), ("АТ-ТПО", ""), ("АТ-ТПО", "x" * 21)],
)
async def test_implausible_own_analyte_is_rejected(
    client: AsyncClient, make_user: MakeUser, name: str, unit: str
) -> None:
    user = await make_user()

    response = await put_analyte(client, user, name, unit)

    assert response.status_code == 422
    assert (await analytes(client, user))["analytes"] == []
