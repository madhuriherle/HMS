"""Move the upgrade amounts that carry an Amrutha Mahotsava note from Donation > Patrika Nidhi to Donation > Amrutha Mahotsava Abhiyana:
python scripts/legacy_retag_amrutha.py MstMember.xlsx. Receipt totals do not change. Safe to repeat."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import legacy_import  # noqa: E402

rows = legacy_import.read_register(Path(sys.argv[1]).read_bytes())
db = SessionLocal()
try:
    print(legacy_import.retag_amrutha_receipts(db, rows, 1))
finally:
    db.close()
