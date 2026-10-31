"""The made-up numbers the old-register import gave (FY64-001) get a 4-digit counter like the new ones (FY64-0001):
python scripts/legacy_pad_unknown_numbers.py. Only the number changes; the year, the order and the receipts stay. Safe to repeat."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import legacy_import  # noqa: E402

db = SessionLocal()
try:
    print(legacy_import.pad_unknown_numbers(db))
finally:
    db.close()
