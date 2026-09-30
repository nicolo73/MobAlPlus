"""Client HTTP pour le site measurements.mobile-alerts.eu."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta

import requests

from .ma_parser import MAPage, parse_measurement_details
from .timeutil import localize_ascending, to_ma_epoch

log = logging.getLogger(__name__)

BASE_URL = "https://measurements.mobile-alerts.eu/Home/MeasurementDetails"
APP_BUNDLE = "eu.mobile_alerts.mobilealerts"


@dataclass
class FetchResult:
    device_name: str | None
    headers: list[str]
    # (horodatage UTC, valeurs par colonne), ordre chronologique, sans doublon
    rows: list[tuple[datetime, list[float | None]]]


class MAClient:
    def __init__(self, vendor_id: str, session: requests.Session | None = None,
                 base_url: str = BASE_URL, pause: float = 1.0,
                 window: timedelta = timedelta(days=1), page_limit: int = 500):
        self.vendor_id = vendor_id
        self.session = session or requests.Session()
        self.base_url = base_url
        self.pause = pause          # délai entre deux appels, pour ménager le serveur
        self.window = window        # taille des fenêtres de requête
        self.page_limit = page_limit  # au-delà, on suppose une page tronquée et on découpe

    def fetch_page(self, device_id: str, start: datetime, end: datetime) -> MAPage:
        params = {
            "deviceid": device_id,
            "vendorid": self.vendor_id,
            "appbundle": APP_BUNDLE,
            "fromepoch": to_ma_epoch(start) + 1,  # +1 s : ne pas récupérer à nouveau la dernière mesure
            "toepoch": to_ma_epoch(end),
        }
        resp = self.session.get(self.base_url, params=params, timeout=30)
        resp.raise_for_status()
        if self.pause:
            time.sleep(self.pause)
        return parse_measurement_details(resp.text)

    def _fetch_window(self, device_id: str, start: datetime, end: datetime, pages: list[MAPage]):
        page = self.fetch_page(device_id, start, end)
        if len(page.rows) >= self.page_limit and end - start > timedelta(minutes=30):
            mid = start + (end - start) / 2
            log.debug("Page pleine (%d lignes), découpage de la fenêtre", len(page.rows))
            self._fetch_window(device_id, start, mid, pages)
            self._fetch_window(device_id, mid, end, pages)
        else:
            pages.append(page)

    def fetch_since(self, device_id: str, since: datetime, until: datetime) -> FetchResult:
        """Toutes les mesures de ]since, until], par fenêtres successives."""
        pages: list[MAPage] = []
        start = since
        while start < until:
            end = min(start + self.window, until)
            self._fetch_window(device_id, start, end, pages)
            start = end

        device_name = next((p.device_name for p in pages if p.device_name), None)
        headers = max((p.headers for p in pages), key=len, default=[])

        # Chaque page est la plus récente en premier : on remet dans l'ordre chronologique
        naive_rows = []
        for page in pages:
            naive_rows.extend(reversed(page.rows))
        utcs = list(localize_ascending(t for t, _ in naive_rows))

        seen = set()
        rows = []
        for utc, (_, values) in zip(utcs, naive_rows):
            if utc in seen or utc <= since:
                continue
            seen.add(utc)
            rows.append((utc, values))
        rows.sort(key=lambda r: r[0])
        return FetchResult(device_name, headers, rows)
