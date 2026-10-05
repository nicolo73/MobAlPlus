"""Import de l'historique depuis les exports (.xlsx ou .csv) des Google Sheets d'origine.

Chaque onglet de mesures a la structure produite par le script Apps Script :

    ligne 1 : Device ID | from Date | to Date | columns | rowStart
    ligne 2 : 07XXXXXXXXXX | ... | ... | 1;2 | 130407
    ligne 3 : <nom du capteur> Mesures
    ...
    « Columns: » | libellé colonne 1 | libellé colonne 2 | ...   (tous les canaux du capteur)
    « Date »     | Temp-Salon | Hygro                           (en-tête des données)
    01/01/2025 00:06:15 | 20,1 | 55
    ...

La cellule « columns » indique quelles colonnes Mobile Alerts sont recopiées dans l'onglet :
c'est ce qui permet de rattacher chaque valeur au bon canal du capteur (ex. 3;4 = extérieur).
Les onglets qui ne suivent pas cette structure (Config...) sont ignorés.
"""

from __future__ import annotations

import csv
import html
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, Iterator

import psycopg

from .db import compact, ensure_channels, ensure_device, insert_readings
from .ma_parser import parse_value
from .timeutil import excel_serial_to_datetime, localize_ascending, parse_local_timestamp

log = logging.getLogger(__name__)

HEADER_SCAN_ROWS = 20


@dataclass
class SheetData:
    source: str
    ma_id: str
    device_name: str | None
    columns: list[int]          # n° de canal Mobile Alerts de chaque colonne de valeurs
    labels: list[str]           # libellés de tous les canaux du capteur
    rows: Iterator[tuple[datetime, list[float | None]]]  # heure locale naïve, valeurs


def _cell_str(v) -> str:
    return "" if v is None else str(v).strip()


def _to_datetime(v) -> datetime | None:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v
    if isinstance(v, (int, float)):
        return excel_serial_to_datetime(v)
    try:
        return parse_local_timestamp(str(v))
    except ValueError:
        return None


def _to_value(v) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    return parse_value(str(v))


def parse_columns(v, nb_values: int) -> list[int]:
    text = _cell_str(v)
    if text.endswith(".0"):
        text = text[:-2]
    try:
        cols = [int(float(c)) for c in text.replace(",", ";").split(";") if c.strip()]
    except ValueError:
        cols = []
    return cols or list(range(1, nb_values + 1))


def parse_sheet_rows(rows: Iterable[list], source: str) -> SheetData | None:
    """Analyse les lignes d'un onglet ; None si l'onglet n'est pas un onglet de mesures."""
    it = iter(rows)
    head: list[list] = []
    for row in it:
        head.append(list(row))
        if row and _cell_str(row[0]).lower() == "date":
            break
        if len(head) >= HEADER_SCAN_ROWS:
            return None
    else:
        return None

    if not head or _cell_str(head[0][0] if head[0] else "").lower() != "device id" or len(head) < 2:
        return None

    ma_id = _cell_str(head[1][0]).upper()
    device_name = _cell_str(head[2][0]) if len(head) > 2 and head[2] else None
    if device_name and device_name.endswith(" Mesures"):
        device_name = device_name[: -len(" Mesures")]
    labels: list[str] = []
    for row in head:
        if row and _cell_str(row[0]).lower().startswith("columns:"):
            labels = [html.unescape(_cell_str(c)) for c in row[1:] if _cell_str(c)]
    data_header = head[-1]
    nb_values = len([c for c in data_header[1:] if _cell_str(c)])
    columns_cell = head[0].index("columns") if "columns" in head[0] else 3
    columns = parse_columns(head[1][columns_cell] if len(head[1]) > columns_cell else None, nb_values)

    def data() -> Iterator[tuple[datetime, list[float | None]]]:
        for row in it:
            if not row:
                continue
            ts = _to_datetime(row[0])
            if ts is None:
                continue
            values = [_to_value(row[i + 1]) if i + 1 < len(row) else None for i in range(len(columns))]
            yield ts, values

    return SheetData(source, ma_id, device_name, columns, labels, data())


def iter_file_sheets(path: Path) -> Iterator[SheetData]:
    path = Path(path)
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        import openpyxl

        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        try:
            for ws in wb.worksheets:
                sheet = parse_sheet_rows(ws.iter_rows(values_only=True), f"{path.name}:{ws.title}")
                if sheet is None:
                    log.info("Onglet ignoré : %s", ws.title)
                    continue
                yield sheet
        finally:
            wb.close()
    elif path.suffix.lower() in (".csv", ".tsv"):
        with open(path, newline="", encoding="utf-8-sig") as f:
            sample = f.read(4096)
            f.seek(0)
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
            sheet = parse_sheet_rows(csv.reader(f, dialect), path.name)
            if sheet is not None:
                yield sheet
    else:
        raise ValueError(f"Format non géré : {path.suffix}")


def import_sheet(conn: psycopg.Connection, sheet: SheetData, batch: int = 20000) -> int:
    device_id = ensure_device(conn, sheet.ma_id, ma_name=sheet.device_name)
    channel_ids = ensure_channels(conn, device_id, sheet.columns, sheet.labels)

    naive_rows = list(sheet.rows)
    # L'ordre chronologique réel est celui des lignes : il sert à lever l'ambiguïté du changement d'heure
    utcs = localize_ascending(t for t, _ in naive_rows)

    def readings():
        for utc, (_, values) in zip(utcs, naive_rows):
            for col, value in zip(sheet.columns, values):
                if value is not None:
                    yield channel_ids[col], utc, value

    total = 0
    buf = []
    first: dict[int, datetime] = {}
    for r in readings():
        if r[0] not in first or r[1] < first[r[0]]:
            first[r[0]] = r[1]
        buf.append(r)
        if len(buf) >= batch:
            total += insert_readings(conn, buf)
            buf.clear()
    if buf:
        total += insert_readings(conn, buf)
    # Mesures plus anciennes que l'affectation du canal : on étend celle-ci vers le passé pour qu'elles
    # soient rattachées à l'emplacement (même règle que l'import depuis l'application)
    for ch, ts in first.items():
        conn.execute("SELECT extend_first_deployment(%s, %s)", (ch, ts))
    conn.commit()
    # Compactage immédiat des mesures anciennes : l'historique ne transite pas en entier par la table
    # détaillée, ce qui garde la base sous le quota pendant l'import
    moved = compact(conn)
    # Rend l'espace de la table détaillée réutilisable avant l'onglet suivant
    conn.autocommit = True
    try:
        conn.execute("VACUUM reading, reading_day")
    finally:
        conn.autocommit = False
    log.info("%s : %d lignes lues, %d valeurs insérées, %d compactées (capteur %s, canaux %s)",
             sheet.source, len(naive_rows), total, moved, sheet.ma_id, sheet.columns)
    return total
