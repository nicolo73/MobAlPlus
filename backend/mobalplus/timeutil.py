"""Gestion des heures locales du site Mobile Alerts.

Le site affiche des heures locales (sans fuseau) et attend des paramètres fromepoch / toepoch
exprimés comme « heure locale encodée comme si c'était de l'UTC ». Tout est stocké en UTC en base.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Iterable, Iterator
from zoneinfo import ZoneInfo

UTC = timezone.utc

TIMESTAMP_FORMATS = (
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%d.%m.%Y %H:%M:%S",
    "%d.%m.%Y %H:%M",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%m/%d/%Y %I:%M:%S %p",
)


def local_tz() -> ZoneInfo:
    return ZoneInfo(os.environ.get("MA_TIMEZONE", "Europe/Paris"))


def parse_local_timestamp(text: str) -> datetime:
    """Convertit « 01/01/2025 00:06:15 » en datetime naïf (heure locale)."""
    text = " ".join(text.split())
    for fmt in TIMESTAMP_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    raise ValueError(f"Format de date non reconnu : {text!r}")


def to_ma_epoch(dt: datetime, tz: ZoneInfo | None = None) -> int:
    """Epoch attendu par le site : heure locale lue comme de l'UTC."""
    tz = tz or local_tz()
    local = dt.astimezone(tz).replace(tzinfo=None)
    return int(local.replace(tzinfo=UTC).timestamp())


def localize_ascending(naive: Iterable[datetime], tz: ZoneInfo | None = None) -> Iterator[datetime]:
    """Convertit une suite d'heures locales, dans l'ordre chronologique réel, en UTC.

    Au passage à l'heure d'hiver, l'heure 02:00-03:00 existe deux fois : on choisit la seconde
    occurrence dès que la première ferait reculer le temps par rapport à la mesure précédente.
    """
    tz = tz or local_tz()
    prev: datetime | None = None
    for t in naive:
        first = t.replace(tzinfo=tz, fold=0).astimezone(UTC)
        second = t.replace(tzinfo=tz, fold=1).astimezone(UTC)
        utc = first
        if prev is not None and first <= prev < second:
            utc = second
        prev = utc
        yield utc


def local_midnight(d, tz: ZoneInfo | None = None) -> datetime:
    """Date (date ou datetime) -> datetime UTC correspondant à minuit local."""
    tz = tz or local_tz()
    if isinstance(d, datetime):
        if d.tzinfo is None:
            return d.replace(tzinfo=tz).astimezone(UTC)
        return d.astimezone(UTC)
    return datetime(d.year, d.month, d.day, tzinfo=tz).astimezone(UTC)


def excel_serial_to_datetime(serial: float) -> datetime:
    return datetime(1899, 12, 30) + timedelta(days=float(serial))
