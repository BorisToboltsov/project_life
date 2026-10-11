"""Штрихкод продукта (ADR 0009): один вид записи и проверка контрольной цифры.

В каталоге штрихкод лежит как EAN-8 (8 цифр) или EAN-13 (13 цифр). UPC-A из 12 цифр — тот
же EAN-13 без ведущего нуля: одну упаковку разные сканеры читают и так и так.
"""

EAN_8 = 8
UPC_A = 12
EAN_13 = 13


def _check_digit(body: str) -> int:
    """Контрольная цифра GS1: веса 3 и 1 чередуются от правого края."""
    weighted = sum(
        int(digit) * (3 if index % 2 == 0 else 1) for index, digit in enumerate(body[::-1])
    )
    return -weighted % 10


def normalize(text: str) -> str | None:
    """Штрихкод в том виде, в каком он лежит в каталоге; `None` — это не штрихкод товара."""
    code = "".join(text.split()).replace("-", "")
    if not (code.isascii() and code.isdigit()) or len(code) not in (EAN_8, UPC_A, EAN_13):
        return None
    if _check_digit(code[:-1]) != int(code[-1]):
        return None
    return f"0{code}" if len(code) == UPC_A else code
