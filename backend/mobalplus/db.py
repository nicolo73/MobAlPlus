"""Accès base de données (psycopg 3)."""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Iterable

import psycopg

from .ma_parser import guess_property

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "db" / "schema.sql"

SOURCE_COLLECTOR = 0
SOURCE_SHEET = 1


def connect(url: str | None = None) -> psycopg.Connection:
    url = url or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL n'est pas défini (voir .env.example)")
    return psycopg.connect(url)


def apply_schema(conn: psycopg.Connection, path: Path = SCHEMA_PATH) -> None:
    conn.execute(path.read_text(encoding="utf-8"))
    conn.commit()


def property_id(conn: psycopg.Connection, code: str) -> int:
    row = conn.execute("SELECT id FROM observed_property WHERE code = %s", (code,)).fetchone()
    if row is None:
        raise ValueError(f"Grandeur inconnue : {code}")
    return row[0]


def ensure_device(conn: psycopg.Connection, ma_id: str, name: str | None = None,
                  ma_name: str | None = None) -> int:
    row = conn.execute(
        """INSERT INTO device (ma_id, name, ma_name) VALUES (%s, %s, %s)
           ON CONFLICT (ma_id) DO UPDATE
             SET ma_name = COALESCE(EXCLUDED.ma_name, device.ma_name),
                 name = COALESCE(device.name, EXCLUDED.name)
           RETURNING id""",
        (ma_id.upper(), name, ma_name),
    ).fetchone()
    return row[0]


def ensure_channels(conn: psycopg.Connection, device_id: int, channel_nos: Iterable[int],
                    labels: list[str]) -> dict[int, int]:
    """Crée les canaux manquants ; renvoie {n° de canal : id}. labels[i] = libellé de la colonne i+1."""
    result = {}
    for no in channel_nos:
        label = labels[no - 1] if 0 < no <= len(labels) else None
        prop = property_id(conn, guess_property(label))
        row = conn.execute(
            """INSERT INTO device_channel (device_id, channel_no, property_id, label)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (device_id, channel_no) DO UPDATE
                 SET label = COALESCE(device_channel.label, EXCLUDED.label)
               RETURNING id""",
            (device_id, no, prop, label),
        ).fetchone()
        result[no] = row[0]
    return result


def insert_readings(conn: psycopg.Connection,
                    rows: Iterable[tuple[int, datetime, float]], source: int) -> int:
    """Insère (channel_id, ts, value) en masse ; les doublons existants sont ignorés."""
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS reading_stage "
                 "(channel_id int, ts timestamptz, value real) ON COMMIT DELETE ROWS")
    with conn.cursor() as cur:
        with cur.copy("COPY reading_stage (channel_id, ts, value) FROM STDIN") as copy:
            for row in rows:
                copy.write_row(row)
        cur.execute(
            """INSERT INTO reading (channel_id, ts, value, source)
               SELECT DISTINCT ON (channel_id, ts) channel_id, ts, value, %s FROM reading_stage
               ON CONFLICT (channel_id, ts) DO NOTHING""",
            (source,),
        )
        inserted = cur.rowcount
        cur.execute("TRUNCATE reading_stage")
    return inserted


def refresh_aggregates(conn: psycopg.Connection) -> None:
    populated = conn.execute(
        "SELECT ispopulated FROM pg_matviews WHERE matviewname = 'series_hourly'"
    ).fetchone()[0]
    conn.execute("REFRESH MATERIALIZED VIEW "
                 + ("CONCURRENTLY " if populated else "") + "series_hourly")
    conn.commit()
