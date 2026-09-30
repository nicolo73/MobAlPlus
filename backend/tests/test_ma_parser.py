from datetime import datetime

from mobalplus.ma_parser import guess_property, parse_measurement_details, parse_value

# Structure reprise des marqueurs utilisés par le script d'origine
HTML = """
<html><body>
<h3>01-Salon Mesures</h3>
<table class="table table-striped">
  <thead><tr>
    <th class="timestamp">Horodatage</th>
    <th class="measurement">Temp&#233;rature int&#233;rieure</th>
    <th class="measurement">Hygrom&#233;trie int&#233;rieure</th>
    <th class="measurement">Temp&#233;rature ext&#233;rieure</th>
    <th class="measurement">Hygrom&#233;trie ext&#233;rieure</th>
  </tr></thead>
  <tbody>
    <tr><td class="timestamp">01/01/2025 00:13:09</td>
        <td class="measurement">20,0 C</td><td class="measurement">55%</td>
        <td class="measurement">-4,6 C</td><td class="measurement">94%</td></tr>
    <tr><td class="timestamp">01/01/2025 00:06:15</td>
        <td class="measurement">20,1 C</td><td class="measurement">55%</td>
        <td class="measurement">---</td><td class="measurement">94%</td></tr>
  </tbody>
</table>
</body></html>
"""


def test_parse_page():
    page = parse_measurement_details(HTML)
    assert page.device_name == "01-Salon Mesures"
    assert page.headers[0] == "Température intérieure"
    assert len(page.headers) == 4
    assert page.rows[0] == (datetime(2025, 1, 1, 0, 13, 9), [20.0, 55.0, -4.6, 94.0])
    assert page.rows[1][1] == [20.1, 55.0, None, 94.0]


def test_parse_page_without_table():
    page = parse_measurement_details("<html><h3>X</h3></html>")
    assert page.rows == [] and page.headers == []


def test_parse_value():
    assert parse_value("-19,3 C") == -19.3
    assert parse_value("63%") == 63.0
    assert parse_value("43530") is None
    assert parse_value("OFL") is None


def test_guess_property():
    assert guess_property("Température extérieure") == "temperature"
    assert guess_property("Hygrométrie intérieure") == "humidity"
    assert guess_property("Pluie") == "rain"
    assert guess_property(None) == "unknown"
