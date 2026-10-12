from decimal import Decimal

import pytest

from app.metrics import (
    CANONICAL_UNIT,
    CATALOG,
    STARTING_PRESETS,
    MetricPreset,
    Quantity,
    Unit,
    limits,
    quantity_of,
    to_canonical,
)


@pytest.mark.parametrize(
    ("value", "unit", "expected"),
    [
        ("72.4", Unit.KG, "72.400"),
        ("165.4", Unit.LB, "75.024"),
        ("1", Unit.LB, "0.454"),
        ("86", Unit.CM, "86.000"),
        ("34.5", Unit.IN, "87.630"),
        ("18.5", Unit.PERCENT, "18.500"),
    ],
)
def test_values_are_converted_to_the_canonical_unit(value: str, unit: Unit, expected: str) -> None:
    assert to_canonical(Decimal(value), unit) == Decimal(expected)


def test_conversion_round_trips_to_what_the_user_typed() -> None:
    kilograms = to_canonical(Decimal("165.4"), Unit.LB)
    centimetres = to_canonical(Decimal("34.5"), Unit.IN)

    assert round(kilograms / Decimal("0.45359237"), 1) == Decimal("165.4")
    assert round(centimetres / Decimal("2.54"), 1) == Decimal("34.5")


def test_each_unit_measures_one_quantity() -> None:
    assert {unit: quantity_of(unit) for unit in Unit} == {
        Unit.KG: Quantity.MASS,
        Unit.LB: Quantity.MASS,
        Unit.CM: Quantity.LENGTH,
        Unit.IN: Quantity.LENGTH,
        Unit.PERCENT: Quantity.PERCENT,
    }


def test_every_quantity_has_a_canonical_unit_of_its_own() -> None:
    assert set(CANONICAL_UNIT) == set(Quantity)
    assert all(quantity_of(unit) == quantity for quantity, unit in CANONICAL_UNIT.items())


def test_catalog_describes_every_preset() -> None:
    assert set(CATALOG) == set(MetricPreset)
    assert CATALOG[MetricPreset.WEIGHT].quantity == Quantity.MASS
    assert CATALOG[MetricPreset.BODY_FAT].quantity == Quantity.PERCENT
    assert {
        metric_type.quantity
        for preset, metric_type in CATALOG.items()
        if preset not in (MetricPreset.WEIGHT, MetricPreset.BODY_FAT)
    } == {Quantity.LENGTH}
    assert all(metric_type.min_value < metric_type.max_value for metric_type in CATALOG.values())


def test_every_user_starts_with_the_four_metrics_of_the_first_versions() -> None:
    assert [preset.value for preset in STARTING_PRESETS] == ["weight", "neck", "waist", "hips"]


def test_preset_has_limits_of_its_own_and_an_own_metric_those_of_its_quantity() -> None:
    assert limits(MetricPreset.NECK, Quantity.LENGTH) == (Decimal(15), Decimal(80))
    assert limits(None, Quantity.LENGTH) == (Decimal("0.1"), Decimal(300))
    assert limits(None, Quantity.MASS) == (Decimal("0.1"), Decimal(500))
    assert limits(None, Quantity.PERCENT) == (Decimal("0.1"), Decimal(100))
