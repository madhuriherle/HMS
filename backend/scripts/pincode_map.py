"""Point the pincodes at their villages and taluks: python scripts/pincode_map.py [--dry]. See services/pincode_map.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import pincode_map  # noqa: E402

db = SessionLocal()
try:
    out = pincode_map.map_pincodes(db, apply="--dry" not in sys.argv)
    review = out.pop("review")
    print({k: v for k, v in out.items()})
    print("left for the office (pincode, post office, villages of that name):", len(review), review[:25])
finally:
    db.close()
