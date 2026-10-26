"""Dry run of the old register import: python scripts/legacy_dry_run.py MstMember.xlsx [out.xlsx]. Saves nothing."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db.session import SessionLocal  # noqa: E402
from services import legacy_import  # noqa: E402

rows = legacy_import.read_register(Path(sys.argv[1]).read_bytes())
db = SessionLocal()
try:
    plan = legacy_import.build_plan(db, rows)
finally:
    db.rollback()
    db.close()
for k, v in plan["counts"].items():
    print(f"{k:32} {v}")
if len(sys.argv) > 2:
    Path(sys.argv[2]).write_bytes(legacy_import.reports_xlsx(plan))
    print("reports written to", sys.argv[2])
