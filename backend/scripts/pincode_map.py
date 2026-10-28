"""Point the pincodes at their villages and taluks: python scripts/pincode_map.py [--dry] [--report out.json].
See services/pincode_map.py. --report writes the changes and the pincodes left for the office, with names, for a review file."""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from models.masters import District, PostalCode, Taluk  # noqa: E402
from services import pincode_map  # noqa: E402

db = SessionLocal()
try:
    tname = {i: n for i, n in db.query(Taluk.id, Taluk.name_en).all()}
    tdist = {i: d for i, d in db.query(Taluk.id, Taluk.district_id).all()}
    dname = {i: n for i, n in db.query(District.id, District.name_en).all()}
    out = pincode_map.map_pincodes(db, apply="--dry" not in sys.argv)
    review, changes, unmatched = out.pop("review"), out.pop("changes"), out.pop("unmatched")
    print({k: v for k, v in out.items()})
    named = [(p, po, tname.get(o), tname.get(n), dname.get(tdist.get(n))) for p, po, o, n in changes]
    random.seed(7)
    print("changed taluks, sample (pincode, post office, old taluk, new taluk, district):")
    for r in random.sample(named, min(25, len(named))):
        print("  ", r)
    if "--report" in sys.argv:
        Path(sys.argv[sys.argv.index("--report") + 1]).write_text(json.dumps({"changed": named, "review": review, "unmatched": [(p, po, tname.get(t)) for p, po, t in unmatched]}, ensure_ascii=False), encoding="utf-8")
finally:
    db.close()
