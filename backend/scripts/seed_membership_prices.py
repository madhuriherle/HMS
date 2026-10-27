"""Set the membership prices of the Sabha: python scripts/seed_membership_prices.py [--dry].
Every price revision now on file is marked deleted (kept in the table, so it can be brought back), two clean rows are written for each
of the four types, and every other membership type is made inactive. Prices (Kannada notice):
  29-03-1943 to 31-12-1996: Ajeeva 200, Poshaka 500, Mahaposhaka 1000, Mahapalaka 5000
  from 01-01-1997:          Ajeeva 400, Poshaka 1000, Mahaposhaka 2000, Mahapalaka 10000"""
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from models.masters import MembershipType, MembershipTypePrice  # noqa: E402

PRICES = {   # type -> (price 1943-1996, price from 1997)
    "AJEEVA": (200, 400), "POSHAKA": (500, 1000), "MAHAPOSHAKA": (1000, 2000), "MAHAPALAKA": (5000, 10000),
}
FIRST, LAST_OLD, NEW = date(1943, 3, 29), date(1996, 12, 31), date(1997, 1, 1)
REASON_OLD, REASON_NEW = "Sabha notice: 29-03-1943 to 31-12-1996", "Sabha notice: from 01-01-1997"

db = SessionLocal()
try:
    now = datetime.now(timezone.utc)
    types = {t.name_en.strip().upper(): t for t in db.query(MembershipType).filter(MembershipType.is_deleted == False).all()}  # noqa: E712
    missing = [n for n in PRICES if n not in types]
    if missing:
        raise SystemExit(f"These types are not in the master: {missing}")
    gone = db.query(MembershipTypePrice).filter(MembershipTypePrice.is_deleted == False).all()  # noqa: E712
    for row in gone:
        row.is_deleted, row.deleted_at = True, now
    for name, (old, new) in PRICES.items():
        t = types[name]
        db.add(MembershipTypePrice(membership_type_id=t.id, amount=old, effective_from=FIRST, effective_to=LAST_OLD, change_reason=REASON_OLD, created_by=1))
        db.add(MembershipTypePrice(membership_type_id=t.id, amount=new, effective_from=NEW, effective_to=None, change_reason=REASON_NEW, created_by=1))
        t.status = True
    off = [n for n, t in types.items() if n not in PRICES and t.status]
    for n in off:
        types[n].status = False
    print(f"price revisions marked deleted: {len(gone)}; rows written: {2 * len(PRICES)}; types made inactive: {off}")
    if "--dry" in sys.argv:
        db.rollback()
        print("dry run: nothing saved")
    else:
        db.commit()
finally:
    db.close()
