"""Move guardian names into their own field for rows imported earlier: python scripts/legacy_backfill_guardian.py MstMember.xlsx.
CusRelation 'G' means guardian; the name belongs in guardian_name, not father_husband_name. Safe to repeat."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import legacy_import  # noqa: E402

rows = legacy_import.read_register(Path(sys.argv[1]).read_bytes())
db = SessionLocal()
try:
    print(legacy_import.backfill_guardian_names(db, rows))
finally:
    db.close()
