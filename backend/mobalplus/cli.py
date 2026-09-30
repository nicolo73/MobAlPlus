"""Ligne de commande : python -m mobalplus <commande>."""

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

from . import db
from .collector import collect
from .config_loader import load_config
from .ma_client import MAClient
from .sheet_import import import_sheet, iter_file_sheets


def load_dotenv(path: Path = Path(".env")) -> None:
    """Charge un fichier .env simple (CLE=valeur) sans écraser l'environnement existant."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main(argv: list[str] | None = None) -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(prog="mobalplus")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init-db", help="crée ou met à jour le schéma")
    p = sub.add_parser("load-config", help="charge emplacements, capteurs et affectations")
    p.add_argument("file", type=Path)
    p = sub.add_parser("import-sheets", help="importe l'historique depuis des exports .xlsx / .csv")
    p.add_argument("files", type=Path, nargs="+")
    p = sub.add_parser("collect", help="collecte les nouvelles mesures sur le site Mobile Alerts")
    p.add_argument("--device", action="append", help="limiter à un capteur (ID Mobile Alerts)")
    sub.add_parser("refresh", help="recalcule les agrégats horaires")
    sub.add_parser("status", help="état de la collecte par capteur")

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")

    with db.connect() as conn:
        if args.cmd == "init-db":
            db.apply_schema(conn)
            print("Schéma appliqué.")
        elif args.cmd == "load-config":
            print(load_config(conn, args.file))
        elif args.cmd == "import-sheets":
            total = 0
            for f in args.files:
                for sheet in iter_file_sheets(f):
                    total += import_sheet(conn, sheet)
            db.refresh_aggregates(conn)
            print(f"{total} valeurs insérées.")
        elif args.cmd == "collect":
            vendor_id = os.environ.get("MA_VENDOR_ID")
            if not vendor_id:
                raise SystemExit("MA_VENDOR_ID n'est pas défini (voir .env.example)")
            print(collect(conn, MAClient(vendor_id), only=args.device))
        elif args.cmd == "refresh":
            db.refresh_aggregates(conn)
        elif args.cmd == "status":
            rows = conn.execute(
                """SELECT d.ma_id, coalesce(d.name, d.ma_name), s.last_ts, s.last_run, s.status, s.message
                   FROM device d LEFT JOIN device_sync s ON s.device_id = d.id ORDER BY d.ma_id"""
            ).fetchall()
            for r in rows:
                print(" | ".join("" if v is None else str(v) for v in r))


if __name__ == "__main__":
    main()
