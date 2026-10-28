"""Kannada names of the applicants in Unicode: python scripts/legacy_backfill_applicant_kannada.py MstApplication.xlsx MstMember.xlsx MstMember_Kannada_Unicode.xlsx
[--xlsx left.xlsx]. The old-font words are learned from the members (whose names exist in both registers). A name whose words are all known
is converted; the others are cleared and listed. Safe to repeat."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402,F401  (registers every model, as the app does)
from db.session import SessionLocal  # noqa: E402
from services import legacy_import  # noqa: E402

args = [a for a in sys.argv[1:] if not a.startswith("--")]
out_xlsx = sys.argv[sys.argv.index("--xlsx") + 1] if "--xlsx" in sys.argv else "applicants_kannada_left.xlsx"
if out_xlsx in args:
    args.remove(out_xlsx)
app_rows, old_rows, uni_rows = (legacy_import.read_register(Path(f).read_bytes()) for f in args[:3])
words, conflicts = legacy_import.learn_kannada_words(old_rows, uni_rows)
print("words learned:", len(words), "| words with two spellings:", len(conflicts))
db = SessionLocal()
try:
    res = legacy_import.backfill_applicant_kannada(db, app_rows, words)
finally:
    db.close()
print({k: v for k, v in res.items() if k != "left"})
from openpyxl import Workbook
wb = Workbook()
ws = wb.active
ws.append(["application_no", "name", "unknown_old_font_words"])
for x in res["left"]:
    ws.append([x["application_no"], x["name"], " | ".join(x["unknown_words"])])
wb.save(out_xlsx)
print("written", out_xlsx)
