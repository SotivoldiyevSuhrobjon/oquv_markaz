import datetime as dt
import re

from django.core.exceptions import ValidationError
from django.utils import timezone

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def today() -> dt.date:
    """Bugungi sana (Asia/Tashkent). Testlarda shu funksiya almashtiriladi."""
    return timezone.localdate()


def now() -> dt.datetime:
    """Hozirgi vaqt (Asia/Tashkent). Testlarda almashtiriladi."""
    return timezone.localtime()


def validate_month(value: str) -> str:
    if not MONTH_RE.match(value or ""):
        raise ValidationError("Oy YYYY-MM ko'rinishida bo'lishi kerak")
    return value


def month_of(d: dt.date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def month_range(start: str, count: int) -> list[str]:
    y, m = map(int, start.split("-"))
    out = []
    for _ in range(count):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def client_ip(request) -> str | None:
    fwd = request.META.get("HTTP_X_FORWARDED_FOR")
    return (fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR")) or None
