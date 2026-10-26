"""Members who may be the same person, in three reports for the office to compare:
  * mobile  - one mobile number used by several members;
  * name    - the same name (spacing, dots and case ignored) used by several members;
  * similar - names that are spelled a little differently (Madhuri / Maduri, Krishna / Krushna, Sridhara / Shridhar).
A group is only a pointer: family members may share a mobile and two people may share a name, so nothing is merged here."""
import io
import re
from collections import defaultdict
from typing import Optional

KINDS = ("mobile", "name", "similar")
MIN_WORD_LEN = 5         # a shorter word (Rama / Ramu, Bhat / Bhut) differs by one letter and is still another word


def _letters(name) -> str:
    return re.sub(r"[^A-Z]", "", str(name or "").upper())


def _sound(letters: str) -> str:
    """Spellings that sound alike get one key: no H, W as V, doubled letters once, Y and E as I, AU as OU, no final A."""
    k = letters.replace("AU", "OU").replace("W", "V").replace("H", "").replace("Y", "I").replace("E", "I")
    k = re.sub(r"(.)\1+", r"\1", k)
    return k[:-1] if k.endswith("A") else k


def _parts(name) -> tuple:
    """(initials, words) of a name: "A. G. Hegde" is ("AG", ("HEGDE",)). Initials and short tokens must match exactly, only the words may differ."""
    tokens = [t for t in re.split(r"[^A-Za-z]+", str(name or "").upper()) if t]
    return "".join(t for t in tokens if len(t) <= 2), tuple(t for t in tokens if len(t) > 2)


def _one_letter_apart(a: str, b: str) -> bool:
    if abs(len(a) - len(b)) > 1 or a == b:
        return False
    if len(a) == len(b):    # a changed letter counts only between two vowels (Krishna / Krushna), not Ramesh / Rakesh
        diff = [(x, y) for x, y in zip(a, b) if x != y]
        return len(diff) == 1 and diff[0][0] in "AEIOU" and diff[0][1] in "AEIOU"
    short, long_ = (a, b) if len(a) < len(b) else (b, a)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


def _alike(w1: tuple, w2: tuple) -> bool:
    """Same number of words, and at most one word differs, by one letter, and that word is not a short one."""
    if len(w1) != len(w2):
        return False
    diff = [(x, y) for x, y in zip(w1, w2) if x != y]
    return len(diff) == 1 and min(len(diff[0][0]), len(diff[0][1])) >= MIN_WORD_LEN and _one_letter_apart(*diff[0])


def _load(db) -> list:
    from models.masters import District, PostalCode
    from models.members import Member

    q = (db.query(Member.id, Member.full_name_en, Member.first_name_en, Member.middle_name_en, Member.last_name_en, Member.mobile,
                  Member.membership_number, Member.old_membership_number, Member.date_of_birth, Member.father_husband_name,
                  Member.locality, Member.village, Member.city, Member.approval_status, Member.member_status, Member.gender,
                  PostalCode.pincode, District.name_en)
         .outerjoin(PostalCode, PostalCode.id == Member.pincode_id).outerjoin(District, District.id == Member.district_id)
         .filter(Member.is_deleted == False))  # noqa: E712
    out = []
    for (mid, full, f, mi, la, mobile, mno, old, dob, father, loc, vil, city, appr, status, gender, pin, district) in q.all():
        name = " ".join((full or " ".join(p for p in (f, mi, la) if p)).split())
        out.append({"id": mid, "name": name, "mobile": mobile or "", "membership_no": mno or "", "old_no": old or "",
                    "dob": dob.isoformat() if dob else "", "father": father or "", "place": loc or vil or city or "",
                    "pincode": pin or "", "district": district or "", "approval": appr or "", "status": status or "", "gender": gender or ""})
    return out


def find_groups(db, kind: str, search: Optional[str] = None) -> list:
    """Groups of members, largest first. Each group: {"key", "reason", "members": [...]}."""
    if kind not in KINDS:
        raise ValueError("kind must be mobile, name or similar")
    people = _load(db)
    out = []
    if kind == "mobile":
        groups = defaultdict(list)
        for p in people:
            if p["mobile"]:
                groups[p["mobile"]].append(p)
        for key, ms in groups.items():
            if len(ms) < 2:
                continue
            same_name = len({_letters(m["name"]) for m in ms}) == 1
            out.append({"key": key, "reason": "Same mobile, same name" if same_name else "Same mobile, different names", "members": ms})
    elif kind == "name":
        groups = defaultdict(list)
        for p in people:
            k = _letters(p["name"])
            if k:
                groups[k].append(p)
        for key, ms in groups.items():
            if len(ms) < 2:
                continue
            same_mobile = all(m["mobile"] for m in ms) and len({m["mobile"] for m in ms}) == 1
            out.append({"key": ms[0]["name"], "reason": "Same name, same mobile" if same_mobile else "Same name, different details", "members": ms})
    else:
        by_letters = defaultdict(list)
        for p in people:
            k = _letters(p["name"])
            if k:
                by_letters[k].append(p)
        parts = {k: _parts(by_letters[k][0]["name"]) for k in by_letters}
        parent = {k: k for k in by_letters}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        by_sound, by_block = defaultdict(list), defaultdict(list)
        for k, (ini, words) in parts.items():
            if not words:
                continue
            by_sound[(ini, tuple(_sound(w) for w in words))].append(k)
            by_block[(ini, len(words))].append(k)
        for ks in by_sound.values():
            for other in ks[1:]:
                parent[find(ks[0])] = find(other)
        # one letter apart: look through the names with one letter taken out of their words, inside the same initials and word count
        seen = defaultdict(set)
        for (ini, n), ks in by_block.items():
            for k in ks:
                joined = "".join(parts[k][1])
                if len(joined) < MIN_WORD_LEN:
                    continue
                seen[(ini, n, joined)].add(k)
                for i in range(len(joined)):
                    seen[(ini, n, joined[:i] + joined[i + 1:])].add(k)
        for group in seen.values():
            if 1 < len(group) <= 60:
                g = sorted(group)
                for x_i, x in enumerate(g):
                    for y in g[x_i + 1:]:
                        if _alike(parts[x][1], parts[y][1]):
                            parent[find(x)] = find(y)
        clusters = defaultdict(list)
        for k in by_letters:
            clusters[find(k)].append(k)
        for ks in clusters.values():
            if len(ks) < 2:
                continue            # one spelling only: that is the "same name" report
            ms = [m for k in ks for m in by_letters[k]]
            spellings = sorted({m["name"] for m in ms}, key=str.upper)
            out.append({"key": " / ".join(spellings[:3]) + (" ..." if len(spellings) > 3 else ""),
                        "reason": f"{len(ks)} spellings", "members": sorted(ms, key=lambda m: m["name"].upper())})
    if search and search.strip():
        s = search.strip().lower()
        out = [g for g in out if any(s in (m["name"] + " " + m["mobile"] + " " + m["membership_no"] + " " + m["old_no"]).lower() for m in g["members"])]
    out.sort(key=lambda g: (-len(g["members"]), g["key"].upper()))
    return out


def groups_xlsx(groups: list) -> bytes:
    from openpyxl import Workbook

    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Duplicates")
    ws.append(["Group", "Why", "Name", "Membership no", "Old no", "Mobile", "Date of birth", "Father / husband", "Place", "Pincode", "District", "Gender", "Approval", "Status"])
    for n, g in enumerate(groups, 1):
        for m in g["members"]:
            ws.append([n, g["reason"], m["name"], m["membership_no"], m["old_no"], m["mobile"], m["dob"], m["father"], m["place"], m["pincode"], m["district"],
                       m["gender"], m["approval"], m["status"]])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
