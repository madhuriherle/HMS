"""Add the Karnataka and Kerala pincodes of the old register that the Postal Codes master does not have, and link the members
that use them: python scripts/seed_missing_pincodes.py MstMember.xlsx [--dry]. Safe to repeat.

A pincode is taken as valid when it has 6 digits and starts with 56-59 (Karnataka) or 67-69 (Kerala). Its district and taluk are
the ones most members of that pincode have in the register, matched to the masters (old spellings in ALIAS). The post office name
is not in the register, so it stays empty. A pincode whose district is not in the master is listed and left out."""
import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models.masters, models.members, models.receipts, models.users  # noqa: E402,F401  (every table must be known)
from db.session import SessionLocal  # noqa: E402
from models.masters import District, PostalCode, State, Taluk  # noqa: E402
from models.members import Member  # noqa: E402
from services import legacy_import as L  # noqa: E402

KARNATAKA, KERALA = ("56", "57", "58", "59"), ("67", "68", "69")
ALIAS = {   # register spelling -> master spelling
    "MYSORE": "MYSURU", "CHICKMAGALUR": "CHIKKAMAGALURU", "SHIMOGA": "SHIVAMOGGA", "U.K": "UTTARA KANNADA",
    "BENGALURU NORTH": "BANGALORE NORTH", "BENGALURU SOUTH": "BANGALORE SOUTH", "BANTWAL": "BANTVAL",
    "HOSANAGAR": "HOSANAGARA", "SHIKARIPURA": "SHIKARPUR", "KASARGOD": "KASARAGOD",
}


def key(s) -> str:
    return re.sub(r"[^A-Z]", "", ALIAS.get(L._s(s).upper(), L._s(s).upper()))


ap = argparse.ArgumentParser()
ap.add_argument("file")
ap.add_argument("--dry", action="store_true")
a = ap.parse_args()
rows = L.read_register(Path(a.file).read_bytes())
db = SessionLocal()
try:
    have = {p for (p,) in db.query(PostalCode.pincode).filter(PostalCode.is_deleted == False).all()}  # noqa: E712
    states = {key(s.name_en): s for s in db.query(State).filter(State.is_deleted == False).all()}  # noqa: E712
    districts = defaultdict(dict)
    for d in db.query(District).filter(District.is_deleted == False).all():  # noqa: E712
        districts[d.state_id][key(d.name_en)] = d
    taluks = defaultdict(dict)
    for t in db.query(Taluk).filter(Taluk.is_deleted == False).all():  # noqa: E712
        taluks[t.district_id].setdefault(key(t.name_en), t)
    group = defaultdict(list)
    for r in rows:
        p = L._s(r.get("CusPinCode"))
        if p not in have and re.fullmatch(r"\d{6}", p) and p[:2] in KARNATAKA + KERALA:
            group[p].append(r)
    made, linked, left = 0, 0, []
    for p, members in sorted(group.items()):
        state = states["KARNATAKA" if p[:2] in KARNATAKA else "KERALA"]
        dname = Counter(key(r.get("CusDistrict")) for r in members).most_common(1)[0][0]
        district = districts[state.id].get(dname)
        if not district:
            left.append((p, len(members), "district not in the master: " + L._s(members[0].get("CusDistrict"))))
            continue
        tname = Counter(key(r.get("CusTaluk")) for r in members).most_common(1)[0][0]
        taluk = taluks[district.id].get(tname)
        pc = PostalCode(pincode=p, post_office_name=None, state_id=state.id, district_id=district.id,
                        taluk_id=taluk.id if taluk else None, status=True, created_by=1)
        db.add(pc)
        db.flush()
        made += 1
        ids = {L._s(r.get("CusNo")) for r in members}
        for m in db.query(Member).filter(Member.membership_number.in_(ids), Member.pincode_id == None).all():  # noqa: E711
            m.pincode_id, m.state_id, m.district_id, m.taluk_id = pc.id, state.id, district.id, pc.taluk_id
            linked += 1
        print(f"{p}: {district.name_en} / {taluk.name_en if taluk else '(taluk not in the master)'} - {len(members)} members")
    print({"pincodes_added": made, "members_linked": linked, "left_out": left})
    if a.dry:
        db.rollback()
        print("dry run: nothing saved")
    else:
        db.commit()
finally:
    db.close()
