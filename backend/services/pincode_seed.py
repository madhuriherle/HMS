"""Rebuild the pincode master (Karnataka and Kerala) from the India Post directory, forgetting the old rows.

Source: the all-India post office CSV (office name, pincode, district, state, latitude, longitude). Each post office gets its taluk (and the
village it is named after) from the government directory loaded in `villages`:
  1. the post office name is the name of one village of its district  -> that village and its taluk;
  2. several villages have that name  -> the one in a taluk that the matched post offices of the same pincode sit in (when that is one);
  3. no village of that name (Kota S.O, a town or a locality)  -> the taluk the matched post offices of its pincode all share, else the
     taluk of the nearest matched post office of the district within NEAR_KM;
  4. none of these  -> no taluk, listed for the office. Nothing is guessed.
The old rows of those two states are marked deleted (not erased); members are moved to the new row of their pincode and post office, and
take its taluk and district. A pincode that is in no new row and has members keeps its old row. Safe to repeat.
"""
import csv
import math
import re
from collections import defaultdict
from difflib import get_close_matches

from services.pincode_map import _letters, post_office_key

STATES = ("KARNATAKA", "KERALA")
NEAR_KM = 6.0
DISTRICT_ALIAS = {"ramanagara": "bengalurusouth", "vijaynagar": "vijayanagara", "bagalkot": "bagalkote", "davangere": "davanagere",
                  "chamarajanagara": "chamarajanagar"}


def nice_name(name: str) -> str:
    """Kota SO -> Kota S.O ; Manur BO -> Manur B.O ; names already in the dotted form are kept."""
    n = re.sub(r"\s+", " ", (name or "").strip())
    return re.sub(r"\s+([BSH])\.?O\.?$", r" \1.O", n)


def _coords(lat, lon):
    try:
        a, b = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    return (a, b) if 8.0 < a < 19.0 and 73.5 < b < 78.8 else None


def _km(a, b):
    dy = (a[0] - b[0]) * 111.0
    dx = (a[1] - b[1]) * 111.0 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dx, dy)


def read_directory(path: str) -> list:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [r for r in csv.DictReader(f) if (r.get("statename") or "").strip().upper() in STATES]


def plan(db, rows: list) -> dict:
    """Work out the new rows without saving anything: {'rows': [...], 'stats': {...}, 'review': [...], 'bad_districts': [...]}"""
    from models.masters import District, State, Village

    states = {s.name_en.strip().upper(): s.id for s in db.query(State).filter(State.is_deleted == False).all()}  # noqa: E712
    dist_by_state = defaultdict(dict)
    for d in db.query(District).filter(District.is_deleted == False, District.status == True).all():  # noqa: E712
        dist_by_state[d.state_id][_letters(d.name_en)] = d.id
    by_district = defaultdict(lambda: defaultdict(list))                 # district id -> name key -> [(village id, taluk id)]
    for vid, did, tid, name in db.query(Village.id, Village.district_id, Village.taluk_id, Village.name_en).filter(Village.is_deleted == False).all():  # noqa: E712
        by_district[did][_letters(name)].append((vid, tid))

    out, bad = [], set()
    for r in rows:
        sid = states.get(r["statename"].strip().upper())
        key = _letters(r["district"])
        key = DISTRICT_ALIAS.get(key, key)
        dmap = dist_by_state.get(sid, {})
        did = dmap.get(key) or (dmap.get((get_close_matches(key, list(dmap), 1, 0.8) or [None])[0]))
        if not sid or not did:
            bad.add((r["statename"], r["district"]))
            continue
        out.append({"pincode": r["pincode"].strip(), "name": nice_name(r["officename"]), "state_id": sid, "district_id": did,
                    "xy": _coords(r["latitude"], r["longitude"]), "taluk_id": None, "village_id": None, "how": None, "hits": None})

    stats = defaultdict(int)
    # 1. a village of that name
    for o in out:
        names = by_district.get(o["district_id"], {})
        key = post_office_key(o["name"])
        hits = names.get(key) if key else None
        if not hits and key and len(key) >= 6:
            near = get_close_matches(key, list(names), 1, 0.93)
            hits = names[near[0]] if near else None
        if hits and len(hits) == 1:
            o["village_id"], o["taluk_id"], o["how"] = hits[0][0], hits[0][1], "village name"
        elif hits:
            o["hits"] = hits
    # 2. several villages of that name: the one in a taluk its pincode already sits in
    by_pin = defaultdict(set)
    for o in out:
        if o["taluk_id"]:
            by_pin[o["pincode"]].add(o["taluk_id"])
    for o in out:
        if o["hits"]:
            mine = [h for h in o["hits"] if h[1] in by_pin.get(o["pincode"], ())]
            if len(mine) == 1:
                o["village_id"], o["taluk_id"], o["how"] = mine[0][0], mine[0][1], "village name, taluk of its pincode"
    # 3. no village of that name: the nearest matched post office, else what the pincode shares
    anchors = defaultdict(list)
    for o in out:
        if o["taluk_id"] and o["xy"]:
            anchors[o["district_id"]].append(o)
    by_pin = defaultdict(set)
    for o in out:
        if o["taluk_id"]:
            by_pin[o["pincode"]].add(o["taluk_id"])
    for o in out:
        if o["taluk_id"]:
            continue
        best = None
        if len(by_pin.get(o["pincode"], ())) == 1:
            o["taluk_id"], o["how"] = next(iter(by_pin[o["pincode"]])), "its pincode"
        elif o["xy"]:
            for a in anchors.get(o["district_id"], ()):
                d = _km(o["xy"], a["xy"])
                if d <= NEAR_KM and (best is None or d < best[0]):
                    best = (d, a)
        if best:
            o["taluk_id"], o["how"] = best[1]["taluk_id"], "nearest post office"
        if o["hits"] and o["taluk_id"]:
            mine = [h for h in o["hits"] if h[1] == o["taluk_id"]]
            if len(mine) == 1:
                o["village_id"] = mine[0][0]
    review = [o for o in out if not o["taluk_id"]]
    for o in out:
        stats[o["how"] or "no taluk (for the office)"] += 1
    return {"rows": out, "stats": dict(stats), "review": review, "bad_districts": sorted(bad)}


def seed(db, rows: list, apply: bool = True) -> dict:
    from models.masters import District, PostalCode, Taluk
    from models.members import Member
    from sqlalchemy import or_

    p = plan(db, rows)
    new = p["rows"]
    state_ids = {o["state_id"] for o in new}
    new_pins = {o["pincode"] for o in new}
    old = db.query(PostalCode).filter(PostalCode.is_deleted == False, PostalCode.state_id.in_(state_ids)).all()  # noqa: E712
    with_members = {pid for (pid,) in db.query(Member.pincode_id).filter(Member.pincode_id.isnot(None), Member.is_deleted == False).distinct()}  # noqa: E712
    keep = [o for o in old if o.id in with_members and o.pincode not in new_pins]          # members on a pincode the directory does not have
    drop = [o for o in old if o not in keep]
    for o in drop:
        o.is_deleted = True
        o.status = False
    fresh = []
    for o in new:
        pc = PostalCode(pincode=o["pincode"], post_office_name=o["name"], state_id=o["state_id"], district_id=o["district_id"],
                        taluk_id=o["taluk_id"], village_id=o["village_id"], status=True)
        db.add(pc)
        fresh.append((o, pc))
    db.flush()
    by_pin = defaultdict(list)
    for o, pc in fresh:
        by_pin[o["pincode"]].append(pc)
    moved = 0
    for oldpc in drop:
        if oldpc.id not in with_members:
            continue
        cands = by_pin.get(oldpc.pincode)
        if not cands:
            continue
        key = post_office_key(oldpc.post_office_name)
        pick = next((c for c in cands if post_office_key(c.post_office_name) == key), None) or cands[0]
        moved += db.query(Member).filter(Member.pincode_id == oldpc.id).update({"pincode_id": pick.id}, synchronize_session=False)
        if pick.taluk_id:
            did = db.query(Taluk.district_id).filter(Taluk.id == pick.taluk_id).scalar()
            db.query(Member).filter(Member.pincode_id == pick.id).update({"taluk_id": pick.taluk_id, "district_id": did, "state_id": pick.state_id},
                                                                          synchronize_session=False)
    p["stats"]["old rows marked deleted"] = len(drop)
    p["stats"]["old rows kept (members, pincode not in the directory)"] = len(keep)
    p["stats"]["new rows"] = len(new)
    p["stats"]["members moved to a new row"] = moved
    if apply:
        db.commit()
    else:
        db.rollback()
    return p
