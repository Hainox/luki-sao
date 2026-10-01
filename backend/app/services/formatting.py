"""Форматирование чисел и номеров так, как их видит пользователь."""

from decimal import ROUND_HALF_UP, Decimal

CARD_PREFIX = "ОЛХ"


def card_label(number: int) -> str:
    # :03d, а не срез/rjust с обрезкой: после 999 номер просто становится
    # четырёхзначным (ОЛХ-1000), без переполнения.
    return f"{CARD_PREFIX}-{number:03d}"


def fixed_percent(accepted: int, detected: int) -> Decimal | None:
    if detected <= 0:
        return None
    value = Decimal(accepted) * 100 / Decimal(detected)
    return value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def percent_label(accepted: int, detected: int) -> str:
    """66,7% / 70% / — (прочерк, если нарушений не выявлено).

    Округление — половина вверх (как в Excel и «в школе»), а не банковское
    округление Python round(): 2/3 → 66,7%, 1/8 → 12,5%, 5/16 → 31,3%.
    """
    value = fixed_percent(accepted, detected)
    if value is None:
        return "—"
    text = f"{value:.1f}".replace(".", ",")
    if text.endswith(",0"):
        text = text[:-2]
    return f"{text}%"
