"""Write every stored blood group in the short form (O+VE, A +VE -> O+, A+): python scripts/legacy_normalize_blood_group.py. Safe to repeat."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from core.blood_group import normalize_blood_group  # noqa: E402
from db.session import SessionLocal  # noqa: E402
from models.members import Member  # noqa: E402

db = SessionLocal()
try:
    changed = 0
    for m in db.query(Member).filter(Member.blood_group.isnot(None)).yield_per(2000):
        new = normalize_blood_group(m.blood_group)
        if new != m.blood_group:
            m.blood_group = new
            changed += 1
    db.commit()
    print({"changed": changed})
finally:
    db.close()
