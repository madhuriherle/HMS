"""Replace the location masters (districts, taluks) with the government's Local Government Directory lists, and load its villages.

Nothing is erased and nobody loses a link. An old district or taluk that has a new equivalent is RENAMED in place (so every member and
pincode that points at it keeps pointing at it), gets its Kannada name and the official code, and is moved to its new district when the
government moved it. Two old taluks that are the same new taluk are merged (their members and pincodes move to one and the other is
marked deleted). A new taluk nobody maps to is added. An old taluk with no equivalent is left as it is (made inactive when nothing uses
it) and listed in the report, so the office decides. The pincodes stay: the directory has none; they follow their taluk.

The files are the Excel 2003 XML downloads of the directory (districtofSpecificState, subDistrictofSpecificState, villageofSpecificState).
"""
import glob
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from difflib import get_close_matches

NS = "{urn:schemas-microsoft-com:office:spreadsheet}"

# old spellings of the register / old masters -> the government's spelling (letters only, lower case)
DISTRICT_ALIAS = {
    "bangalore": "bengaluruurban", "bengaluru": "bengaluruurban", "bangalorerural": "bengalururural", "mysore": "mysuru", "belgaum": "belagavi",
    "gulbarga": "kalaburagi", "bellary": "ballari", "bijapur": "vijayapura", "shimoga": "shivamogga", "tumkur": "tumakuru",
    "chikmagalur": "chikkamagaluru", "chikmagaluru": "chikkamagaluru", "bagalkot": "bagalkote", "chamrajnagar": "chamarajanagar",
    "chikkaballapur": "chikkaballapura", "ramanagar": "bengalurusouth", "kasargod": "kasaragod", "davangere": "davanagere",
}
TALUK_ALIAS = {
    "mangalore": "mangaluru", "sullia": "sulya", "raibag": "raybag", "saundatti": "savadatti", "hubli": "hubballiurban", "krnagar": "krishnarajanagara",
    "bangalorenorth": "bengalurunorth", "bangaloresouth": "bengalurusouth",
    # old names of the district towns (the taluk of the same name), and old spellings
    "shimoga": "shivamogga", "belgaum": "belagavi", "bellary": "ballari", "mysore": "mysuru", "bijapur": "vijayapura", "gulbarga": "kalaburagi",
    "gangavathi": "gangawati", "deodurga": "devadurga", "kalgahtagi": "kalghatgi", "changanacherry": "changanassery",
    "mukundapuramtaluk": "mukundapuram", "chalakudi": "chalakkudy",
}
# decided by hand: old taluk -> the new taluk it is (the automatic spelling match is not safe for these)
TALUK_OVERRIDE = {
    "hospet": "hosapete", "hbhalli": "hagaribommanahalli", "huvinahadagali": "hadagalli", "joida": "supa", "hungundtaluk": "hungund", "krpete": "krishnarajpet",
    "bbagewadi": "basavanabagevadi", "cnhalli": "chiknayakanhalli", "kusthgati": "kushtagi", "hdkote": "heggadadevankote",
    "tnarasipura": "tirumakudalnarsipur", "bellandur": "bengalurueast", "manjeri": "ernad", "chirayinkil": "chirayinkeezhu", "quilandy": "koyilandi",
    "adichanallur": "kollam", "ambalapuzha": "ambalappuzha",
}


def _letters(x: str) -> str:
    return re.sub(r"[^a-z]", "", (x or "").lower())


def read_rows(path):
    rows = []
    for _ev, el in ET.iterparse(path, events=("end",)):
        if el.tag == NS + "Row":
            row, col = [], 0
            for cell in el.findall(NS + "Cell"):
                idx = cell.get(NS + "Index")
                if idx:
                    while col < int(idx) - 1:
                        row.append("")
                        col += 1
                d = cell.find(NS + "Data")
                row.append((d.text or "").strip() if d is not None else "")
                col += 1
            rows.append(row)
            el.clear()
    return rows


def read_state_files(folder: str) -> dict:
    """{"districts": [(code, name, local)], "taluks": [(code, name, local, district name)], "villages": [(code, name, local, district name, taluk name)]}"""
    districts = [(r[1], r[3], r[4] if len(r) > 4 else "") for r in read_rows(glob.glob(folder + "/districtofSpecific*")[0])[5:] if len(r) > 3 and r[3] and r[1].isdigit()]
    taluks = [(r[3], r[5], r[6] if len(r) > 6 else "", r[2]) for r in read_rows(glob.glob(folder + "/subDistrictofSpecific*")[0])[5:] if len(r) > 5 and r[5] and r[3].isdigit()]
    villages = []
    for f in glob.glob(folder + "/villageofSpecific*"):
        for r in read_rows(f)[5:]:
            if len(r) > 8 and r[7] and r[5].isdigit():
                villages.append((r[5], r[7], r[8], r[2], r[4]))
    return {"districts": districts, "taluks": taluks, "villages": villages}


def _district_key(name):
    k = _letters(name)
    return DISTRICT_ALIAS.get(k, k)


def _taluk_key(name):
    k = _letters(name)
    return TALUK_ALIAS.get(k, k)


def replace_state(db, state_name: str, data: dict, user_id: int, apply: bool = True) -> dict:
    """Plan and (apply=True) make the change for one state. Returns the report."""
    from sqlalchemy import func, or_
    from models.masters import District, PostalCode, State, Taluk
    from models.members import Member

    now = datetime.now(timezone.utc)
    state = db.query(State).filter(State.is_deleted == False, State.name_en.ilike(state_name)).one()  # noqa: E712
    report = defaultdict(list)

    # ---------------- districts
    old_ds = db.query(District).filter(District.is_deleted == False, District.state_id == state.id).all()  # noqa: E712
    new_ds = {_district_key(n): (c, n, loc) for c, n, loc in data["districts"]}
    claimed, dist_by_name = {}, {}
    for d in old_ds:
        key = _district_key(d.name_en)
        hit = key if key in new_ds else (get_close_matches(key, list(new_ds), 1, 0.85) or [None])[0]
        if hit and hit not in claimed:
            claimed[hit] = d
    for key, (code, name, loc) in new_ds.items():
        d = claimed.get(key)
        if d is None:
            d = District(state_id=state.id, name_en=name, created_by=user_id)
            db.add(d)
            report["districts added"].append(name)
        elif d.name_en != name:
            report["districts renamed"].append(f"{d.name_en} -> {name}")
        d.name_en, d.name_kn, d.code, d.status = name, loc or d.name_kn, code, True
        db.flush()
        dist_by_name[_letters(name)] = d
    for d in old_ds:
        if d not in claimed.values():
            used = db.query(Member.id).filter(Member.district_id == d.id, Member.is_deleted == False).first() or db.query(PostalCode.id).filter(  # noqa: E712
                PostalCode.district_id == d.id, PostalCode.is_deleted == False).first()  # noqa: E712
            if used:
                d.status = False
                report["old districts left inactive (still used)"].append(d.name_en)
            else:
                d.is_deleted, d.deleted_at = True, now
                report["old districts removed (unused)"].append(d.name_en)

    # ---------------- taluks
    all_ds = {d.id: d for d in db.query(District).filter(District.state_id == state.id).all()}
    old_ts = db.query(Taluk).filter(Taluk.is_deleted == False, Taluk.district_id.in_(list(all_ds))).all()  # noqa: E712
    new_ts = {}      # (district key, taluk key) -> (code, name, local, district name)
    by_taluk_key = defaultdict(list)
    for code, name, loc, dn in data["taluks"]:
        new_ts[(_letters(dn), _taluk_key(name))] = (code, name, loc, dn)
        by_taluk_key[_taluk_key(name)].append((_letters(dn), _taluk_key(name)))
    members_on = dict(db.query(Member.taluk_id, func.count()).filter(Member.is_deleted == False, Member.taluk_id.isnot(None)).group_by(Member.taluk_id).all())  # noqa: E712
    target_of = {}
    for t in old_ts:
        od = all_ds[t.district_id]
        key = _taluk_key(t.name_en)
        key = TALUK_OVERRIDE.get(_letters(t.name_en), key)
        # the new district this old district became (same record, renamed), so look in it first
        dk = _letters(od.name_en)
        cand = {tk: v for (dk2, tk), v in new_ts.items() if dk2 == dk}
        hit = None
        if key in cand:
            hit = (dk, key)
        else:
            near = get_close_matches(key, list(cand), 1, 0.8)
            if near:
                hit = (dk, near[0])
            elif len(by_taluk_key.get(key, [])) == 1:        # the same name in another district: the taluk moved there
                hit = by_taluk_key[key][0]
            elif key in TALUK_OVERRIDE.values() and len(by_taluk_key.get(key, [])) >= 1:
                hit = by_taluk_key[key][0]
        if hit:
            target_of[t.id] = hit
    groups = defaultdict(list)
    for t in old_ts:
        if t.id in target_of:
            groups[target_of[t.id]].append(t)
    survivors = {}
    for hit, ts in groups.items():
        ts.sort(key=lambda x: (-int(members_on.get(x.id, 0)), x.id))
        survivors[hit] = ts[0]
    for (dk, tk), (code, name, loc, dn) in new_ts.items():
        dist = dist_by_name[_letters(dn)]
        t = survivors.get((dk, tk))
        if t is None:
            t = Taluk(district_id=dist.id, name_en=name, created_by=user_id)
            db.add(t)
            report["taluks added"].append(f"{name} ({dn})")
        else:
            if t.name_en != name or t.district_id != dist.id:
                report["taluks renamed or moved"].append(f"{t.name_en} -> {name} ({dn})")
        t.name_en, t.name_kn, t.code, t.district_id, t.status = name, loc or t.name_kn, code, dist.id, True
        db.flush()
        survivors[(dk, tk)] = t
    merged = 0
    for hit, ts in groups.items():
        keep = survivors[hit]
        for t in ts:
            if t.id == keep.id:
                continue
            db.query(Member).filter(Member.taluk_id == t.id).update({"taluk_id": keep.id}, synchronize_session=False)
            db.query(PostalCode).filter(PostalCode.taluk_id == t.id).update({"taluk_id": keep.id}, synchronize_session=False)
            t.is_deleted, t.deleted_at = True, now
            merged += 1
            report["old taluks merged into another"].append(f"{t.name_en} -> {keep.name_en}")
    # a member or a pincode follows its taluk's district (a taluk the government moved to another district takes them along)
    for t in survivors.values():
        for model in (Member, PostalCode):
            db.query(model).filter(model.taluk_id == t.id, or_(model.district_id.is_(None), model.district_id != t.district_id)).update(
                {"district_id": t.district_id, "state_id": state.id}, synchronize_session=False)
    claimed_ids = {t.id for t in survivors.values()}
    for t in old_ts:
        if t.id in claimed_ids or t.is_deleted:
            continue
        mem = db.query(Member.id).filter(Member.taluk_id == t.id, Member.is_deleted == False).count()  # noqa: E712
        pin = db.query(PostalCode.id).filter(PostalCode.taluk_id == t.id, PostalCode.is_deleted == False).count()  # noqa: E712
        if mem or pin:
            t.status = False
            report["old taluks with no new equivalent (left, inactive; the office decides)"].append(f"{t.name_en} ({all_ds[t.district_id].name_en}): {mem} members, {pin} pincodes")
        else:
            t.is_deleted, t.deleted_at = True, now
            report["old taluks removed (unused)"].append(t.name_en)

    # ---------------- villages
    from models.masters import Village
    tmap = {}
    for t in db.query(Taluk).filter(Taluk.is_deleted == False, Taluk.district_id.in_(list(all_ds))).all():  # noqa: E712
        tmap[(_letters(all_ds[t.district_id].name_en), _letters(t.name_en))] = t
    have = {c for (c,) in db.query(Village.lgd_code).filter(Village.state_id == state.id).all() if c}
    added = skipped = 0
    batch = []
    for code, name, loc, dn, tn in data["villages"]:
        if code in have:
            continue
        t = tmap.get((_letters(dn), _letters(tn)))
        if t is None:
            skipped += 1
            continue
        batch.append(Village(state_id=state.id, district_id=t.district_id, taluk_id=t.id, name_en=name[:150], name_kn=(loc or None), lgd_code=code, status=True, created_by=user_id))
        added += 1
        if len(batch) >= 2000:
            db.bulk_save_objects(batch)
            batch = []
    if batch:
        db.bulk_save_objects(batch)
    report["villages added"] = [str(added)]
    report["villages without a taluk in the master"] = [str(skipped)]
    if apply:
        db.commit()
    else:
        db.rollback()
    return {k: v for k, v in report.items()}

