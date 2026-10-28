"""Replace the location masters with the government's directory: python scripts/location_replace.py KARNATAKA <folder> [KERALA <folder> ...] [--dry].
--dry plans everything and prints the report, then rolls back. Without it the change is saved (take a database backup first)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import location_replace  # noqa: E402

args = [a for a in sys.argv[1:] if a != "--dry"]
dry = "--dry" in sys.argv
db = SessionLocal()
try:
    for state, folder in zip(args[0::2], args[1::2]):
        report = location_replace.replace_state(db, state, location_replace.read_state_files(folder), 1, apply=not dry)
        print(f"\n=== {state} ({'dry run, nothing saved' if dry else 'saved'})")
        for k, v in report.items():
            print(f"{k}: {len(v)}" if len(v) > 8 else f"{k}: {v}")
        if len(report.get("old taluks with no new equivalent (left, inactive; the office decides)", [])):
            print("  ->", report["old taluks with no new equivalent (left, inactive; the office decides)"])
finally:
    db.close()
