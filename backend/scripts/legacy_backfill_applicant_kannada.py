"""Kannada names of the applicants in Unicode:
  python scripts/legacy_backfill_applicant_kannada.py MstApplication.xlsx MstMember.xlsx MstMember_Kannada_Unicode.xlsx [--xlsx left.xlsx]
  python scripts/legacy_backfill_applicant_kannada.py MstApplication.xlsx --words words.json [--xlsx left.xlsx]   (words already learned: {old: unicode})
  python scripts/legacy_backfill_applicant_kannada.py --learn MstMember.xlsx MstMember_Kannada_Unicode.xlsx words.json   (only learn the words)
The old-font words are learned from the members (whose names exist in both registers). A name whose words are all known is converted; the
others are cleared and listed. Safe to repeat."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402,F401  (registers every model, as the app does)
from db.session import SessionLocal  # noqa: E402
from services import legacy_import  # noqa: E402

if "--learn" in sys.argv:
    a = [x for x in sys.argv[1:] if x != "--learn"]
    words, conflicts = legacy_import.learn_kannada_words(*(legacy_import.read_register(Path(f).read_bytes()) for f in a[:2]))
    Path(a[2]).write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")
    print("words learned:", len(words), "| words with two spellings:", len(conflicts))
    sys.exit(0)
args = [a for a in sys.argv[1:] if not a.startswith("--")]
out_xlsx = sys.argv[sys.argv.index("--xlsx") + 1] if "--xlsx" in sys.argv else "applicants_kannada_left.xlsx"
words_json = sys.argv[sys.argv.index("--words") + 1] if "--words" in sys.argv else None
for skip in (out_xlsx, words_json):
    if skip in args:
        args.remove(skip)
app_rows = legacy_import.read_register(Path(args[0]).read_bytes())
if words_json:
    words, conflicts = json.loads(Path(words_json).read_text(encoding="utf-8")), {}
else:
    words, conflicts = legacy_import.learn_kannada_words(*(legacy_import.read_register(Path(f).read_bytes()) for f in args[1:3]))
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
