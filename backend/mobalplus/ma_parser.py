"""Analyse de la page HTML MeasurementDetails du site Mobile Alerts.

Repris de la logique du script Apps Script d'origine (marqueurs <h3>, table.table-striped,
th/td.timestamp et th/td.measurement), avec un vrai parseur HTML.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime

from bs4 import BeautifulSoup

from .timeutil import parse_local_timestamp

# Valeurs spéciales documentées par Mobile Alerts (capteur non connecté / hors plage)
SPECIAL_VALUES = {43530.0, 65295.0}

_NUMBER = re.compile(r"-?\d+(?:[.,]\d+)?")


@dataclass
class MAPage:
    device_name: str | None
    headers: list[str]
    # (heure locale naïve, valeurs par colonne) dans l'ordre de la page (plus récent en premier)
    rows: list[tuple[datetime, list[float | None]]] = field(default_factory=list)


def parse_value(text: str | None) -> float | None:
    if text is None:
        return None
    m = _NUMBER.search(text.replace("\xa0", " "))
    if not m:
        return None
    value = float(m.group(0).replace(",", "."))
    return None if value in SPECIAL_VALUES else value


def parse_measurement_details(html: str) -> MAPage:
    soup = BeautifulSoup(html, "html.parser")
    h3 = soup.find("h3")
    device_name = h3.get_text(strip=True) if h3 else None

    table = soup.find("table", class_="table-striped")
    if table is None:
        return MAPage(device_name, [], [])

    headers = [th.get_text(strip=True) for th in table.find_all("th", class_="measurement")]
    rows: list[tuple[datetime, list[float | None]]] = []
    for tr in table.find_all("tr"):
        ts_cell = tr.find("td", class_="timestamp")
        if ts_cell is None:
            continue
        values = [parse_value(td.get_text()) for td in tr.find_all("td", class_="measurement")]
        rows.append((parse_local_timestamp(ts_cell.get_text()), values))
    return MAPage(device_name, headers, rows)


def guess_property(label: str | None) -> str:
    """Devine la grandeur mesurée à partir du libellé de colonne Mobile Alerts."""
    if not label:
        return "unknown"
    text = unicodedata.normalize("NFD", label.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    if "temp" in text:
        return "temperature"
    if "hygro" in text or "humid" in text or "feucht" in text:
        return "humidity"
    if "pluie" in text or "rain" in text or "regen" in text:
        return "rain"
    return "unknown"
