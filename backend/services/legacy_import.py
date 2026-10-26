"""The old register (MstMember.xlsx) read as a dry run: what an import of it would do, and the reports about it.

Nothing is saved here. `build_plan` reads the rows, applies the import rules and returns the findings; `reports_xlsx`
puts them in one Excel file. The rules (agreed with the office):
  * CusNo is the OLD number, CusNoNew the new membership number (0 = none yet), CusNoOld a further reference;
  * up to 6 receipt lines per member; a line with a date but no number gets a dummy number FY43-001 (the last two
    digits of the financial year, then a running number) and keeps its amount (0 when there is none);
  * receipts before 1943 or after today are wrong dates and are not imported (the member is);
  * one receipt number is unique inside a financial year: lines with the same number and the same date are ONE
    receipt shared by several members, the same number on another date gets a dummy number;
  * the payment is judged at the price on the date of the member's latest receipt, as everywhere in the system.
"""
import io
import re
from collections import Counter, defaultdict
from datetime import date, datetime
from typing import Any, Optional

FIRST_YEAR = 1943          # the Sabha began in 1943: no receipt can be older
SLOTS = range(1, 7)
TYPE_FIXES = {"POSHAK": "POSHAKA", "AJEEV": "AJEEVA", "A": "AJEEVA"}   # typos in the old register ("A" is a guess)
SAMPLE = 25


def _s(v) -> str:
    return re.sub(r"\s+", " ", str(v)).strip() if v is not None else ""


def _num(v) -> float:
    try:
        return float(v) if v not in (None, "", " ") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _as_date(v) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    return v if isinstance(v, date) else None


def financial_year_start(d: date) -> int:
    return d.year if d.month >= 4 else d.year - 1


def read_register(content: bytes) -> list:
    """The member rows of the register as dicts keyed by the column header."""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    it = ws.iter_rows(values_only=True)
    header = [_s(h) for h in next(it)]
    if "CusNo" not in header or "CusName" not in header:
        raise ValueError("This is not the member register: the columns CusNo and CusName are missing")
    return [dict(zip(header, row)) for row in it if any(c not in (None, "") for c in row)]


_SAME_WORDS = re.compile(r"\b(above|same|ditto|abv)\b", re.I)


def native_fields(r: dict, address: str) -> dict:
    """designation, native_address and native_same_as_current from the register. A short native address such as "AS ABOVE" or
    "same" means it is the communication address: the flag is set and the box holds a copy of that address."""
    native = " ".join(_lines(r.get("CusAddressNative")))
    out = {"designation": _s(r.get("CusDesignation"))[:150] or None, "native_address": None, "native_same_as_current": False}
    if native and len(native) <= 20 and _SAME_WORDS.search(native):
        out["native_same_as_current"] = True
        out["native_address"] = address or None
    elif native:
        out["native_address"] = native
    return out


def _norm_name(name: str) -> str:
    return re.sub(r"[^A-Z ]", "", name.upper().replace(".", " ")).replace("  ", " ").strip()


def build_plan(db, rows: list, today: Optional[date] = None) -> dict:
    from api.v1.endpoints.members import _GOTRA_ALIAS_KEYS, _NO_GOTRA, _clean_import_mobile, _clean_import_name, _gotra_key
    from models.masters import Gotra, MembershipType, MembershipTypePrice, NameTitle, PostalCode
    from models.members import Member, MemberMembership
    from models.receipts import Receipt
    from services import membership_credit

    today = today or date.today()
    types = {mt.name_en.strip().upper(): mt for mt in db.query(MembershipType).filter(MembershipType.is_deleted == False).all()}  # noqa: E712
    prices = db.query(MembershipTypePrice).filter(MembershipTypePrice.is_deleted == False).all()  # noqa: E712
    gotras = {_gotra_key(g.name_en) for g in db.query(Gotra).filter(Gotra.is_deleted == False, Gotra.status == True).all()}  # noqa: E712
    title_keys = {re.sub(r"[^A-Z]", "", t.upper()) for (t,) in db.query(NameTitle.name_en).filter(NameTitle.is_deleted == False, NameTitle.status == True).all()}  # noqa: E712
    pins = {p for (p,) in db.query(PostalCode.pincode).filter(PostalCode.is_deleted == False).all() if p}  # noqa: E712
    taken = {n.strip().upper() for (n,) in db.query(Member.membership_number).filter(Member.membership_number != None).all()}  # noqa: E711
    taken |= {n.strip().upper() for (n,) in db.query(MemberMembership.membership_number).filter(MemberMembership.membership_number != None).all()}  # noqa: E711
    dummy_used = defaultdict(int)       # FY code -> highest FYyy-nnn already in the database
    for (n,) in db.query(Receipt.receipt_number).filter(Receipt.receipt_number.like("FY%-%")).all():
        m = re.fullmatch(r"FY(\d\d)-(\d+)", n or "")
        if m:
            dummy_used[m.group(1)] = max(dummy_used[m.group(1)], int(m.group(2)))

    members, problems = [], []
    new_numbers = Counter()
    for r in rows:
        new_no = int(_num(r.get("CusNoNew")))
        if new_no > 0:
            new_numbers[new_no] += 1

    def problem(m, what):
        problems.append({"old_no": m["old_no"], "new_no": m["new_no"] or "", "name": m["name"], "problem": what})

    for r in rows:
        old_no = int(_num(r.get("CusNo")))
        new_no = int(_num(r.get("CusNoNew"))) or None
        raw_type = _s(r.get("CusMemberType")).upper()
        type_key = TYPE_FIXES.get(raw_type, raw_type)
        mobile = None
        for col in ("CusMobile", "CusMobile1", "CusMobile2"):
            mobile, _w = _clean_import_mobile(_s(r.get(col)))
            if mobile:
                break
        m = {
            "old_no": old_no, "new_no": new_no, "ref_no": int(_num(r.get("CusNoOld"))) or None,
            "name": _clean_import_name(r.get("CusName")), "title": _s(r.get("CusTitle")),
            "type": types.get(type_key), "type_text": raw_type, "mobile": mobile,
            "mobile_text": _s(r.get("CusMobile")), "pin": _s(r.get("CusPinCode")),
            "deleted": _s(r.get("DeleteMark")) == "*", "expired": _s(r.get("CusStatus")).lower() == "expired",
            "magazine": _s(r.get("CusMagazine")), "online": _s(r.get("CusOnline")),
            "returned": sum(1 for j in range(1, 13) if _s(r.get(f"CusMagazineReturned{j}"))),
            "lines": [],
        }
        members.append(m)
        if not m["name"]:
            problem(m, "No name")
        if raw_type in TYPE_FIXES:
            problem(m, f"Type '{raw_type}' read as {type_key.title()}" + (" (a guess)" if raw_type == "A" else ""))
        if m["type"] is None and raw_type not in TYPE_FIXES:
            problem(m, f"Membership type '{raw_type}' is not a type in the system")
        elif m["type"] is None:
            problem(m, f"Membership type '{type_key}' is not a type in the system")
        if m["mobile_text"] and not mobile:
            problem(m, f"Mobile '{m['mobile_text']}' is not a usable mobile number (kept as the raw value)")
        if m["title"] and title_keys and re.sub(r"[^A-Z]", "", m["title"].upper()) not in title_keys:
            problem(m, f"Title '{m['title']}' is not in the Name Titles master")
        g = _clean_import_name(r.get("CusGotra"))
        if g.upper() not in _NO_GOTRA:
            k = _gotra_key(g)
            if _GOTRA_ALIAS_KEYS.get(k, k) not in gotras:
                problem(m, f"Gotra '{g}' is not in the Gotra master")
        if m["pin"] and m["pin"] not in pins:
            problem(m, f"PIN code '{m['pin']}' is not in the postal codes master")
        if new_no:
            if new_numbers[new_no] > 1:
                problem(m, f"New number {new_no} is used by {new_numbers[new_no]} members in the file")
            if str(new_no).upper() in taken:
                problem(m, f"New number {new_no} already exists in the system")

        # receipt lines
        for j in SLOTS:
            no, dt = r.get(f"CusReceiptNo{j}"), r.get(f"CusReceiptDate{j}")
            mem, up = _num(r.get(f"CusMemAmt{j}")), _num(r.get(f"CusMemUpAmt{j}"))
            extra = sum(_num(r.get(f"{c}{j}")) for c in ("CusScholarAmt", "CusDon1Amt", "CusDon2Amt", "CusDon3Amt"))
            number = _s(no) if no not in (0, None, "", " ", "0") else ""
            has_money = bool(mem or up or extra)
            if not (number or dt or has_money):
                continue
            d = _as_date(dt)
            line = {"old_no": old_no, "name": m["name"], "slot": j, "number": number, "date": d, "raw_date": _s(dt),
                    "membership": mem, "upgrade": up, "other": extra, "note": _s(r.get(f"CusReceiptNote{j}")), "kind": "OK",
                    "scholarship": _num(r.get(f"CusScholarAmt{j}")),
                    "donation": sum(_num(r.get(f"CusDon{k}Amt{j}")) for k in (1, 2, 3))}
            m["lines"].append(line)

    # --- receipts: wrong dates, missing dates, shared and repeated numbers, dummy numbers
    wrong_dates, no_dates = [], []
    lines = [(m, ln) for m in members for ln in m["lines"]]
    importable = []
    for m, ln in lines:
        d = ln["date"]
        if d is None:
            ln["kind"] = "NO_DATE"
            no_dates.append(ln)
        elif d.year < FIRST_YEAR or d > today:
            ln["kind"] = "WRONG_DATE"
            wrong_dates.append({**ln, "why": "before 1943" if d.year < FIRST_YEAR else "in the future"})
        else:
            importable.append((m, ln))

    by_number = defaultdict(list)
    for m, ln in importable:
        if ln["number"]:
            by_number[(financial_year_start(ln["date"]), ln["number"])].append(ln)
    shared, conflicts = [], []
    for key, group in by_number.items():
        first_date = Counter(g["date"] for g in group).most_common(1)[0][0]
        on_first = [g for g in group if g["date"] == first_date]
        if len(on_first) > 1:   # one receipt shared by several members
            shared.append({"fy": key[0], "number": key[1], "date": first_date, "members": [g["old_no"] for g in on_first]})
        for ln in group:
            if ln["date"] != first_date:
                ln["kind"] = "NUMBER_TAKEN"
                conflicts.append({**ln, "fy": key[0], "why": f"number {key[1]} is used on {first_date:%d-%m-%Y} in the same financial year"})

    dummies = []
    seq = defaultdict(int, dummy_used)
    for m, ln in sorted(importable, key=lambda p: (p[1]["date"], p[1]["old_no"], p[1]["slot"])):
        if ln["kind"] in ("NUMBER_TAKEN",) or not ln["number"]:
            if ln["kind"] != "NUMBER_TAKEN":
                ln["kind"] = "NO_NUMBER"
            code = f"{financial_year_start(ln['date']) % 100:02d}"
            seq[code] += 1
            ln["dummy"] = f"FY{code}-{seq[code]:03d}"
            dummies.append({**ln, "reason": ("number already used on another date" if ln["kind"] == "NUMBER_TAKEN"
                                             else "no receipt number" + (", no amount" if not (ln["membership"] or ln["upgrade"] or ln["other"]) else ""))})
        elif not (ln["membership"] or ln["upgrade"] or ln["other"]):
            ln["kind"] = "NO_AMOUNT"

    zero_amount = [ln for _m, ln in importable if ln["kind"] == "NO_AMOUNT"]

    # --- payments: the price on the date of the latest receipt against what was paid
    mismatches, no_receipt, no_price = [], [], []
    for m in members:
        if m["deleted"] or m["type"] is None:
            continue
        good = [ln for ln in m["lines"] if ln["kind"] not in ("WRONG_DATE", "NO_DATE")]
        if not good:
            no_receipt.append({"old_no": m["old_no"], "new_no": m["new_no"] or "", "name": m["name"], "type": m["type"].name_en})
            continue
        ref = max(ln["date"] for ln in good)
        row = membership_credit._price_on(prices, m["type"].id, ref)
        paid = sum(ln["membership"] + ln["upgrade"] for ln in good)
        info = {"old_no": m["old_no"], "new_no": m["new_no"] or "", "name": m["name"], "type": m["type"].name_en,
                "last_receipt": ref, "paid": paid}
        if row is None:
            no_price.append(info)
        elif paid + 0.005 < float(row.amount):
            mismatches.append({**info, "price_then": float(row.amount), "short_by": round(float(row.amount) - paid, 2)})

    # --- duplicates
    by_mobile, by_name = defaultdict(list), defaultdict(list)
    for m in members:
        if m["deleted"]:
            continue
        if m["mobile"]:
            by_mobile[m["mobile"]].append(m)
        if m["name"]:
            by_name[_norm_name(m["name"])].append(m)
    dup_mobile, dup_name = [], []
    for mob, g in by_mobile.items():
        if len(g) > 1:
            same = len({_norm_name(x["name"]) for x in g}) < len(g)
            for x in g:
                dup_mobile.append({"mobile": mob, "old_no": x["old_no"], "new_no": x["new_no"] or "", "name": x["name"], "pin": x["pin"],
                                   "same_name_in_group": "YES" if same else ""})
    for nm, g in by_name.items():
        if len(g) > 1 and nm:
            mobiles = Counter(x["mobile"] for x in g if x["mobile"])
            for x in g:
                dup_name.append({"name": x["name"], "old_no": x["old_no"], "new_no": x["new_no"] or "", "mobile": x["mobile"] or "", "pin": x["pin"],
                                 "same_mobile": "YES" if x["mobile"] and mobiles[x["mobile"]] > 1 else ""})

    counts = Counter()
    for m in members:
        counts["members"] += 1
        counts["deleted"] += m["deleted"]
        counts["expired"] += m["expired"]
        counts["with_new_number"] += bool(m["new_no"])
        counts["without_new_number"] += not m["new_no"]
        counts["magazine_yes"] += m["magazine"].lower() == "yes"
        counts["magazine_online"] += m["online"].lower() == "online"
        counts["magazine_returned_marks"] += m["returned"]
        counts["type_" + (m["type"].name_en if m["type"] else "UNKNOWN")] += 1
    counts["receipt_lines"] = len(lines)
    counts["receipts_to_import"] = len(importable)
    counts["receipts_dummy_number"] = len(dummies)
    counts["receipts_zero_amount"] = len(zero_amount)
    counts["receipts_shared_by_members"] = len(shared)
    counts["receipts_wrong_date"] = len(wrong_dates)
    counts["receipts_no_date"] = len(no_dates)
    counts["members_payment_mismatch"] = len(mismatches)
    counts["members_no_receipt"] = len(no_receipt)
    counts["members_no_price_for_date"] = len(no_price)
    counts["duplicate_mobile_members"] = len(dup_mobile)
    counts["duplicate_name_members"] = len(dup_name)
    counts["members_with_problems"] = len({p["old_no"] for p in problems})

    return {
        "counts": dict(counts), "problems": problems, "dummies": dummies, "zero_amount": zero_amount, "shared": shared,
        "conflicts": conflicts, "wrong_dates": wrong_dates, "no_dates": no_dates, "mismatches": mismatches,
        "no_receipt": no_receipt, "no_price": no_price, "dup_mobile": dup_mobile, "dup_name": dup_name,
        "members": members,   # the members with their classified receipt lines, for the receipts import
    }


def _line_row(ln: dict) -> list:
    return [ln["old_no"], ln["name"], ln["slot"], ln.get("number") or "", ln.get("dummy") or "", ln["date"] or ln.get("raw_date") or "",
            ln["membership"], ln["upgrade"], ln["other"]]


def reports_xlsx(plan: dict) -> bytes:
    """Every report as a sheet of one Excel file."""
    from openpyxl import Workbook

    wb = Workbook(write_only=True)

    def sheet(title, header, rows):
        ws = wb.create_sheet(title)
        ws.append(header)
        for r in rows:
            ws.append(r)

    sheet("Summary", ["What", "Count"], [[k, v] for k, v in plan["counts"].items()])
    line_head = ["Old no", "Name", "Slot", "Receipt no (sheet)", "Dummy no", "Date", "Membership amt", "Upgrade amt", "Other amt"]
    sheet("Dummy receipts", line_head + ["Reason"], [_line_row(d) + [d["reason"]] for d in plan["dummies"]])
    sheet("Zero amount", line_head, [_line_row(d) for d in plan["zero_amount"]])
    sheet("Shared receipts", ["Financial year", "Receipt no", "Date", "Members (old no)"],
          [[f"{s['fy']}-{str(s['fy'] + 1)[-2:]}", s["number"], s["date"], ", ".join(str(x) for x in s["members"])] for s in plan["shared"]])
    sheet("Number used twice", line_head + ["Why"], [_line_row(d) + [d["why"]] for d in plan["conflicts"]])
    sheet("Wrong dates", line_head + ["Why"], [_line_row(d) + [d["why"]] for d in plan["wrong_dates"]])
    sheet("No date", line_head, [_line_row(d) for d in plan["no_dates"]])
    sheet("Payment mismatch", ["Old no", "New no", "Name", "Type", "Last receipt", "Price then", "Paid", "Short by"],
          [[x["old_no"], x["new_no"], x["name"], x["type"], x["last_receipt"], x["price_then"], x["paid"], x["short_by"]] for x in plan["mismatches"]])
    sheet("No receipt", ["Old no", "New no", "Name", "Type"], [[x["old_no"], x["new_no"], x["name"], x["type"]] for x in plan["no_receipt"]])
    sheet("No price for date", ["Old no", "New no", "Name", "Type", "Last receipt", "Paid"],
          [[x["old_no"], x["new_no"], x["name"], x["type"], x["last_receipt"], x["paid"]] for x in plan["no_price"]])
    sheet("Duplicate mobile", ["Mobile", "Old no", "New no", "Name", "PIN", "Same name in group"],
          [[x["mobile"], x["old_no"], x["new_no"], x["name"], x["pin"], x["same_name_in_group"]] for x in sorted(plan["dup_mobile"], key=lambda x: x["mobile"])])
    sheet("Duplicate name", ["Name", "Old no", "New no", "Mobile", "PIN", "Same mobile"],
          [[x["name"], x["old_no"], x["new_no"], x["mobile"], x["pin"], x["same_mobile"]] for x in sorted(plan["dup_name"], key=lambda x: x["name"].upper())])
    sheet("Member problems", ["Old no", "New no", "Name", "Problem"], [[p["old_no"], p["new_no"], p["name"], p["problem"]] for p in plan["problems"]])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def summary_json(plan: dict) -> dict:
    """The counts and the first few lines of each report, for the screen."""
    def head(items):
        return [{k: (v.isoformat() if isinstance(v, date) else v) for k, v in it.items() if k not in ("lines",)} for it in items[:SAMPLE]]

    return {
        "counts": plan["counts"],
        "samples": {k: head(plan[k]) for k in ("dummies", "zero_amount", "shared", "conflicts", "wrong_dates", "no_dates", "mismatches",
                                               "no_receipt", "no_price", "problems")},
    }


# ───────────────────────── the member import ─────────────────────────
def _lines(text) -> list:
    return [re.sub(r"\s+", " ", ln.replace("`", "")).strip(" ,") for ln in str(text or "").replace("\r", "").split("\n") if ln.strip(" ,`")]


class _UserRef:
    """_record_import_run only needs the id of the user."""

    def __init__(self, user_id):
        self.id = user_id


def import_members(db, rows: list, user_id: int, *, run_id: str, file_name: str = "", batch: int = 500, progress=None) -> dict:
    """Create the members of the old register (members only: their receipts are a later step). Safe to run again: a member
    whose old number is already in the system is skipped. Each member is saved on its own, so one bad row never stops
    the rest; every problem is returned. The type is the register's, no automatic upgrade is run."""
    from datetime import timezone
    from api.v1.endpoints.members import (
        _GOTRA_ALIAS_KEYS, _NO_GOTRA, _clean_import_mobile, _clean_import_name, _gotra_key, _record_import_run,
    )
    from models.masters import Gotra, MembershipType, NameTitle, PostalCode, State
    from models.members import Member, MemberMembership
    from services.magazine_subscriptions import sync_member_magazine_subscription

    now = datetime.now(timezone.utc)
    types = {mt.name_en.strip().upper(): mt for mt in db.query(MembershipType).filter(MembershipType.is_deleted == False).all()}  # noqa: E712
    gotras = {}
    for g in db.query(Gotra).filter(Gotra.is_deleted == False, Gotra.status == True).all():  # noqa: E712
        gotras.setdefault(_gotra_key(g.name_en), g)
    titles = {re.sub(r"[^A-Z]", "", t.upper()): t for (t,) in db.query(NameTitle.name_en).filter(NameTitle.is_deleted == False).all()}  # noqa: E712
    states = {re.sub(r"[^A-Z]", "", s.name_en.upper()): s for s in db.query(State).filter(State.is_deleted == False).all()}  # noqa: E712
    wanted_pins = {_s(r.get("CusPinCode")) for r in rows}
    pins = {}
    for pc in db.query(PostalCode).filter(PostalCode.pincode.in_(wanted_pins), PostalCode.is_deleted == False).all():  # noqa: E712
        pins.setdefault(pc.pincode.strip(), pc)
    have_old = {n for (n,) in db.query(Member.old_membership_number).filter(Member.old_membership_number != None).all()}  # noqa: E711
    taken = {n.strip().upper() for (n,) in db.query(Member.membership_number).filter(Member.membership_number != None).all()}  # noqa: E711
    taken |= {n.strip().upper() for (n,) in db.query(MemberMembership.membership_number).filter(MemberMembership.membership_number != None).all()}  # noqa: E711

    created, skipped, warnings = 0, [], []
    deleted = expired = 0
    for n, r in enumerate(rows, 1):
        old_no = str(int(_num(r.get("CusNo"))))
        new_no = int(_num(r.get("CusNoNew"))) or None
        if old_no in have_old:
            skipped.append({"membership_number": old_no, "reason": "Already imported (old number exists)"})
            continue
        name = _clean_import_name(r.get("CusName"))
        if not name:
            skipped.append({"membership_number": old_no, "reason": "No name"})
            continue
        raw_type = _s(r.get("CusMemberType")).upper()
        mtype = types.get(TYPE_FIXES.get(raw_type, raw_type))
        if mtype is None:
            skipped.append({"membership_number": old_no, "reason": f"Membership type '{raw_type}' is not in the system"})
            continue
        notes, warn = [], []
        number = str(new_no) if new_no else None
        if number and number.upper() in taken:
            warn.append(f"New number {number} is already used by another member: left blank")
            notes.append(f"Old register new number {number} could not be used (already taken)")
            number = None
        mobile, mobile_warning = _clean_import_mobile(_s(r.get("CusMobile")))
        mobile_raw = None
        if mobile_warning:
            mobile_raw = _s(r.get("CusMobile"))[:50]
            warn.append(mobile_warning)
        alt = None
        for col in ("CusMobile1", "CusMobile2"):
            other, _w = _clean_import_mobile(_s(r.get(col)))
            if other and other != mobile:
                alt = other
                break
        if not mobile and alt:
            mobile, alt = alt, None
        if not alt and _s(r.get("CusPhone")):
            alt = _s(r.get("CusPhone"))[:20]
        parts = name.split(" ")
        first, middle, last = (parts[0], (" ".join(parts[1:-1]) or None), parts[-1]) if len(parts) > 1 else (name, None, None)
        title_raw = _s(r.get("CusTitle"))
        title = titles.get(re.sub(r"[^A-Z]", "", title_raw.upper()), title_raw)[:10] or None
        gotra_id = gotra_text = None
        g = _clean_import_name(r.get("CusGotra"))
        if g.upper() not in _NO_GOTRA:
            k = _gotra_key(g)
            master = gotras.get(_GOTRA_ALIAS_KEYS.get(k, k))
            if master:
                gotra_id, gotra_text = master.id, master.name_en
            else:
                warn.append(f"Gotra '{g}' is not in the Gotra master: left blank")
        pc = pins.get(_s(r.get("CusPinCode")))
        state = states.get(re.sub(r"[^A-Z]", "", _s(r.get("CusState")).upper()))
        addr = _lines(r.get("CusAddress"))
        status_text = _s(r.get("CusStatus")).lower()
        is_deleted = _s(r.get("DeleteMark")) == "*"
        for key in ("CusNote", "CusStatusNote"):
            if _lines(r.get(key)):
                notes.append(" ".join(_lines(r.get(key))))
        if is_deleted:
            notes.append("Marked deleted (*) in the old register")
        if status_text == "expired":
            exp_date = _as_date(r.get("CusExpDt"))
            notes.append("Expired in the old register" + (f" ({exp_date:%d-%m-%Y})" if exp_date else ""))
        relation, father_name = _s(r.get("CusRelation")), _s(r.get("CusNameFather"))
        father = f"{relation} {father_name}" if relation in ("S/O", "W/O", "D/O") and father_name else (father_name or None)
        online = _s(r.get("CusOnline")).lower() == "online"
        wants = _s(r.get("CusMagazine")).lower() == "yes"
        ref_no = int(_num(r.get("CusNoRef"))) or None
        email = _s(r.get("CusEmail")) or None
        legacy_ref = str(int(_num(r.get("CusNoOld")))) if _num(r.get("CusNoOld")) else None
        member = Member(
            membership_number=number, old_membership_number=old_no, legacy_ref_number=legacy_ref,
            name_title=title, full_name_en=name, first_name_en=first[:100], middle_name_en=(middle or None), last_name_en=(last or None),
            full_name_kn=_s(r.get("CusNameKannada")) or None, date_of_birth=_as_date(r.get("CusDoB")),
            blood_group=_s(r.get("CusBloodGroup"))[:10] or None, father_husband_name=father[:150] if father else None,
            gotra_id=gotra_id, gotra_text=gotra_text, email=email[:191] if email else None,
            mobile=mobile, mobile_raw=mobile_raw, alternate_mobile=alt,
            address_line1=(addr[0][:255] if addr else None), address_line2=(", ".join(addr[1:])[:255] if len(addr) > 1 else None),
            city=_s(r.get("CusCity"))[:150] or None, area=_s(r.get("CusArea"))[:150] or None, place=_s(r.get("CusPlace"))[:150] or None,
            grama=_s(r.get("CusGrama"))[:150] or None, village=_s(r.get("CusVillage"))[:150] or None, post=_s(r.get("CusPost"))[:150] or None,
            locality=(_s(r.get("CusPlace")) or _s(r.get("CusArea")) or _s(r.get("CusCity")))[:150] or None,
            label_point=_s(r.get("CusLabelPoint"))[:100] or None, address_remarks=" ".join(_lines(r.get("CusAddressRemarks"))) or None,
            country=("India" if _s(r.get("CusCountry")).upper() in ("", "INDIA") else _s(r.get("CusCountry")).title()),
            pincode_id=pc.id if pc else None, state_id=(pc.state_id if pc else (state.id if state else None)),
            district_id=pc.district_id if pc else None, taluk_id=pc.taluk_id if pc else None,
            referred_by_number=str(ref_no) if ref_no else None, referred_by_name=_s(r.get("CusNameRef"))[:150] or None,
            magazine_needed=wants, magazine_kind="EMAIL" if (wants and online) else ("PHYSICAL" if wants else None),
            magazine_email=(email if (wants and online) else None),
            remarks=" | ".join(notes) or None,
            **native_fields(r, ", ".join(addr)),
            approval_status="APPROVED", registration_status="APPROVED", registration_source="MIGRATION",
            member_status="INACTIVE" if (status_text == "expired" or is_deleted) else "ACTIVE", approved_at=now, created_by=user_id,
        )
        try:
            with db.begin_nested():
                db.add(member)
                db.flush()
                enrolled = _as_date(r.get("CusEnrolled"))
                stamp = datetime(enrolled.year, enrolled.month, enrolled.day, tzinfo=timezone.utc) if enrolled and FIRST_YEAR <= enrolled.year <= date.today().year else now
                exp = _as_date(r.get("CusExpDt"))
                db.add(MemberMembership(
                    member_id=member.id, membership_type_id=mtype.id, membership_number=number, status="ACTIVE",
                    applied_at=stamp, activated_at=stamp,
                    expires_at=datetime(exp.year, exp.month, exp.day, tzinfo=timezone.utc) if exp and FIRST_YEAR <= exp.year <= 2200 else None,
                    created_by=user_id,
                ))
                if wants and member.member_status == "ACTIVE":
                    sub = sync_member_magazine_subscription(db, member, user_id=user_id)
                    returned = [str(j) for j in range(1, 13) if _s(r.get(f"CusMagazineReturned{j}"))]
                    magazine_notes = " ".join(_lines(r.get("CusNoteMagazine")))
                    note = " | ".join(x for x in (magazine_notes, ("Returned issues marked in the old register: " + ", ".join(returned)) if returned else "") if x)
                    if sub is not None and note:
                        sub.notes = note[:2000]
        except Exception as exc:  # this member only
            skipped.append({"membership_number": old_no, "reason": f"Could not be saved: {str(exc)[:160]}"})
            continue
        have_old.add(old_no)
        if number:
            taken.add(number.upper())
        created += 1
        deleted += is_deleted
        expired += status_text == "expired"
        for w in warn:
            warnings.append({"membership_number": old_no, "warning": w})
        if n % batch == 0:
            db.commit()
            if progress:
                progress(n, created)
    _record_import_run(db, _UserRef(user_id), run_id=run_id, file_name=file_name, total_rows=len(rows), batch_rows=len(rows), created=created,
                       skipped=skipped, skip_duplicates=True, warnings=warnings)
    db.commit()
    return {"created": created, "skipped": len(skipped), "deleted": deleted, "expired": expired, "warnings": len(warnings),
            "skipped_list": skipped[:300], "warning_list": warnings[:300]}


# ───────────────────────── the receipts import ─────────────────────────
SOURCE = "OLD_REGISTER"   # receipts.source of everything this import creates: it finds them again and never repeats a member


def _particulars(db, user_id: int) -> dict:
    """The particulars the lines point to; Scholarship with its sub type General is created when it is not there yet."""
    from sqlalchemy import func
    from core.rules import make_code
    from models.masters import Particular

    def find(name, parent_id=None):
        q = db.query(Particular).filter(Particular.is_deleted == False, func.upper(Particular.name_en) == name.upper())  # noqa: E712
        return q.filter(Particular.parent_id == parent_id).first() if parent_id else q.filter(Particular.parent_id.is_(None)).first()

    def make(name, parent_id=None, **flags):
        row = Particular(code=make_code(name), name_en=name, parent_id=parent_id, status=True, created_by=user_id, **flags)
        db.add(row)
        db.flush()
        return row

    membership = find("Membership")
    if membership is None:
        raise RuntimeError("The Membership particular is missing")
    donation = find("Donation") or make("Donation")
    general_donation = find("General Donation", donation.id) or make("General Donation", donation.id)
    scholarship = find("Scholarship") or make("Scholarship")
    general_scholarship = find("General", scholarship.id) or make("General", scholarship.id)
    return {"membership": membership, "donation": donation, "general_donation": general_donation,
            "scholarship": scholarship, "general_scholarship": general_scholarship}


def import_receipts(db, rows: list, user_id: int, *, progress=None, batch: int = 500) -> dict:
    """Create the receipts of the old register for the members already imported. Lines with no date are not imported (the
    office chose to ignore them) and neither are dates before 1943 or in the future: they are returned in the lists.
    A receipt number is kept; with none (or one already used on another date that year) the receipt gets FY43-001 and is
    marked unknown. One number on one date for several members is one receipt shared by them. The members' types are
    never changed. A member who already has receipts from this import is left out, so the run can be repeated."""
    from sqlalchemy import func
    from models.members import Member
    from models.receipts import Receipt, ReceiptAllocation, ReceiptItem
    from services import receipt_numbers

    plan = build_plan(db, rows)
    ids = {o: (i, mno, nm) for o, i, mno, nm in
           db.query(Member.old_membership_number, Member.id, Member.membership_number, Member.full_name_en).filter(Member.old_membership_number != None).all()}  # noqa: E711
    # lines of this import that are already in: (member, date, number); a dummy-numbered one is (member, date, "")
    have = {(m, d, "" if old else n) for m, d, n, old in db.query(ReceiptAllocation.member_id, Receipt.receipt_date, Receipt.receipt_number, Receipt.is_old_receipt)
            .join(Receipt, Receipt.id == ReceiptAllocation.receipt_id).filter(Receipt.source == SOURCE, Receipt.is_deleted == False).all()}  # noqa: E712

    def next_dummy(fy_start: int) -> str:
        code = f"{fy_start % 100:02d}"
        top = max((int(m.group(1)) for (n,) in db.query(Receipt.receipt_number).filter(Receipt.receipt_number.like(f"FY{code}-%")).all()
                   for m in [re.fullmatch(r"FY\d\d-(\d+)", n or "")] if m), default=0)
        return f"FY{code}-{top + 1:03d}"
    p = _particulars(db, user_id)

    groups, order = {}, []
    ignored, not_imported = [], []
    for m in plan["members"]:
        mid = ids.get(str(m["old_no"]))
        for ln in m["lines"]:
            if ln["kind"] in ("NO_DATE", "WRONG_DATE"):
                (ignored if ln["kind"] == "NO_DATE" else not_imported).append({k: v for k, v in ln.items()})
                continue
            if mid is None:
                not_imported.append({**ln, "why": "member is not imported yet"})
                continue
            real = bool(ln["number"]) and ln["kind"] != "NUMBER_TAKEN"
            if (mid[0], ln["date"], ln["number"] if real else "") in have:
                continue
            key = (financial_year_start(ln["date"]), ln["number"], ln["date"]) if real else ("dummy", ln["old_no"], ln["slot"])
            if key not in groups:
                groups[key] = []
                order.append(key)
            groups[key].append((mid, ln))

    created = shared = dummy = zero = 0
    skipped = []
    for n, key in enumerate(sorted(order, key=lambda k: (groups[k][0][1]["date"], str(k))), 1):
        members = groups[key]
        first = members[0][1]
        number = first["number"] if key[0] != "dummy" else first["dummy"]
        mem = sum(l["membership"] for _m, l in members)
        up = sum(l["upgrade"] for _m, l in members)
        sch = sum(l["scholarship"] for _m, l in members)
        don = sum(l["donation"] for _m, l in members)
        total = mem + up + sch + don
        if mem + up > 0 or total == 0:
            rtype = "MEMBERSHIP"
        else:
            rtype = "SCHOLARSHIP" if sch > 0 and don == 0 else "GENERAL_DONATION"
        notes = " | ".join(dict.fromkeys(x for x in [l["note"] for _m, l in members] if x))
        fy = receipt_numbers.financial_year_for(first["date"])
        # a receipt of this number already made by an earlier run (a shared receipt whose first member was done then): the
        # members still missing are added to it
        earlier = None if key[0] == "dummy" else (
            db.query(Receipt).filter(Receipt.financial_year == fy, Receipt.receipt_number == number, Receipt.source == SOURCE,
                                     Receipt.is_deleted == False).first())  # noqa: E712
        dummy_now = key[0] == "dummy"
        if earlier is not None and earlier.receipt_date != first["date"]:
            # the number belongs to another date that year (an earlier run saw fewer members): this one becomes an unknown receipt
            number, earlier, dummy_now = next_dummy(financial_year_start(first["date"])), None, True
        if earlier is None and not dummy_now and db.query(Receipt.id).filter(Receipt.financial_year == fy, Receipt.receipt_number == number).first():
            # the number is held by a receipt that is not from this import (one entered in the system): an unknown receipt instead
            number, dummy_now = next_dummy(financial_year_start(first["date"])), True
        if earlier is not None:
            try:
                with db.begin_nested():
                    for (mid, _mno, _name), ln in members:
                        own = ln["membership"] + ln["upgrade"] + ln["scholarship"] + ln["donation"]
                        db.add(ReceiptAllocation(receipt_id=earlier.id, member_id=mid, allocated_amount=(ln["membership"] + ln["upgrade"] or own), created_by=user_id))
                    next_line = (db.query(func.max(ReceiptItem.line_no)).filter(ReceiptItem.receipt_id == earlier.id).scalar() or 0) + 1
                    db.add(ReceiptItem(receipt_id=earlier.id, item_type="MEMBERSHIP", particular_id=p["membership"].id, particular_name=p["membership"].name_en,
                                       description="Added from the old register (same receipt)", amount=mem + up, line_no=next_line,
                                       pays_for_membership=bool(p["membership"].pays_for_membership), created_by=user_id))
                    earlier.gross_amount = float(earlier.gross_amount) + mem + up
                    earlier.net_amount = float(earlier.net_amount) + mem + up
            except Exception as exc:
                skipped.append({"receipt": number, "date": str(first["date"]), "members": [m[0][0] for m in members], "reason": str(exc)[:200]})
                continue
            created += 1
            shared += 1
            continue
        try:
            with db.begin_nested():
                r = Receipt(
                    receipt_number=number, receipt_date=first["date"], financial_year=fy, receipt_type=rtype,
                    payer_name=members[0][0][2], payer_membership_no=members[0][0][1], payment_mode="OTHER",
                    gross_amount=total, discount_amount=0, net_amount=total, payment_status="SUCCESS", source=SOURCE,
                    is_old_receipt=dummy_now, notes=("Old register" + (f": {notes}" if notes else "")), receipt_status="ASSIGNED",
                    created_by=user_id,
                )
                db.add(r)
                db.flush()
                line_no = 0

                def item(item_type, particular, sub, amount, description=None):
                    nonlocal line_no
                    line_no += 1
                    db.add(ReceiptItem(
                        receipt_id=r.id, item_type=item_type, particular_id=particular.id, particular_name=particular.name_en,
                        sub_particular_id=sub.id if sub else None, sub_particular_name=sub.name_en if sub else None,
                        description=description, amount=amount, line_no=line_no,
                        pays_for_membership=bool(particular.pays_for_membership), created_by=user_id))

                if mem > 0 or total == 0:
                    item("MEMBERSHIP", p["membership"], None, mem, "Shared by %d members" % len(members) if len(members) > 1 else None)
                if up > 0:
                    item("TYPE_CHANGE", p["membership"], None, up, "Upgrade amount (old register)")
                if sch > 0:
                    item("SCHOLARSHIP", p["scholarship"], p["general_scholarship"], sch, notes or None)
                if don > 0:
                    item("DONATION", p["donation"], p["general_donation"], don, notes or None)
                for (mid, mno, _name), ln in members:
                    own = ln["membership"] + ln["upgrade"] + ln["scholarship"] + ln["donation"]
                    # on a receipt shared by several members each one is given the membership money of their own line
                    share = own if len(members) == 1 else (ln["membership"] + ln["upgrade"] or own)
                    db.add(ReceiptAllocation(receipt_id=r.id, member_id=mid, allocated_amount=share, created_by=user_id))
        except Exception as exc:   # this receipt only
            skipped.append({"receipt": number, "date": str(first["date"]), "members": [m[0][0] for m in members], "reason": str(exc)[:200]})
            continue
        created += 1
        shared += len(members) > 1
        dummy += dummy_now
        zero += total == 0
        if n % batch == 0:
            db.commit()
            if progress:
                progress(n, created)
    db.commit()
    return {"created": created, "shared": shared, "dummy": dummy, "zero_amount": zero, "skipped": len(skipped), "skipped_list": skipped[:200],
            "ignored_undated": len(ignored), "not_imported_other": len(not_imported), "plan": plan,
            "ignored_list": ignored, "not_imported_list": not_imported}


def backfill_native(db, rows: list, *, batch: int = 1000) -> dict:
    """Fill designation and the native address on the members already imported (matched by the old number). Only empty
    fields are written, so anything the office typed since is kept. Safe to repeat."""
    from models.members import Member

    done = untouched = missing = 0
    by_old = {o: i for o, i in db.query(Member.old_membership_number, Member.id).filter(Member.old_membership_number != None).all()}  # noqa: E711
    for n, r in enumerate(rows, 1):
        mid = by_old.get(_s(r.get("CusNo")))
        if mid is None:
            missing += 1
            continue
        m = db.get(Member, mid)
        addr = ", ".join(x for x in (m.address_line1, m.address_line2) if x)
        want = native_fields(r, addr)
        changed = False
        if want["designation"] and not m.designation:
            m.designation, changed = want["designation"], True
        if want["native_address"] and not m.native_address:
            m.native_address, m.native_same_as_current, changed = want["native_address"], want["native_same_as_current"], True
        done += changed
        untouched += not changed
        if n % batch == 0:
            db.commit()
    db.commit()
    return {"updated": done, "unchanged": untouched, "not_found": missing}
