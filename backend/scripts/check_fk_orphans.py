"""Preview rows that would be cleared by migration 20261012_0042 (read-only).

    python scripts/check_fk_orphans.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402

from core.config import settings  # noqa: E402

LINKS = [
    ("members", "state_id", "states"),
    ("members", "district_id", "districts"),
    ("members", "taluk_id", "taluks"),
    ("members", "pincode_id", "postal_codes"),
    ("members", "gotra_id", "gotras"),
    ("members", "qualification_id", "qualifications"),
    ("members", "native_place_id", "native_places"),
    ("users", "member_id", "members"),
]

engine = create_engine(str(settings.DATABASE_URL))
total = 0
with engine.connect() as c:
    for table, col, ref in LINKS:
        rows = c.execute(text(
            f"SELECT id, {col} FROM {table} WHERE {col} IS NOT NULL AND {col} NOT IN (SELECT id FROM {ref}) ORDER BY id"
        )).all()
        total += len(rows)
        print(f"{table}.{col} -> {ref}: {len(rows)} orphan(s)")
        for rid, val in rows[:20]:
            print(f"    {table}.id={rid}  {col}={val}")
        if len(rows) > 20:
            print(f"    ... and {len(rows) - 20} more")
print("\nNothing to clear." if not total else f"\n{total} value(s) would be set to NULL (copied to fk_orphan_backup first).")
