"""Fill the gender of members already imported from the old register: python scripts/legacy_backfill_gender.py
The register has no gender column, so it is read from the title (SRI. = male, SMT. / KUM. = female). Only empty
genders are written; an ambiguous title (DR., PROF., ...) stays blank. Safe to repeat."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import legacy_import  # noqa: E402

db = SessionLocal()
try:
    print(legacy_import.backfill_gender_from_title(db))
finally:
    db.close()
