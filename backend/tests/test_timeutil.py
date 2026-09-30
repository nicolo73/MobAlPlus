from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from mobalplus.timeutil import localize_ascending, parse_local_timestamp, to_ma_epoch

PARIS = ZoneInfo("Europe/Paris")
UTC = timezone.utc


def test_parse_formats():
    assert parse_local_timestamp("01/01/2025 00:06:15") == datetime(2025, 1, 1, 0, 6, 15)
    assert parse_local_timestamp(" 30/09/2026  13:15 ") == datetime(2026, 9, 30, 13, 15)


def test_ma_epoch_is_local_wallclock_as_utc():
    # 27/07/2020 00:00 heure de Paris -> 1595808000 (valeur notée dans le script d'origine)
    dt = datetime(2020, 7, 27, 0, 0, tzinfo=PARIS)
    assert to_ma_epoch(dt, PARIS) == 1595808000


def test_localize_fall_back_duplicate_hour():
    # Passage à l'heure d'hiver le 26/10/2025 : 02:00-03:00 existe deux fois
    naive = [datetime(2025, 10, 26, 2, 40), datetime(2025, 10, 26, 2, 55),
             datetime(2025, 10, 26, 2, 5), datetime(2025, 10, 26, 2, 20),
             datetime(2025, 10, 26, 3, 5)]
    utc = list(localize_ascending(naive, PARIS))
    assert utc == [
        datetime(2025, 10, 26, 0, 40, tzinfo=UTC),
        datetime(2025, 10, 26, 0, 55, tzinfo=UTC),
        datetime(2025, 10, 26, 1, 5, tzinfo=UTC),
        datetime(2025, 10, 26, 1, 20, tzinfo=UTC),
        datetime(2025, 10, 26, 2, 5, tzinfo=UTC),
    ]
    assert utc == sorted(utc)
