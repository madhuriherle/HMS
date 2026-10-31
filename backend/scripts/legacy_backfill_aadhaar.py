"""Seed the Aadhaar number a register note holds into the member's Aadhaar box, and take it out of the note:
python scripts/legacy_backfill_aadhaar.py MstMember.xlsx. A member who already has a number keeps it. Safe to repeat."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import legacy_import  # noqa: E402

rows = legacy_import.read_register(Path(sys.argv[1]).read_bytes())
db = SessionLocal()
try:
    print(legacy_import.backfill_aadhaar(db, rows))
finally:
    db.close()
