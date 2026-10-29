"""Keep imported names whole for rows imported before the change: python scripts/legacy_backfill_names.py
The old register has only a full name, so it is stored in first_name_en with middle / last left empty. Safe to repeat."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import legacy_import  # noqa: E402

db = SessionLocal()
try:
    print(legacy_import.backfill_full_name(db))
finally:
    db.close()
