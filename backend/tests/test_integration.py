"""Tests de bout en bout sur une vraie base PostgreSQL (migrations supabase/migrations).

Lancés seulement si TEST_DATABASE_URL est défini (la base est entièrement réinitialisée).
"""

import os
import uuid
from datetime import datetime, timedelta, timezone

import openpyxl
import psycopg
import pytest

from psycopg.types.json import Jsonb

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
        c.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE;")
        c.commit()
        db.apply_schema(c)
        db.apply_schema(c)  # les migrations sont rejouables
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


def series_id(conn, place_code, prop):
    return conn.execute(
        """SELECT s.id FROM series s JOIN place p ON p.id = s.place_id
           JOIN observed_property op ON op.id = s.property_id WHERE p.code = %s AND op.code = %s""",
        (place_code, prop),
    ).fetchone()[0]


def observations(conn, place_code, prop, t0="2000-01-01", t1="2100-01-01"):
    return conn.execute(
        "SELECT ts, value, quality FROM series_observations(%s, %s, %s)",
        (series_id(conn, place_code, prop), t0, t1),
    ).fetchall()


def channel_id(conn, ma_id, no):
    return conn.execute("""SELECT c.id FROM device_channel c JOIN device d ON d.id = c.device_id
                           WHERE d.ma_id = %s AND c.channel_no = %s""", (ma_id, no)).fetchone()[0]


def total_values(conn):
    v = conn.execute("SELECT stats() -> 'values'").fetchone()[0]
    return v["recent"] + v["compacted"] + v["simplified"]


def test_import_compaction_and_deployments(conn, workbook):
    sheets = list(iter_file_sheets(workbook))
    assert [s.columns for s in sheets] == [[1, 2], [3, 4], [1]]
    assert sheets[0].labels[0] == "Température intérieure"
    assert sum(import_sheet(conn, s) for s in sheets) == 10

    # Données de 2025 : compactées dès l'import (plus anciennes que hot_days)
    assert conn.execute("SELECT count(*) FROM reading").fetchone()[0] == 0
    assert total_values(conn) == 10

    # Réimport : aucun doublon après fusion avec les jours déjà compactés
    for s in iter_file_sheets(workbook):
        import_sheet(conn, s)
    assert total_values(conn) == 10

    ext = observations(conn, "exterieur", "temperature")
    assert [v for _, v, _ in ext] == [4.5, pytest.approx(4.6)]
    assert ext[0][0] == datetime(2024, 12, 31, 23, 6, 15, tzinfo=UTC)  # heure de Paris -> UTC

    # Le capteur 03 a été déplacé de la cave au garage le 02/01/2025 : chaque mesure reste à sa place
    assert [v for _, v, _ in observations(conn, "cave", "temperature")] == [18.0]
    assert [v for _, v, _ in observations(conn, "garage", "temperature")] == [12.0]

    # La vue globale donne le même résultat
    n = conn.execute("SELECT count(*) FROM observation").fetchone()[0]
    assert n == 10


def test_series_single_source_constraint(conn):
    with pytest.raises(psycopg.errors.ExclusionViolation):
        conn.execute(
            "INSERT INTO deployment (channel_id, series_id, valid) VALUES (%s, %s, tstzrange('2030-01-01', NULL))",
            (channel_id(conn, "03BBBBBBBBBB", 1), series_id(conn, "salon", "temperature")))
    conn.rollback()


def test_correction(conn, workbook):
    for s in iter_file_sheets(workbook):
        import_sheet(conn, s)
    conn.execute("INSERT INTO correction (channel_id, ts_range, action, reason) "
                 "VALUES (%s, tstzrange('2024-12-31 23:06:15+00', '2024-12-31 23:06:15+00', '[]'), "
                 "'reject', 'test')", (channel_id(conn, "07AAAAAAAAAA", 3),))
    assert [q for _, _, q in observations(conn, "exterieur", "temperature")] == ["rejected", "ok"]


def test_series_data_downsampling_keeps_real_extremes(conn):
    ch = channel_id(conn, "07AAAAAAAAAA", 1)
    start = datetime(2026, 9, 1, tzinfo=UTC)
    values = [20 + (i % 50) / 10 for i in range(1000)]
    values[500] = 35.0  # pic isolé
    db.insert_readings(conn, [(ch, start + timedelta(minutes=7 * i), v) for i, v in enumerate(values)])
    conn.commit()
    sid = series_id(conn, "salon", "temperature")
    t1 = start + timedelta(minutes=7 * 1000)
    assert len(conn.execute("SELECT * FROM series_data(%s, %s, %s, 5000)", (sid, start, t1)).fetchall()) == 1000
    pts = conn.execute("SELECT ts, value FROM series_data(%s, %s, %s, 100)", (sid, start, t1)).fetchall()
    assert len(pts) <= 100
    assert (start + timedelta(minutes=7 * 500), 35.0) in pts  # le pic est conservé, à son heure exacte
    assert min(v for _, v in pts) == 20.0


def test_simplify_points(conn):
    # Droite parfaite : seuls les extrémités (et min / max) restent
    t, v = conn.execute("SELECT * FROM simplify_points(%s::int[], %s::real[], 0.2)",
                        (list(range(0, 1000, 100)), [float(i) for i in range(10)])).fetchone()
    assert t == [0, 900] and v == [0.0, 9.0]
    # Plateau avec crête et creux : les deux sont gardés, le bruit sous la tolérance disparaît
    vals = [20.0, 20.1, 20.0, 20.1, 23.0, 20.1, 20.0, 17.0, 20.0, 20.1]
    t, v = conn.execute("SELECT * FROM simplify_points(%s::int[], %s::real[], 0.2)",
                        (list(range(10)), vals)).fetchone()
    assert 23.0 in v and 17.0 in v and len(v) < len(vals)


def test_simplify_old_drops_rejected(conn):
    ch = channel_id(conn, "07AAAAAAAAAA", 1)
    day = datetime(2020, 6, 1, tzinfo=UTC)
    vals = [20.0, 20.1, 20.0, 99.0, 20.1, 20.0]
    db.insert_readings(conn, [(ch, day + timedelta(minutes=7 * i), v) for i, v in enumerate(vals)])
    conn.execute("INSERT INTO correction (channel_id, ts_range, action) VALUES (%s, tstzrange(%s, %s, '[]'), 'reject')",
                 (ch, day + timedelta(minutes=21), day + timedelta(minutes=21)))
    conn.commit()
    result = db.run_maintenance(conn)
    assert result["compacted"] == 6
    assert result["simplified"]["days"] == 1
    t, v, simplified, n_raw = conn.execute(
        "SELECT t, v, simplified, n_raw FROM reading_day WHERE channel_id = %s", (ch,)).fetchone()
    assert simplified and n_raw == 6
    assert 99.0 not in v and len(v) < 6


class FakeClient:
    def __init__(self):
        self.calls = []

    def fetch_since(self, ma_id, since, until):
        self.calls.append((ma_id, since))
        if ma_id != "07AAAAAAAAAA":
            raise RuntimeError("site indisponible")
        return FetchResult("01-Salon Mesures", ["Température intérieure", "Hygrométrie intérieure",
                                                "Température extérieure", "Hygrométrie extérieure"],
                           [(until - timedelta(minutes=7), [21.0, 50.0, None, 80.0])])


def test_collector(conn):
    now = datetime.now(UTC).replace(microsecond=0)
    client = FakeClient()
    assert collect(conn, client, now=now) == {"03BBBBBBBBBB": -1, "07AAAAAAAAAA": 3}
    status = dict(conn.execute("SELECT d.ma_id, s.status FROM device_sync s "
                               "JOIN device d ON d.id = s.device_id").fetchall())
    assert status == {"03BBBBBBBBBB": "ERROR", "07AAAAAAAAAA": "OK"}
    assert conn.execute("SELECT ma_name FROM device WHERE ma_id = '07AAAAAAAAAA'").fetchone()[0] == "01-Salon Mesures"

    # Deuxième passage : reprend après la dernière mesure reçue
    client.calls.clear()
    collect(conn, client, now=now + timedelta(minutes=10))
    assert dict(client.calls)["07AAAAAAAAAA"] == now - timedelta(minutes=7)


def test_stats(conn, workbook):
    for s in iter_file_sheets(workbook):
        import_sheet(conn, s)
    st = conn.execute("SELECT stats()").fetchone()[0]
    assert st["counts"]["devices"] == 2 and st["counts"]["places"] == 4
    assert st["db_size_bytes"] > 0
    assert {d["ma_id"]: d["values"] for d in st["devices"]} == {"03BBBBBBBBBB": 2, "07AAAAAAAAAA": 8}


def grant_api_roles(conn):
    """Droits que Supabase accorde par défaut aux rôles de l'API (la RLS fait le reste)."""
    conn.execute("GRANT USAGE ON SCHEMA public, auth TO authenticated; "
                 "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated; "
                 "GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated")


def as_user(conn, uid, email="inconnu@exemple.fr"):
    conn.execute("RESET ROLE")
    conn.execute("SET ROLE authenticated")
    conn.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", ("" if uid is None else str(uid),))
    conn.execute("SELECT set_config('request.jwt.claims', %s, false)", (f'{{"email": "{email}"}}',))


def test_row_level_security(conn, workbook):
    for s in iter_file_sheets(workbook):
        import_sheet(conn, s)
    member, outsider = uuid.uuid4(), uuid.uuid4()
    home = conn.execute("SELECT default_home_id()").fetchone()[0]
    conn.execute("INSERT INTO home_member (home_id, email, user_id, role) VALUES (%s, 'membre@exemple.fr', %s, 'viewer')",
                 (home, member))
    conn.execute("INSERT INTO app_user (email, role) VALUES ('Admin@Exemple.fr', 'admin')")
    grant_api_roles(conn)
    conn.commit()
    try:
        as_user(conn, outsider)
        assert conn.execute("SELECT count(*) FROM reading_day").fetchone()[0] == 0
        assert conn.execute("SELECT my_context() -> 'homes'").fetchone()[0] == []
        # Compte sans aucun droit : les fonctions d'administration refusent (is_admin() jamais NULL)
        assert conn.execute("SELECT is_admin()").fetchone()[0] is False
        for fn in ("admin_stats", "admin_run_maintenance"):
            with pytest.raises(psycopg.errors.RaiseException):
                conn.execute(f"SELECT {fn}()")
            conn.rollback()
            as_user(conn, outsider)
        as_user(conn, member, "membre@exemple.fr")
        assert conn.execute("SELECT count(*) FROM reading_day").fetchone()[0] > 0
        ctx = conn.execute("SELECT my_context()").fetchone()[0]
        assert ctx["platform_admin"] is False and [h["role"] for h in ctx["homes"]] == ["viewer"]
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("INSERT INTO place (code, name) VALUES ('x', 'x')")
        conn.rollback()
        as_user(conn, member, "membre@exemple.fr")
        with pytest.raises(psycopg.errors.RaiseException):
            conn.execute("SELECT admin_stats()")
        conn.rollback()
        # Administrateur de la plateforme, reconnu par son e-mail (compte recréé, ou connexion Google)
        as_user(conn, uuid.uuid4(), "admin@exemple.fr")
        assert conn.execute("SELECT my_role()").fetchone()[0] == "admin"
        assert conn.execute("SELECT admin_stats() -> 'counts' ->> 'devices'").fetchone()[0] == "2"
        conn.execute("INSERT INTO place (code, name) VALUES ('x', 'x')")
        # Sans session : aucun rôle, même avec un e-mail connu
        as_user(conn, None, "admin@exemple.fr")
        assert conn.execute("SELECT my_role()").fetchone()[0] is None
        assert conn.execute("SELECT count(*) FROM place").fetchone()[0] == 0
    finally:
        conn.rollback()
        conn.execute("RESET ROLE")


def test_homes_isolation_and_sharing(conn, workbook):
    for s in iter_file_sheets(workbook):
        import_sheet(conn, s)
    home1 = conn.execute("SELECT default_home_id()").fetchone()[0]
    home2 = conn.execute("INSERT INTO home (name) VALUES ('Chalet') RETURNING id").fetchone()[0]
    conn.execute("INSERT INTO place (home_id, code, name) VALUES (%s, 'sejour', 'Séjour')", (home2,))
    owner, friend, owner2 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    conn.execute("INSERT INTO home_member (home_id, email, user_id, role) VALUES (%s, 'moi@ex.fr', %s, 'owner'), "
                 "(%s, 'voisin@ex.fr', %s, 'owner')", (home1, owner, home2, owner2))
    grant_api_roles(conn)
    conn.commit()
    try:
        # Le propriétaire de la maison 1 ne voit pas la maison 2
        as_user(conn, owner, "moi@ex.fr")
        assert [r[0] for r in conn.execute("SELECT name FROM home").fetchall()] == ["Ma maison"]
        assert "Séjour" not in [r[0] for r in conn.execute("SELECT name FROM place").fetchall()]
        n_values = conn.execute("SELECT count(*) FROM reading_day").fetchone()[0]
        assert n_values > 0
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("INSERT INTO place (home_id, code, name) VALUES (%s, 'y', 'y')", (home2,))
        conn.rollback()

        # Il invite un ami en lecture, par e-mail, avant sa première connexion
        as_user(conn, owner, "moi@ex.fr")
        conn.execute("INSERT INTO home_member (home_id, email, role) VALUES (%s, 'ami@ex.fr', 'viewer')", (home1,))
        conn.commit()
        as_user(conn, friend, "ami@ex.fr")
        assert conn.execute("SELECT claim_invitations()").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM reading_day").fetchone()[0] == n_values
        assert conn.execute("SELECT count(*) FROM current_values(%s)", (home1,)).fetchone()[0] > 0
        # Un lecteur ne voit pas la liste des membres (seulement sa propre invitation) et ne modifie rien
        assert [r[0] for r in conn.execute("SELECT email FROM home_member").fetchall()] == ["ami@ex.fr"]
        assert conn.execute("UPDATE place SET name = 'piraté' RETURNING id").fetchall() == []
        assert conn.execute("SELECT can_collect(ARRAY['07AAAAAAAAAA'])").fetchone()[0] is False
        conn.rollback()

        # Promu éditeur : il peut gérer les emplacements et déclencher la collecte, pas le partage
        as_user(conn, owner, "moi@ex.fr")
        conn.execute("UPDATE home_member SET role = 'editor' WHERE email = 'ami@ex.fr'")
        conn.commit()
        as_user(conn, friend, "ami@ex.fr")
        conn.execute("INSERT INTO place (home_id, code, name) VALUES (%s, 'grenier', 'Grenier')", (home1,))
        assert conn.execute("SELECT can_collect(ARRAY['07AAAAAAAAAA'])").fetchone()[0] is True
        assert conn.execute("SELECT can_collect(ARRAY['07AAAAAAAAAA', 'FFFFFFFFFFFF'])").fetchone()[0] is False
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("INSERT INTO home_member (home_id, email, role) VALUES (%s, 'x@ex.fr', 'owner')", (home1,))
        conn.rollback()
    finally:
        conn.rollback()
        conn.execute("RESET ROLE")

    # Un capteur de la maison 1 ne peut pas alimenter un emplacement de la maison 2
    ch = channel_id(conn, "07AAAAAAAAAA", 1)
    sejour = conn.execute("SELECT id FROM place WHERE code = 'sejour'").fetchone()[0]
    with pytest.raises(psycopg.errors.RaiseException):
        conn.execute("SELECT assign_channel(%s, %s, '2030-01-01')", (ch, sejour))
    conn.rollback()


def test_collect_targets_skips_silent_periods(conn):
    now = datetime.now(UTC).replace(microsecond=0)
    old = now - timedelta(days=10)
    db.ingest(conn, "07AAAAAAAAAA", None, [], [(old, [20.0])], run_at=now, synced_until=now)
    conn.commit()
    targets = dict(conn.execute("SELECT ma_id, since FROM collect_targets()").fetchall())
    # Pas de mesure depuis 10 jours, mais la période a été interrogée : on ne la relit pas en entier
    assert targets["07AAAAAAAAAA"] == now - timedelta(hours=2)
    # Capteur jamais collecté : 90 jours en arrière au maximum
    assert now - targets["03BBBBBBBBBB"] >= timedelta(days=89)
    # Relecture forcée
    forced = dict(conn.execute("SELECT ma_id, since FROM collect_targets('3 days')").fetchall())
    assert abs((now - forced["07AAAAAAAAAA"]) - timedelta(days=3)) < timedelta(minutes=1)


def test_admin_assign_and_retire(conn):
    ch = channel_id(conn, "03BBBBBBBBBB", 1)
    garage = conn.execute("SELECT id FROM place WHERE code = 'garage'").fetchone()[0]
    salon = conn.execute("SELECT id FROM place WHERE code = 'salon'").fetchone()[0]
    db.insert_readings(conn, [(ch, datetime(2026, 1, 1, tzinfo=UTC), 15.0),
                              (ch, datetime(2026, 3, 1, tzinfo=UTC), 21.0)])

    # Déplacement du garage au salon le 01/02/2026 : la station, source actuelle du salon, est clôturée
    conn.execute("SELECT assign_channel(%s, %s, '2026-02-01')", (ch, salon))
    assert [v for _, v, _ in observations(conn, "garage", "temperature", "2026-01-01")] == [15.0]
    assert [v for _, v, _ in observations(conn, "salon", "temperature", "2026-01-01")] == [21.0]
    station = channel_id(conn, "07AAAAAAAAAA", 1)
    assert conn.execute("SELECT upper(valid) FROM deployment WHERE channel_id = %s", (station,)).fetchone()[0] \
        == datetime(2026, 2, 1, tzinfo=UTC)

    # Valeurs actuelles : le salon est désormais alimenté par le capteur 03
    cur = {(r[3], r[4]): (r[7], r[8]) for r in conn.execute("SELECT * FROM current_values()").fetchall()}
    assert cur[("Salon", "temperature")] == (21.0, "03BBBBBBBBBB")

    # Retrait : plus d'affectation ouverte, capteur inactif
    dev = conn.execute("SELECT id FROM device WHERE ma_id = '03BBBBBBBBBB'").fetchone()[0]
    conn.execute("SELECT retire_device(%s, '2026-04-01')", (dev,))
    assert conn.execute("SELECT active FROM device WHERE id = %s", (dev,)).fetchone()[0] is False
    assert conn.execute("""SELECT count(*) FROM deployment d JOIN device_channel c ON c.id = d.channel_id
                           WHERE c.device_id = %s AND upper_inf(d.valid)""", (dev,)).fetchone()[0] == 0
    assert [v for _, v, _ in observations(conn, "salon", "temperature", "2026-01-01")] == [21.0]


def test_series_data_multi_and_stats(conn):
    t0 = datetime(2026, 9, 1, tzinfo=UTC)
    ch_t, ch_h = channel_id(conn, "07AAAAAAAAAA", 1), channel_id(conn, "07AAAAAAAAAA", 2)
    temps = [20.0, 21.5, 19.0, 99.0, 20.5]
    db.insert_readings(conn, [(ch_t, t0 + timedelta(minutes=7 * i), v) for i, v in enumerate(temps)]
                       + [(ch_h, t0 + timedelta(minutes=7 * i), 50.0 + i) for i in range(5)])
    conn.execute("INSERT INTO correction (channel_id, ts_range, action) VALUES (%s, tstzrange(%s, %s, '[]'), 'reject')",
                 (ch_t, t0 + timedelta(minutes=21), t0 + timedelta(minutes=21)))
    conn.commit()
    st, sh = series_id(conn, "salon", "temperature"), series_id(conn, "salon", "humidity")
    rows = conn.execute("SELECT series_id, count(*) FROM series_data_multi(%s, %s, %s) GROUP BY 1 ORDER BY 1",
                        ([st, sh], t0, t0 + timedelta(hours=1))).fetchall()
    assert dict(rows) == {st: 5, sh: 5}
    n, vmin, tmin, vmax, tmax, vavg, first, last = conn.execute(
        "SELECT * FROM series_stats(%s, %s, %s)", (st, t0, t0 + timedelta(hours=1))).fetchone()
    assert (n, vmin, vmax) == (4, 19.0, 21.5)          # la valeur rejetée (99) est exclue
    assert tmin == t0 + timedelta(minutes=14) and tmax == t0 + timedelta(minutes=7)
    assert vavg == pytest.approx(20.25)
    # Période vide
    assert conn.execute("SELECT n, vmin FROM series_stats(%s, '2000-01-01', '2000-01-02')", (st,)).fetchone() == (0, None)


def test_policies_evaluated_once_per_query(conn):
    # Une règle « is_member() » nue est réévaluée à chaque ligne : délai dépassé sur Supabase
    quals = conn.execute("SELECT tablename, coalesce(qual, with_check) FROM pg_policies WHERE schemaname = 'public'").fetchall()
    assert quals and all(q == "true" or "SELECT" in q for _, q in quals), quals


def test_home_keeps_an_owner(conn):
    home = conn.execute("SELECT default_home_id()").fetchone()[0]
    conn.execute("INSERT INTO home_member (home_id, email, role) VALUES (%s, 'moi@ex.fr', 'owner'), (%s, 'ami@ex.fr', 'viewer')",
                 (home, home))
    conn.commit()
    with pytest.raises(psycopg.errors.RaiseException):
        conn.execute("UPDATE home_member SET role = 'viewer' WHERE email = 'moi@ex.fr'")
    conn.rollback()
    with pytest.raises(psycopg.errors.RaiseException):
        conn.execute("DELETE FROM home_member WHERE email = 'moi@ex.fr'")
    conn.rollback()
    conn.execute("DELETE FROM home_member WHERE email = 'ami@ex.fr'")
    # Supprimer la maison entière reste possible
    conn.execute("DELETE FROM home WHERE id = %s", (home,))
    conn.rollback()


def test_export_import_round_trip(conn):
    ch = channel_id(conn, "07AAAAAAAAAA", 1)
    sid = series_id(conn, "salon", "temperature")
    t0 = datetime(2026, 7, 1, 10, 0, tzinfo=UTC)
    db.insert_readings(conn, [(ch, t0 + timedelta(minutes=7 * i), 20.0 + i / 10) for i in range(5)])
    conn.execute("INSERT INTO correction (channel_id, ts_range, action) VALUES (%s, tstzrange(%s, %s, '[]'), 'reject')",
                 (ch, t0 + timedelta(minutes=7), t0 + timedelta(minutes=7)))
    conn.commit()
    csv = conn.execute("SELECT export_csv(%s, %s, %s)", ([sid], t0, t0 + timedelta(hours=1))).fetchone()[0]
    lines = csv.split("\n")
    assert lines[0] == "2026-07-01T12:00:00+02:00;Salon;temperature;20;°C;ok;07AAAAAAAAAA;1"
    assert lines[1].split(";")[5] == "rejected" and len(lines) == 5
    utc = conn.execute("SELECT export_csv(%s, %s, %s, 'UTC', ',', '.', 2)", ([sid], t0, t0 + timedelta(hours=1))).fetchone()[0]
    assert utc.split("\n") == ["2026-07-01T10:00:00Z,Salon,temperature,20,°C,ok,07AAAAAAAAAA,1",
                               "2026-07-01T10:07:00Z,Salon,temperature,20.1,°C,rejected,07AAAAAAAAAA,1"]

    # On efface puis on réimporte le fichier : mêmes valeurs, correction recréée
    conn.execute("DELETE FROM reading WHERE channel_id = %s", (ch,))
    conn.execute("DELETE FROM reading_day WHERE channel_id = %s", (ch,))
    conn.execute("DELETE FROM correction WHERE channel_id = %s", (ch,))
    rows = [{"s": sid, "t": l.split(";")[0], "v": float(l.split(";")[3].replace(",", ".")), "q": l.split(";")[5]}
            for l in lines]
    out = conn.execute("SELECT import_values('series', %s)", (Jsonb(rows),)).fetchone()[0]
    assert out == {"received": 5, "inserted": 5, "identical": 0, "conflicts": 0, "replaced": 0,
                   "skipped": 0, "extended": 0, "rejected": 1}
    assert conn.execute("SELECT export_csv(%s, %s, %s)", ([sid], t0, t0 + timedelta(hours=1))).fetchone()[0] == csv
    # Réimport : aucun doublon
    again = conn.execute("SELECT import_values('series', %s)", (Jsonb(rows),)).fetchone()[0]
    assert again["inserted"] == 0 and again["rejected"] == 0


def test_import_extends_first_deployment(conn):
    # Capteur affecté au garage depuis le 02/01/2025 : un historique de 2024 doit y être rattaché
    ch = channel_id(conn, "03BBBBBBBBBB", 1)
    garage = series_id(conn, "garage", "temperature")
    old = datetime(2024, 6, 1, 12, 0, tzinfo=UTC)
    out = conn.execute("SELECT import_values('series', %s)",
                       (Jsonb([{"s": garage, "t": old.isoformat(), "v": 18.5}]),)).fetchone()[0]
    # Avant la première affectation de la série « garage » : celle-ci n'est pas étendue au-delà de
    # l'affectation précédente du même capteur (cave)... ici la série garage n'a qu'une affectation,
    # mais son canal en avait une plus ancienne (cave) : le canal de la première affectation du garage
    # est celui du capteur 03, dont la première affectation (cave) commence à l'origine -> pas d'extension
    assert out["inserted"] == 1 and out["skipped"] == 0
    # Via l'ancien format (canal) : la mesure de 2024 tombe dans l'affectation « cave » (depuis l'origine)
    out = conn.execute("SELECT import_values('channel', %s)",
                       (Jsonb([{"c": ch, "t": "2024-06-02T12:00:00Z", "v": 17.0}]),)).fetchone()[0]
    assert out["inserted"] == 1
    assert [v for _, v, _ in observations(conn, "cave", "temperature", "2024-01-01", "2024-12-31")] == [18.5, 17.0]

    # Nouvelle station affectée aujourd'hui seulement : l'import de 2023 étend l'affectation vers le passé
    dev = conn.execute("INSERT INTO device (ma_id) VALUES ('03CCCCCCCCCC') RETURNING id").fetchone()[0]
    new_ch = conn.execute("INSERT INTO device_channel (device_id, channel_no, property_id) VALUES (%s, 1, 1) RETURNING id",
                          (dev,)).fetchone()[0]
    bureau = conn.execute("INSERT INTO place (code, name) VALUES ('bureau', 'Bureau') RETURNING id").fetchone()[0]
    conn.execute("SELECT assign_channel(%s, %s, now())", (new_ch, bureau))
    sb = series_id(conn, "bureau", "temperature")
    out = conn.execute("SELECT import_values('series', %s)",
                       (Jsonb([{"s": sb, "t": "2023-03-01T08:00:00+01:00", "v": 19.0}]),)).fetchone()[0]
    assert out["extended"] == 1 and out["inserted"] == 1
    assert [v for _, v, _ in observations(conn, "bureau", "temperature", "2023-01-01", "2024-01-01")] == [19.0]


def test_import_requires_editor(conn):
    sid = series_id(conn, "salon", "temperature")
    home = conn.execute("SELECT default_home_id()").fetchone()[0]
    viewer = uuid.uuid4()
    conn.execute("INSERT INTO home_member (home_id, email, user_id, role) VALUES (%s, 'lecteur@ex.fr', %s, 'viewer')",
                 (home, viewer))
    grant_api_roles(conn)
    conn.commit()
    try:
        as_user(conn, viewer, "lecteur@ex.fr")
        assert conn.execute("SELECT export_csv(%s, '2000-01-01', '2100-01-01', 'UTC', ';', ',', 1)", ([sid],)).fetchone()[0] == ""
        with pytest.raises(psycopg.errors.RaiseException):
            conn.execute("SELECT import_values('series', %s)", (Jsonb([{"s": sid, "t": "2026-01-01T00:00:00Z", "v": 1}]),))
        conn.rollback()
        # Un inconnu n'exporte rien
        as_user(conn, uuid.uuid4(), "x@ex.fr")
        assert conn.execute("SELECT export_csv(%s, '2000-01-01', '2100-01-01')", ([sid],)).fetchone()[0] == ""
    finally:
        conn.rollback()
        conn.execute("RESET ROLE")


def test_import_near_duplicates_and_conflicts(conn):
    ch = channel_id(conn, "07AAAAAAAAAA", 1)
    sid = series_id(conn, "salon", "temperature")
    recent = datetime.now(UTC).replace(microsecond=0) - timedelta(days=2)     # détail
    old = datetime(2026, 5, 1, 12, 0, 13, tzinfo=UTC)                           # historique compacté
    db.insert_readings(conn, [(ch, recent, 20.0), (ch, recent + timedelta(minutes=7), 21.0),
                              (ch, old, 15.0), (ch, old + timedelta(minutes=7), 16.0)])
    conn.commit()
    db.compact(conn)
    rows = [
        {"s": sid, "t": (recent + timedelta(seconds=47)).isoformat(), "v": 20.0},            # identique (arrondi)
        {"s": sid, "t": (recent + timedelta(minutes=7, seconds=-30)).isoformat(), "v": 22.5},  # conflit
        {"s": sid, "t": (old - timedelta(seconds=13)).isoformat(), "v": 15.5},                # conflit (compacté)
        {"s": sid, "t": (recent + timedelta(minutes=3, seconds=30)).isoformat(), "v": 20.5},  # nouvelle (hors marge)
    ]
    prev = conn.execute("SELECT import_preview('series', %s, 120)", (Jsonb(rows),)).fetchone()[0]
    g = prev["groups"][0]
    assert (g["new"], g["identical"], g["conflict"]) == (1, 1, 2)
    assert {s["ev"] for s in g["samples"]} == {21.0, 15.0}
    # L'aperçu n'a rien écrit
    assert conn.execute("SELECT count(*) FROM reading WHERE channel_id = %s", (ch,)).fetchone()[0] == 2

    keep = conn.execute("SELECT import_values('series', %s, 120, 'keep')", (Jsonb(rows),)).fetchone()[0]
    assert (keep["inserted"], keep["identical"], keep["conflicts"], keep["replaced"]) == (1, 1, 2, 0)
    vals = lambda: [v for _, v, _ in observations(conn, "salon", "temperature", "2026-01-01", "2100-01-01")]
    assert vals() == [15.0, 16.0, 20.0, 20.5, 21.0]

    rep = conn.execute("SELECT import_values('series', %s, 120, 'replace')", (Jsonb(rows),)).fetchone()[0]
    assert (rep["replaced"], rep["conflicts"]) == (2, 0)
    assert vals() == [15.5, 16.0, 20.0, 20.5, 22.5]
    log = conn.execute("SELECT details FROM maintenance_log WHERE task = 'import_replace'").fetchone()[0]
    assert log["removed"] == 2 and log["conflicts"] == 2

    # Fuseau suspect : le même fichier décalé d'une heure retrouve les mesures existantes
    shifted = [{"s": sid, "t": (recent + timedelta(hours=1)).isoformat(), "v": 20.0},
               {"s": sid, "t": (recent + timedelta(hours=1, minutes=3, seconds=30)).isoformat(), "v": 20.5}]
    prev = conn.execute("SELECT import_preview('series', %s, 120)", (Jsonb(shifted),)).fetchone()[0]
    assert prev["tz_sampled"] == 2 and prev["tz_shifted"] == 2


def test_place_order_and_tree(conn, workbook):
    conn.execute("INSERT INTO place (code, name) VALUES ('jardin', 'Jardin'), ('est', 'Est'), ('ouest', 'Ouest')")
    ids = dict(conn.execute("SELECT code, id FROM place WHERE code IN ('jardin', 'est', 'ouest')").fetchall())
    conn.execute("SELECT reorder_places(%s, %s)", (ids["jardin"], [ids["ouest"], ids["est"]]))
    rows = conn.execute("SELECT code, parent_id, sort_order FROM place WHERE parent_id = %s ORDER BY sort_order",
                        (ids["jardin"],)).fetchall()
    assert rows == [("ouest", ids["jardin"], 1), ("est", ids["jardin"], 2)]
    conn.commit()
    # Pas de boucle : le parent ne peut pas entrer dans son propre sous-emplacement
    with pytest.raises(psycopg.errors.RaiseException):
        conn.execute("SELECT reorder_places(%s, %s)", (ids["est"], [ids["jardin"]]))
    conn.rollback()
    # Un compte en lecture ne peut pas réorganiser
    home = conn.execute("SELECT default_home_id()").fetchone()[0]
    viewer = uuid.uuid4()
    conn.execute("INSERT INTO home_member (home_id, email, user_id, role) VALUES (%s, 'lecteur@ex.fr', %s, 'viewer')",
                 (home, viewer))
    grant_api_roles(conn)
    conn.commit()
    try:
        as_user(conn, viewer, "lecteur@ex.fr")
        with pytest.raises(psycopg.errors.RaiseException):
            conn.execute("SELECT reorder_places(NULL, %s)", ([ids["est"]],))
    finally:
        conn.rollback()
        conn.execute("RESET ROLE")
