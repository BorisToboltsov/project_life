import pytest

from app.barcodes import normalize


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("4006381333931", "4006381333931"),
        ("5901234123457", "5901234123457"),
        ("73513537", "73513537"),
        # UPC-A — EAN-13 без ведущего нуля.
        ("036000291452", "0036000291452"),
        ("0036000291452", "0036000291452"),
        ("  4006381 333931 ", "4006381333931"),
        ("4-006381-333931", "4006381333931"),
    ],
)
def test_product_barcode_is_brought_to_one_form(text: str, expected: str) -> None:
    assert normalize(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   ",
        # Одна цифра не та — контрольная не сходится.
        "4006381333932",
        "73513536",
        "036000291453",
        # Не та длина: 7, 9, 11 и 14 цифр.
        "7351353",
        "400638133",
        "03600029145",
        "04006381333931",
        "40063813339ab",
        # Цифры других письменностей — не штрихкод.
        "４００６３８１３３３９３１",
        "https://example.com/4006381333931",
    ],
)
def test_anything_else_is_not_a_barcode(text: str) -> None:
    assert normalize(text) is None
