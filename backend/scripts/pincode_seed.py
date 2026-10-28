"""Rebuild the Karnataka and Kerala pincodes from the India Post directory CSV: python scripts/pincode_seed.py FILE.csv [--dry] [--report out.json].
See services/pincode_seed.py."""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from models.masters import District, Taluk  # noqa: E402
from services import pincode_seed  # noqa: E402

db = SessionLocal()
try:
    rows = pincode_seed.read_directory(sys.argv[1])
    out = pincode_seed.seed(db, rows, apply="--dry" not in sys.argv)
    tname = {i: n for i, n in db.query(Taluk.id, Taluk.name_en).all()}
    dname = {i: n for i, n in db.query(District.id, District.name_en).all()}
    print(out["stats"])
    print("districts not recognised:", out["bad_districts"])
    named = [(o["pincode"], o["name"], dname.get(o["district_id"]), tname.get(o["taluk_id"]), o["how"]) for o in out["rows"]]
    for pin in ("576221", "560083", "574212"):
        print(pin, [x for x in named if x[0] == pin])
    random.seed(11)
    print("sample:")
    for r in random.sample(named, 18):
        print("  ", r)
    if "--report" in sys.argv:
        Path(sys.argv[sys.argv.index("--report") + 1]).write_text(json.dumps(named, ensure_ascii=False), encoding="utf-8")
finally:
    db.close()
