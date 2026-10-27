"""Correct the numbers of members already imported from the old register: python scripts/legacy_renumber.py MstMember.xlsx [--dry].
The membership number is CusNo, the old number is CusNoOld, CusNoNew is not used (the first import had CusNo as the old number).
Fixes the members, their membership rows, the payer number on the import's receipts and moves the membership number counter past
the highest number. All or nothing; refuses to run twice."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import legacy_import  # noqa: E402

rows = legacy_import.read_register(Path(sys.argv[1]).read_bytes())
db = SessionLocal()
try:
    if "--dry" in sys.argv:
        from models.members import Member
        base = db.query(Member).filter(Member.registration_source == "MIGRATION", Member.is_deleted == False)  # noqa: E712
        print({"imported members": base.count(), "without a membership number": base.filter(Member.membership_number == None).count(),  # noqa: E711
               "rows in the file": len(rows)})
    else:
        print(legacy_import.renumber_imported(db, rows))
finally:
    db.close()
