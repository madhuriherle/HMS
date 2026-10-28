"""Point each pincode (post office) at the government directory's village of the same name, and at that village's taluk.

A post office is usually named after a village (Kukkujadka B.O is the village Kukkujadka). Inside the pincode's own district the post
office name is compared, letters only, with the villages' names:
  * one village of that name: the pincode points at it, and takes its taluk (the members linked to the pincode and still on the old taluk
    follow);
  * several villages of that name: if one of them is in the pincode's current taluk the pincode points at that one and keeps its taluk,
    otherwise it is left for the office (listed);
  * no village of that name (a town or a locality of a city): left as it is.
Nothing else is changed. Safe to repeat.
"""
import re
from collections import defaultdict
from difflib import get_close_matches

SUFFIX = re.compile(r"\s+[A-Za-z]\.?\s?[A-Za-z]?\.?\s?[Oo]\.?(\s.*)?$")


def _letters(x: str) -> str:
    return re.sub(r"[^a-z]", "", (x or "").lower())


def post_office_key(name: str) -> str:
    """Kukkujadka B.O -> kukkujadka; Malleshwaram S.O -> malleshwaram; Sullia H.O -> sullia."""
    n = re.sub(r"\s*\(.*?\)\s*", " ", name or "").strip()
    n = re.sub(r"\s+(B|S|H|G|T)\s*\.?\s*(P\s*\.?\s*)?O\s*\.?\s*$", "", n, flags=re.I)
    return _letters(n)


def map_pincodes(db, apply: bool = True) -> dict:
    from models.masters import PostalCode, Taluk, Village
    from models.members import Member
    from sqlalchemy import func

    # a deleted (merged) taluk's pincodes, villages and members go to the live taluk of the same name in the same district
    dead = {t.id: t for t in db.query(Taluk).filter(Taluk.is_deleted == True).all()}  # noqa: E712
    for t in dead.values():
        live = db.query(Taluk).filter(Taluk.district_id == t.district_id, func.lower(Taluk.name_en) == (t.name_en or "").lower(), Taluk.is_deleted == False, Taluk.id != t.id).first()  # noqa: E712
        if live:
            for model in (PostalCode, Village, Member):
                db.query(model).filter(model.taluk_id == t.id).update({"taluk_id": live.id}, synchronize_session=False)
    by_district = defaultdict(lambda: defaultdict(list))       # district id -> name key -> [(village id, taluk id)]
    for vid, did, tid, name in db.query(Village.id, Village.district_id, Village.taluk_id, Village.name_en).filter(Village.is_deleted == False).all():  # noqa: E712
        by_district[did][_letters(name)].append((vid, tid))
    pcs = db.query(PostalCode).filter(PostalCode.is_deleted == False).all()  # noqa: E712
    out = {"pincodes": len(pcs), "pointed at a village (same taluk)": 0, "pointed at a village (taluk changed)": 0, "several villages, left for the office": 0,
           "no village of that name": 0, "followed the other post offices of their pincode": 0, "members moved with their pincode": 0}
    review, changes, unmatched = [], [], []
    loose = []                                                  # post offices with no village of their own: [(pc, village hits or None)]
    changed_taluk = {}
    for pc in pcs:
        key = post_office_key(pc.post_office_name)
        names = by_district.get(pc.district_id)
        if not key or not names:
            out["no village of that name"] += 1
            unmatched.append((pc.pincode, pc.post_office_name, pc.taluk_id))
            loose.append((pc, None))
            continue
        hits = names.get(key)
        if not hits:
            near = get_close_matches(key, list(names), 1, 0.93) if len(key) >= 6 else []
            hits = names[near[0]] if near else None
        if not hits:
            out["no village of that name"] += 1
            unmatched.append((pc.pincode, pc.post_office_name, pc.taluk_id))
            loose.append((pc, None))
            continue
        if len(hits) > 1:
            same = [h for h in hits if h[1] == pc.taluk_id]
            if len(same) == 1:
                hits = same
            else:
                out["several villages, left for the office"] += 1
                review.append((pc.pincode, pc.post_office_name, len(hits)))
                loose.append((pc, hits))
                continue
        vid, tid = hits[0]
        if pc.taluk_id == tid:
            out["pointed at a village (same taluk)"] += 1
        else:
            out["pointed at a village (taluk changed)"] += 1
            changed_taluk[pc.id] = (pc.taluk_id, tid)
            changes.append((pc.pincode, pc.post_office_name, pc.taluk_id, tid))
        pc.village_id = vid
        pc.taluk_id = tid
    # a post office the village list does not know (Kota S.O, Manur B.O...) follows the other post offices of its pincode when those,
    # matched to villages, all sit in one taluk of its district; where they disagree it stays and is listed
    sibling = defaultdict(set)
    for pc in pcs:
        if pc.village_id:
            sibling[pc.pincode].add((pc.taluk_id, pc.district_id))
    for pc, hits in loose:
        found = sibling.get(pc.pincode, set())
        if len(found) != 1:
            continue
        tid, did = next(iter(found))
        if did != pc.district_id or pc.taluk_id == tid:
            continue
        if hits is not None:
            mine = [h for h in hits if h[1] == tid]
            if len(mine) != 1:
                continue
            pc.village_id = mine[0][0]
            review[:] = [r for r in review if not (r[0] == pc.pincode and r[1] == pc.post_office_name)]
            out["several villages, left for the office"] -= 1
        else:
            unmatched[:] = [u for u in unmatched if not (u[0] == pc.pincode and u[1] == pc.post_office_name)]
            out["no village of that name"] -= 1
        out["followed the other post offices of their pincode"] += 1
        changed_taluk[pc.id] = (pc.taluk_id, tid)
        changes.append((pc.pincode, pc.post_office_name, pc.taluk_id, tid))
        pc.taluk_id = tid
    # members linked to a pincode whose taluk changed follow it (only when they still hold the old taluk)
    for pid, (old, new) in changed_taluk.items():
        if old is None:
            n = db.query(Member).filter(Member.pincode_id == pid, Member.taluk_id.is_(None), Member.is_deleted == False).update({"taluk_id": new}, synchronize_session=False)  # noqa: E712
        else:
            n = db.query(Member).filter(Member.pincode_id == pid, Member.taluk_id == old, Member.is_deleted == False).update({"taluk_id": new}, synchronize_session=False)  # noqa: E712
        out["members moved with their pincode"] += n
    # keep a member's district in step with the taluk
    if changed_taluk:
        from sqlalchemy import or_
        for t in db.query(Taluk).filter(Taluk.id.in_({n for _o, n in changed_taluk.values()})).all():
            db.query(Member).filter(Member.taluk_id == t.id, or_(Member.district_id.is_(None), Member.district_id != t.district_id)).update(
                {"district_id": t.district_id}, synchronize_session=False)
            db.query(PostalCode).filter(PostalCode.taluk_id == t.id, or_(PostalCode.district_id.is_(None), PostalCode.district_id != t.district_id)).update(
                {"district_id": t.district_id}, synchronize_session=False)
    out["review"] = review
    out["changes"] = changes
    out["unmatched"] = unmatched
    if apply:
        db.commit()
    else:
        db.rollback()
    return out
