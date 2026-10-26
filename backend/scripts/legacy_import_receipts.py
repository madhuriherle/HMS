"""Import the receipts of the old register (after its members): python scripts/legacy_import_receipts.py MstMember.xlsx [--user ID] [--limit N].
Lines with no date are ignored, as the office decided; wrong dates are left out. Safe to repeat: members who already have receipts from
this import are skipped. Prints the result, writes it to a json file and the reports to an Excel file."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402,F401  (registers every model, as the app does)
from db.session import SessionLocal  # noqa: E402
from models.users import User  # noqa: E402
from services import legacy_import  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("file")
ap.add_argument("--user", type=int)
ap.add_argument("--limit", type=int)
ap.add_argument("--out", default="legacy_receipts_result.json")
ap.add_argument("--xlsx", default="legacy_receipts_reports.xlsx")
a = ap.parse_args()

rows = legacy_import.read_register(Path(a.file).read_bytes())
if a.limit:
    rows = rows[: a.limit]
db = SessionLocal()
try:
    user_id = a.user or db.query(User.id).order_by(User.id).first()[0]
    result = legacy_import.import_receipts(db, rows, user_id, progress=lambda n, c: print(f"  {n} receipts handled, {c} created", flush=True))
finally:
    db.close()
plan = result.pop("plan")
Path(a.xlsx).write_bytes(legacy_import.reports_xlsx(plan))
print({k: v for k, v in result.items() if not k.endswith("_list")})
Path(a.out).write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
