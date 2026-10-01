"""Accès base de données (psycopg 3)."""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Iterable

import psycopg
from psycopg.types.json import Jsonb

from .ma_parser import guess_property

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"


def connect(url: str | None = None) -> psycopg.Connection:
    url = url or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL n'est pas défini (voir .env.example)")
    return psycopg.connect(url)


def apply_schema(conn: psycopg.Connection, directory: Path = MIGRATIONS_DIR) -> None:
    """Applique les migrations dans l'ordre (hors Supabase : base locale ou de test)."""
    for path in sorted(directory.glob("*.sql")):
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


def insert_readings(conn: psycopg.Connection, rows: Iterable[tuple[int, datetime, float]]) -> int:
    """Insère (channel_id, ts, value) en masse ; les doublons existants sont ignorés."""
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS reading_stage "
                 "(channel_id int, ts timestamptz, value real) ON COMMIT DELETE ROWS")
    with conn.cursor() as cur:
        with cur.copy("COPY reading_stage (channel_id, ts, value) FROM STDIN") as copy:
            for row in rows:
                copy.write_row(row)
        cur.execute(
            """INSERT INTO reading (channel_id, ts, value)
               SELECT DISTINCT ON (channel_id, ts) channel_id, ts, value FROM reading_stage
               ON CONFLICT (channel_id, ts) DO NOTHING"""
        )
        inserted = cur.rowcount
        cur.execute("TRUNCATE reading_stage")
    return inserted


def ingest(conn: psycopg.Connection, ma_id: str, device_name: str | None, headers: list[str],
           rows: list[tuple[datetime, list[float | None]]], run_at: datetime,
           synced_until: datetime | None = None) -> dict:
    """Même point d'entrée SQL que l'Edge Function du collecteur."""
    payload = [{"ts": ts.isoformat(), "v": values} for ts, values in rows]
    return conn.execute(
        "SELECT ingest_readings(%s, %s, %s, %s, %s, %s)",
        (ma_id, device_name, headers, Jsonb(payload), run_at, synced_until or run_at),
    ).fetchone()[0]


def compact(conn: psycopg.Connection) -> int:
    moved = conn.execute("SELECT compact_readings()").fetchone()[0]
    conn.commit()
    return moved


def run_maintenance(conn: psycopg.Connection) -> dict:
    result = conn.execute("SELECT run_maintenance()").fetchone()[0]
    conn.commit()
    return result
