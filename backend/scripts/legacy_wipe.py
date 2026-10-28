"""Remove what the old-register import created (members MIGRATION, receipts OLD_REGISTER and what hangs on them), keeping everything else:
python scripts/legacy_wipe.py [--dry]. With --others it removes the test data instead (everything that is not the import) and restarts the
member and receipt numbers. See services/legacy_wipe.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.engagements, models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from services import legacy_wipe  # noqa: E402

from sqlalchemy import text  # noqa: E402
from services import data_cleanup  # noqa: E402

others = "--others" in sys.argv        # remove the test data (everything that is not the import) instead of the import
db = SessionLocal()
try:
    files = []
    if others:     # photos and documents of the members that go
        cond = "registration_source IS DISTINCT FROM 'MIGRATION'"
        files = [p for (p,) in db.execute(text(f"SELECT photo_path FROM members WHERE {cond} AND photo_path IS NOT NULL"))]
        files += [p for (p,) in db.execute(text(f"SELECT file_path FROM member_documents WHERE member_id IN (SELECT id FROM members WHERE {cond}) AND file_path IS NOT NULL"))]
    out = legacy_wipe.wipe(db, dry="--dry" in sys.argv, others=others)
    if others and "--dry" not in sys.argv:
        from models.system import NumberSequence
        gone = db.query(NumberSequence).filter(NumberSequence.sequence_type.like("RECEIPT%") | NumberSequence.sequence_type.like("MEMBER_CODE%")).delete(synchronize_session=False)
        db.commit()
        print("number sequences restarted:", gone, "| files deleted:", data_cleanup._delete_files(files))
    print("(dry run, nothing removed)" if "--dry" in sys.argv else "removed:")
    for k, v in sorted(out.items()):
        print(f"  {k}: {v}")
finally:
    db.close()
