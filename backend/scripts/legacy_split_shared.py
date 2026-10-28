"""Make the receipts of the members who share a register number again with the current rule: python scripts/legacy_split_shared.py MstMember.xlsx."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.engagements, models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import legacy_import  # noqa: E402

rows = legacy_import.read_register(Path(sys.argv[1]).read_bytes())
db = SessionLocal()
try:
    print(legacy_import.reimport_shared_members(db, rows, 1))
finally:
    db.close()
