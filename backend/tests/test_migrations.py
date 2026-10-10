"""Vérifications statiques des migrations (sans base de données).

Supabase active pg_safeupdate pour les requêtes de l'API : un UPDATE ou un DELETE sans WHERE y est
refusé (« UPDATE requires a WHERE clause »), même dans une fonction appelée par l'application. La
base de test locale n'a pas cette extension : on vérifie donc la dernière version de chaque fonction.
"""

import re
from pathlib import Path

MIGRATIONS = sorted((Path(__file__).parents[2] / "supabase" / "migrations").glob("*.sql"))
FUNC = re.compile(r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+)\s*\(.*?\$\$(.*?)\$\$", re.S | re.I)
WRITE = re.compile(r"\b(?:UPDATE\s+\w+(?:\s+\w+)?\s+SET|DELETE\s+FROM)\b[^;]*;", re.S | re.I)


def latest_functions() -> dict[str, tuple[str, str]]:
    out: dict[str, tuple[str, str]] = {}
    for path in MIGRATIONS:
        for m in FUNC.finditer(path.read_text(encoding="utf-8")):
            out[m.group(1).lower()] = (path.name, m.group(2))
    return out


def test_functions_have_where_on_update_and_delete():
    bad = []
    for name, (file, body) in latest_functions().items():
        for stmt in WRITE.finditer(body):
            if not re.search(r"\bWHERE\b", stmt.group(0), re.I):
                bad.append(f"{name} ({file}) : {' '.join(stmt.group(0).split())[:100]}")
    assert not bad, "UPDATE / DELETE sans WHERE (refusés par pg_safeupdate) :\n" + "\n".join(bad)


def test_detects_unsafe_statement():
    # Garde-fou du test lui-même : l'ancienne version d'import_stage_classify est bien repérée
    old = (MIGRATIONS[0].parent / "20261008000000_import_conflicts.sql").read_text(encoding="utf-8")
    body = next(m.group(2) for m in FUNC.finditer(old) if m.group(1) == "import_stage_classify")
    assert any(not re.search(r"\bWHERE\b", s.group(0), re.I) for s in WRITE.finditer(body))
