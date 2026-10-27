"""Put the Kannada names of the Unicode register on members already imported:
python scripts/legacy_backfill_kannada.py MstMember_Kannada_Unicode.xlsx. Safe to repeat."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import legacy_import  # noqa: E402

rows = legacy_import.read_register(Path(sys.argv[1]).read_bytes())
db = SessionLocal()
try:
    print(legacy_import.backfill_kannada(db, rows))
finally:
    db.close()
