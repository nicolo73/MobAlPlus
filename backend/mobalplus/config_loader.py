"""Chargement du référentiel (emplacements, capteurs, canaux, affectations) depuis un fichier YAML.

Le chargement est idempotent : relancer le même fichier ne crée pas de doublons.
Voir config/devices.example.yaml pour le format.
"""

from __future__ import annotations

from pathlib import Path

import psycopg
import yaml

from .db import ensure_device, property_id
from .timeutil import local_midnight


def load_config(conn: psycopg.Connection, path: Path) -> dict[str, int]:
    cfg = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    stats = {"places": 0, "devices": 0, "channels": 0, "deployments": 0}

    place_ids: dict[str, int] = {}
    for p in cfg.get("places", []):
        parent = place_ids.get(p["parent"]) if p.get("parent") else None
        if p.get("parent") and parent is None:
            raise ValueError(f"Emplacement parent inconnu (déclarer le parent avant) : {p['parent']}")
        row = conn.execute(
            """INSERT INTO place (code, name, parent_id, kind, exposure, lon, lat)
               VALUES (%(code)s, %(name)s, %(parent)s, %(kind)s, %(exposure)s, %(lon)s, %(lat)s)
               ON CONFLICT (home_id, code) DO UPDATE SET
                 name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, kind = EXCLUDED.kind,
                 exposure = EXCLUDED.exposure, lon = EXCLUDED.lon, lat = EXCLUDED.lat
               RETURNING id""",
            {"code": p["code"], "name": p.get("name", p["code"]), "parent": parent,
             "kind": p.get("kind"), "exposure": p.get("exposure"),
             "lon": p.get("lon"), "lat": p.get("lat")},
        ).fetchone()
        place_ids[p["code"]] = row[0]
        stats["places"] += 1

    channel_ids: dict[tuple[str, int], tuple[int, int]] = {}  # (ma_id, n°) -> (channel_id, property_id)
    for d in cfg.get("devices", []):
        ma_id = str(d["ma_id"]).upper()
        device_id = ensure_device(conn, ma_id, d.get("name"))
        conn.execute("UPDATE device SET name = %s, model = %s, active = %s WHERE id = %s",
                     (d.get("name"), d.get("model"), d.get("active", True), device_id))
        stats["devices"] += 1
        for ch in d.get("channels", []):
            prop = property_id(conn, ch.get("property", "unknown"))
            row = conn.execute(
                """INSERT INTO device_channel (device_id, channel_no, property_id, label)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (device_id, channel_no) DO UPDATE
                     SET property_id = EXCLUDED.property_id,
                         label = COALESCE(EXCLUDED.label, device_channel.label)
                   RETURNING id""",
                (device_id, ch["col"], prop, ch.get("label")),
            ).fetchone()
            channel_ids[(ma_id, ch["col"])] = (row[0], prop)
            stats["channels"] += 1

    for dep in cfg.get("deployments", []):
        ma_id = str(dep["device"]).upper()
        place_code = dep["place"]
        if place_code not in place_ids:
            raise ValueError(f"Emplacement inconnu dans une affectation : {place_code}")
        for no in dep.get("channels", [dep.get("channel")]):
            if (ma_id, no) not in channel_ids:
                raise ValueError(f"Canal {no} du capteur {ma_id} non déclaré")
            channel_id, prop = channel_ids[(ma_id, no)]
            series_id = _ensure_series(conn, place_ids[place_code], prop)
            start = local_midnight(dep["from"]) if dep.get("from") else None
            end = local_midnight(dep["to"]) if dep.get("to") else None
            existing = conn.execute(
                """SELECT id FROM deployment
                   WHERE channel_id = %s AND lower(valid) IS NOT DISTINCT FROM %s""",
                (channel_id, start),
            ).fetchone()
            if existing:
                conn.execute(
                    "UPDATE deployment SET series_id = %s, valid = tstzrange(%s, %s, '[)'), note = %s "
                    "WHERE id = %s",
                    (series_id, start, end, dep.get("note"), existing[0]),
                )
            else:
                conn.execute(
                    "INSERT INTO deployment (channel_id, series_id, valid, note) "
                    "VALUES (%s, %s, tstzrange(%s, %s, '[)'), %s)",
                    (channel_id, series_id, start, end, dep.get("note")),
                )
            stats["deployments"] += 1

    conn.commit()
    return stats


def _ensure_series(conn: psycopg.Connection, place_id: int, prop: int) -> int:
    row = conn.execute(
        """INSERT INTO series (place_id, property_id, name)
           SELECT %s, %s, p.name || ' – ' || op.name
           FROM place p, observed_property op WHERE p.id = %s AND op.id = %s
           ON CONFLICT (place_id, property_id) DO UPDATE SET name = series.name
           RETURNING id""",
        (place_id, prop, place_id, prop),
    ).fetchone()
    return row[0]
