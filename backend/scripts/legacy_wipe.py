"""Remove what the old-register import created (members MIGRATION, receipts OLD_REGISTER and what hangs on them), keeping everything else:
python scripts/legacy_wipe.py [--dry]. See services/legacy_wipe.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.engagements, models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import legacy_wipe  # noqa: E402

db = SessionLocal()
try:
    out = legacy_wipe.wipe(db, dry="--dry" in sys.argv)
    print("(dry run, nothing removed)" if "--dry" in sys.argv else "removed:")
    for k, v in sorted(out.items()):
        print(f"  {k}: {v}")
finally:
    db.close()
