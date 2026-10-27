"""Join the lines of one particular on the old register's receipts (Membership + upgrade amount, shared receipts):
python scripts/legacy_merge_lines.py. Receipt totals do not change. Safe to repeat."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import legacy_import  # noqa: E402

db = SessionLocal()
try:
    print(legacy_import.merge_same_particular_lines(db))
finally:
    db.close()
