"""Import the unapproved applications register (MstApplication.xlsx) and check it: python scripts/legacy_import_applicants.py MstApplication.xlsx
[--check-only] [--xlsx out.xlsx]. The applicants are UNAPPROVED members with no membership number (their CusNo is kept as the application
number) and their receipts are linked to them. The check lists, applicant by applicant and receipt by receipt, what is stored and what was
missed. Safe to repeat: an applicant already in is skipped."""
import argparse
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402,F401  (registers every model, as the app does)
from db.session import SessionLocal  # noqa: E402
from models.users import User  # noqa: E402
from services import legacy_import  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("file")
ap.add_argument("--check-only", action="store_true")
ap.add_argument("--xlsx", default="applicants_check.xlsx")
a = ap.parse_args()

rows = legacy_import.read_register(Path(a.file).read_bytes())
db = SessionLocal()
try:
    user_id = db.query(User.id).order_by(User.id).first()[0]
    if not a.check_only:
        m = legacy_import.import_members(db, rows, user_id, run_id=uuid.uuid4().hex, file_name=Path(a.file).name, applicants=True)
        print("applicants:", {k: v for k, v in m.items() if not k.endswith("_list")})
        r = legacy_import.import_receipts(db, rows, user_id, applicants=True)
        print("receipts:", {k: v for k, v in r.items() if k in ("created", "shared", "dummy", "zero_amount", "skipped", "ignored_undated", "not_imported_other")})
        for x in r.get("skipped_list", [])[:10]:
            print("  skipped receipt:", x)
    rec = legacy_import.reconcile_applicants(db, rows)
    print("check:", rec["counts"], "| same receipt as a member:", len(rec["same_receipt_as_member"]), "| already a member:", len(rec["already_member"]))
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Applicants"
    heads = {"Applicants": "applicants", "Receipts": "receipts", "Same receipt as a member": "same_receipt_as_member", "Already a member": "already_member"}
    for i, (title, key) in enumerate(heads.items()):
        sheet = ws if i == 0 else wb.create_sheet(title)
        data = rec[key]
        sheet.append(list(data[0].keys()) if data else ["(none)"])
        for d in data:
            sheet.append([str(v) if hasattr(v, "isoformat") else v for v in d.values()])
        for col in "ABCDEFGH":
            sheet.column_dimensions[col].width = 24
    wb.save(a.xlsx)
    print("written", a.xlsx)
finally:
    db.close()
