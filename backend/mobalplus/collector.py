"""Collecte incrémentale depuis un poste (équivalent Python de l'Edge Function supabase/functions/collect).

Utile pour un rattrapage manuel ou en local ; en production, la collecte est faite par l'Edge Function.
Les deux passent par les mêmes fonctions SQL (collect_targets, ingest_readings).
"""

from __future__ import annotations

import logging
from datetime import datetime

import psycopg

from .db import ingest
from .ma_client import MAClient
from .timeutil import UTC

log = logging.getLogger(__name__)


def collect(conn: psycopg.Connection, client: MAClient, only: list[str] | None = None,
            now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(UTC)
    targets = conn.execute("SELECT ma_id, since FROM collect_targets()").fetchall()

    summary = {}
    for ma_id, since in targets:
        if only and ma_id not in only:
            continue
        try:
            result = client.fetch_since(ma_id, since, now)
            out = ingest(conn, ma_id, result.device_name, result.headers, result.rows, now)
            conn.commit()
            summary[ma_id] = out["inserted"]
            log.info("%s : %d mesures, %d valeurs insérées", ma_id, out["received"], out["inserted"])
        except Exception as exc:  # un capteur en erreur ne bloque pas les autres
            conn.rollback()
            conn.execute("SELECT record_sync_error(%s, %s, %s)", (ma_id, str(exc), now))
            conn.commit()
            summary[ma_id] = -1
            log.error("%s : erreur %s", ma_id, exc)
    return summary
