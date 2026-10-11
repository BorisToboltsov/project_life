from decimal import Decimal

from app.nutrition import Meal, Nutrients, total

OATMEAL = Nutrients(Decimal("352"), Decimal("12.3"), Decimal("6.2"), Decimal("61.8"))


def test_portion_scales_composition_per_100_grams() -> None:
    assert OATMEAL.portion(Decimal(60)) == Nutrients(
        Decimal("211.20"), Decimal("7.38"), Decimal("3.72"), Decimal("37.08")
    )


def test_portion_rounds_half_up_to_hundredths() -> None:
    per_100g = Nutrients(Decimal("33.3"), Decimal("0.05"), Decimal(0), Decimal(0))

    assert per_100g.portion(Decimal("15.5")) == Nutrients(
        Decimal("5.16"), Decimal("0.01"), Decimal("0.00"), Decimal("0.00")
    )


def test_total_adds_up_and_is_zero_for_nothing() -> None:
    assert total([]) == Nutrients()
    assert total([OATMEAL, OATMEAL]) == Nutrients(
        Decimal("704"), Decimal("24.6"), Decimal("12.4"), Decimal("123.6")
    )


def test_meals_go_in_the_order_of_the_day() -> None:
    assert list(Meal) == [Meal.BREAKFAST, Meal.LUNCH, Meal.DINNER, Meal.SNACK]
