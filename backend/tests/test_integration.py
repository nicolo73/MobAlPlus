"""Tests de bout en bout sur une vraie base PostgreSQL.

Lancés seulement si TEST_DATABASE_URL est défini (la base est entièrement réinitialisée).
"""

import os
from datetime import datetime, timedelta, timezone

import openpyxl
import psycopg
import pytest

from mobalplus import db
from mobalplus.collector import collect
from mobalplus.config_loader import load_config
from mobalplus.ma_client import FetchResult
from mobalplus.sheet_import import import_sheet, iter_file_sheets

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL non défini")
UTC = timezone.utc

LABELS = ["Temp&#233;rature int&#233;rieure", "Hygrom&#233;trie int&#233;rieure",
          "Temp&#233;rature ext&#233;rieure", "Hygrom&#233;trie ext&#233;rieure"]

CONFIG = """
places:
  - {code: salon, name: Salon, exposure: indoor}
  - {code: exterieur, name: Extérieur, exposure: outdoor}
  - {code: garage, name: Garage, exposure: indoor}
  - {code: cave, name: Cave, exposure: indoor}
devices:
  - ma_id: 07AAAAAAAAAA
    channels:
      - {col: 1, property: temperature}
      - {col: 2, property: humidity}
      - {col: 3, property: temperature}
      - {col: 4, property: humidity}
  - ma_id: 03BBBBBBBBBB
    channels:
      - {col: 1, property: temperature}
      - {col: 2, property: humidity}
deployments:
  - {device: 07AAAAAAAAAA, channels: [1, 2], place: salon}
  - {device: 07AAAAAAAAAA, channels: [3, 4], place: exterieur}
  - {device: 03BBBBBBBBBB, channels: [1, 2], place: cave, to: 2025-01-02}
  - {device: 03BBBBBBBBBB, channels: [1, 2], place: garage, from: 2025-01-02}
"""


def make_sheet(ws, ma_id, columns, header, rows):
    ws.append(["Device ID", "from Date", "to Date", "columns", "rowStart"])
    ws.append([ma_id, "30/09/2026 13:15:26", "01/10/2026 13:38", columns, 130407])
    ws.append(["01-Salon Mesures"])
    ws.append(["Status", "Nb Measures", "Messages"])
    ws.append(["PROCESSING DATA", 0, "No new measures found"])
    ws.append(["Columns:", *LABELS])
    ws.append(["Date", *header])
    for r in rows:
        ws.append(list(r))


@pytest.fixture
def conn(tmp_path):
    with psycopg.connect(URL) as c:
        c.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        c.commit()
        db.apply_schema(c)
        cfg = tmp_path / "devices.yaml"
        cfg.write_text(CONFIG, encoding="utf-8")
        load_config(c, cfg)
        load_config(c, cfg)  # idempotent
        yield c


@pytest.fixture
def workbook(tmp_path):
    wb = openpyxl.Workbook()
    cfg = wb.active
    cfg.title = "Config"
    cfg.append(["WebSite", "https://measurements.mobile-alerts.eu/"])
    make_sheet(wb.create_sheet("01-Salon"), "07AAAAAAAAAA", "1;2", ["Temp-Salon", "Hygro"], [
        ("01/01/2025 00:06:15", "20,1", 55),
        ("01/01/2025 00:13:09", 20, 55),
    ])
    make_sheet(wb.create_sheet("01-Ext"), "07AAAAAAAAAA", "3;4", ["Temp-Ext", "Hygro"], [
        ("01/01/2025 00:06:15", "4,5", 94),
        ("01/01/2025 00:13:09", "4,6", 94),
    ])
    make_sheet(wb.create_sheet("03-Mobile"), "03BBBBBBBBBB", 1, ["Temp"], [
        (datetime(2025, 1, 1, 12, 0), 18.0),
        (datetime(2025, 1, 2, 12, 0), 12.0),
    ])
    path = tmp_path / "export.xlsx"
    wb.save(path)
    return path


def series_values(conn, place_code, prop):
    return conn.execute(
        """SELECT o.ts, o.value, o.quality FROM observation o
           JOIN series s ON s.id = o.series_id JOIN place p ON p.id = s.place_id
           JOIN observed_property op ON op.id = s.property_id
           WHERE p.code = %s AND op.code = %s ORDER BY o.ts""",
        (place_code, prop),
    ).fetchall()


def test_import_and_deployments(conn, workbook):
    sheets = list(iter_file_sheets(workbook))
    assert [s.columns for s in sheets] == [[1, 2], [3, 4], [1]]
    assert sheets[0].labels[0] == "Température intérieure"
    assert sum(import_sheet(conn, s) for s in sheets) == 10

    # Réimport : aucun doublon
    assert sum(import_sheet(conn, s) for s in iter_file_sheets(workbook)) == 0

    ext = series_values(conn, "exterieur", "temperature")
    assert [v for _, v, _ in ext] == [4.5, pytest.approx(4.6)]
    assert ext[0][0] == datetime(2024, 12, 31, 23, 6, 15, tzinfo=UTC)  # heure de Paris -> UTC

    # Le capteur 03 a été déplacé de la cave au garage le 02/01/2025 : chaque mesure reste à sa place
    assert [v for _, v, _ in series_values(conn, "cave", "temperature")] == [18.0]
    assert [v for _, v, _ in series_values(conn, "garage", "temperature")] == [12.0]


def test_series_single_source_constraint(conn):
    # Deux capteurs affectés à la même série au même moment : refusé par la base
    with pytest.raises(psycopg.errors.ExclusionViolation):
        conn.execute("""
            INSERT INTO deployment (channel_id, series_id, valid)
            SELECT c.id, s.id, tstzrange('2030-01-01', NULL)
            FROM device_channel c JOIN device d ON d.id = c.device_id, series s JOIN place p ON p.id = s.place_id
            WHERE d.ma_id = '03BBBBBBBBBB' AND c.channel_no = 1 AND p.code = 'salon'
              AND s.property_id = c.property_id""")
    conn.rollback()


def test_correction_and_aggregates(conn, workbook):
    for s in iter_file_sheets(workbook):
        import_sheet(conn, s)
    ch = conn.execute("""SELECT c.id FROM device_channel c JOIN device d ON d.id = c.device_id
                         WHERE d.ma_id = '07AAAAAAAAAA' AND c.channel_no = 3""").fetchone()[0]
    conn.execute("INSERT INTO correction (channel_id, ts_range, action, reason) "
                 "VALUES (%s, tstzrange('2024-12-31 23:06:15+00', '2024-12-31 23:06:15+00', '[]'), "
                 "'reject', 'test')", (ch,))
    conn.commit()
    ext = series_values(conn, "exterieur", "temperature")
    assert [q for _, _, q in ext] == ["rejected", "ok"]

    db.refresh_aggregates(conn)
    db.refresh_aggregates(conn)  # deuxième passage en CONCURRENTLY
    row = conn.execute("""SELECT h.vmin, h.n FROM series_hourly h JOIN series s ON s.id = h.series_id
                          JOIN place p ON p.id = s.place_id
                          WHERE p.code = 'exterieur' AND s.property_id = 1""").fetchone()
    assert row[1] == 1 and row[0] == pytest.approx(4.6)


class FakeClient:
    def __init__(self):
        self.calls = []

    def fetch_since(self, ma_id, since, until):
        self.calls.append((ma_id, since))
        if ma_id != "07AAAAAAAAAA":
            raise RuntimeError("site indisponible")
        return FetchResult("01-Salon Mesures", ["Température intérieure", "Hygrométrie intérieure",
                                                "Température extérieure", "Hygrométrie extérieure"],
                           [(until - timedelta(minutes=7), [21.0, 50.0, 10.0, 80.0])])


def test_collector(conn):
    now = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)
    client = FakeClient()
    summary = collect(conn, client, now=now)
    assert summary == {"03BBBBBBBBBB": -1, "07AAAAAAAAAA": 4}
    status = dict(conn.execute("SELECT d.ma_id, s.status FROM device_sync s "
                               "JOIN device d ON d.id = s.device_id").fetchall())
    assert status == {"03BBBBBBBBBB": "ERROR", "07AAAAAAAAAA": "OK"}

    # Deuxième passage : reprend après la dernière mesure reçue
    client.calls.clear()
    collect(conn, client, now=now + timedelta(minutes=10))
    assert dict(client.calls)["07AAAAAAAAAA"] == now - timedelta(minutes=7)
