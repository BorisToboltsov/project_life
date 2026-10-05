from decimal import Decimal

import pytest

from app.metrics import CATALOG, Metric, Quantity, Unit, quantity_of, to_canonical


@pytest.mark.parametrize(
    ("value", "unit", "expected"),
    [
        ("72.4", Unit.KG, "72.400"),
        ("165.4", Unit.LB, "75.024"),
        ("1", Unit.LB, "0.454"),
        ("86", Unit.CM, "86.000"),
        ("34.5", Unit.IN, "87.630"),
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
    }


def test_catalog_describes_every_metric_in_its_canonical_unit() -> None:
    assert set(CATALOG) == set(Metric)
    assert CATALOG[Metric.WEIGHT].unit == Unit.KG
    assert {CATALOG[metric].unit for metric in (Metric.NECK, Metric.WAIST, Metric.HIPS)} == {
        Unit.CM
    }
    assert all(metric_type.min_value < metric_type.max_value for metric_type in CATALOG.values())
