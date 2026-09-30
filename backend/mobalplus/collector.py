"""Collecte incrémentale : récupère pour chaque capteur actif les mesures depuis la dernière reçue."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

import psycopg

from .db import SOURCE_COLLECTOR, ensure_channels, insert_readings, refresh_aggregates
from .ma_client import MAClient
from .timeutil import UTC

log = logging.getLogger(__name__)

# Le site ne conserve qu'environ 3 mois d'historique
MAX_BACKFILL = timedelta(days=90)


def collect(conn: psycopg.Connection, client: MAClient, only: list[str] | None = None,
            now: datetime | None = None, refresh: bool = True) -> dict[str, int]:
    now = now or datetime.now(UTC)
    devices = conn.execute(
        """SELECT d.id, d.ma_id, s.last_ts,
                  (SELECT max(r.ts) FROM reading r JOIN device_channel c ON c.id = r.channel_id
                    WHERE c.device_id = d.id) AS max_ts
           FROM device d LEFT JOIN device_sync s ON s.device_id = d.id
           WHERE d.active ORDER BY d.ma_id"""
    ).fetchall()

    summary = {}
    for device_id, ma_id, last_ts, max_ts in devices:
        if only and ma_id not in only:
            continue
        since = max(t for t in (last_ts, max_ts, now - MAX_BACKFILL) if t is not None)
        try:
            result = client.fetch_since(ma_id, since, now)
            nb = 0
            if result.rows:
                width = max(len(v) for _, v in result.rows)
                channel_ids = ensure_channels(conn, device_id, range(1, width + 1), result.headers)
                nb = insert_readings(conn, (
                    (channel_ids[i + 1], ts, value)
                    for ts, values in result.rows
                    for i, value in enumerate(values) if value is not None
                ), SOURCE_COLLECTOR)
            new_last = result.rows[-1][0] if result.rows else since
            _save_sync(conn, device_id, new_last, now, "OK" if result.rows else "NO_DATA",
                       f"{len(result.rows)} mesures reçues, {nb} valeurs insérées", nb)
            if result.device_name:
                conn.execute("UPDATE device SET ma_name = %s WHERE id = %s", (result.device_name, device_id))
            conn.commit()
            summary[ma_id] = nb
            log.info("%s : %d mesures, %d valeurs insérées", ma_id, len(result.rows), nb)
        except Exception as exc:  # un capteur en erreur ne bloque pas les autres
            conn.rollback()
            _save_sync(conn, device_id, last_ts, now, "ERROR", str(exc)[:500], 0)
            conn.commit()
            summary[ma_id] = -1
            log.error("%s : erreur %s", ma_id, exc)

    if refresh:
        refresh_aggregates(conn)
    return summary


def _save_sync(conn, device_id, last_ts, run, status, message, nb):
    conn.execute(
        """INSERT INTO device_sync (device_id, last_ts, last_run, status, message, nb_imported)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (device_id) DO UPDATE SET
             last_ts = COALESCE(EXCLUDED.last_ts, device_sync.last_ts), last_run = EXCLUDED.last_run,
             status = EXCLUDED.status, message = EXCLUDED.message, nb_imported = EXCLUDED.nb_imported""",
        (device_id, last_ts, run, status, message, nb),
    )
