"""The old register (MstMember.xlsx) read as a dry run: what an import of it would do, and the reports about it.

Nothing is saved here. `build_plan` reads the rows, applies the import rules and returns the findings; `reports_xlsx`
puts them in one Excel file. The rules (agreed with the office):
  * CusNo is the membership number, CusNoOld the old number (0 = none), CusNoNew is not used;
  * the upgrade column (CusMemUpAmt) is Patrika Nidhi money, whatever the year or the amount (the office confirmed): it is a
    Donation > Patrika Nidhi line and never counts as membership. Membership is the membership column (CusMemAmt) only;
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

# the old register wrote Patrika Nidhi (the magazine fund) payments in the upgrade or the donation column with this note
_PATRIKA = re.compile(r"patrika|\bp\.?\s*nidhi\b", re.I)
_KANNADA = re.compile("[\u0C80-\u0CFF]")
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
    if "CusNameKannada" not in header:
        # the Unicode copy of the register has this heading converted with the names (letters turned into Kannada): it is the
        # only heading with Kannada letters in it
        header = ["CusNameKannada" if _KANNADA.search(h) else h for h in header]
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
    # numbers of members that this import did not make (its own members are the register's members, not clashes)
    taken = {n.strip().upper() for (n,) in db.query(Member.membership_number).filter(Member.membership_number != None, Member.registration_source != "MIGRATION").all()}  # noqa: E711
    taken |= {n.strip().upper() for (n,) in db.query(MemberMembership.membership_number).join(Member, Member.id == MemberMembership.member_id)
              .filter(MemberMembership.membership_number != None, Member.registration_source != "MIGRATION").all()}  # noqa: E711
    dummy_used = defaultdict(int)       # FY code -> highest FYyy-nnn already in the database
    for (n,) in db.query(Receipt.receipt_number).filter(Receipt.receipt_number.like("FY%-%")).all():
        m = re.fullmatch(r"FY(\d\d)-(\d+)", n or "")
        if m:
            dummy_used[m.group(1)] = max(dummy_used[m.group(1)], int(m.group(2)))

    members, problems = [], []
    numbers = Counter(int(_num(r.get("CusNo"))) for r in rows)

    def problem(m, what):
        problems.append({"cus_no": m["cus_no"], "old_no": m["old_no"] or "", "name": m["name"], "problem": what})

    for r in rows:
        cus_no_raw = _num(r.get("CusNo"))
        old_no_raw = _num(r.get("CusNoOld"))
        if cus_no_raw == 0 and old_no_raw != 0:
            cus_no = int(old_no_raw)
        else:
            cus_no = int(cus_no_raw)
        old_no = int(old_no_raw) or None
        raw_type = _s(r.get("CusMemberType")).upper()
        type_key = TYPE_FIXES.get(raw_type, raw_type)
        mobile = None
        for col in ("CusMobile", "CusMobile1", "CusMobile2"):
            mobile, _w = _clean_import_mobile(_s(r.get(col)))
            if mobile:
                break
        m = {
            "cus_no": cus_no, "old_no": old_no,
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
        if numbers[cus_no] > 1:
            problem(m, f"Membership number {cus_no} is used by {numbers[cus_no]} members in the file")
        if str(cus_no) in taken:
            problem(m, f"Membership number {cus_no} already exists in the system")

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
            line = {"cus_no": cus_no, "name": m["name"], "slot": j, "number": number, "date": d, "raw_date": _s(dt),
                    "membership": mem, "upgrade": up, "other": extra, "note": _s(r.get(f"CusReceiptNote{j}")), "kind": "OK",
                    "scholarship": _num(r.get(f"CusScholarAmt{j}")),
                    "donation": sum(_num(r.get(f"CusDon{k}Amt{j}")) for k in (1, 2, 3)), "patrika": 0.0}
            line["patrika"], line["upgrade"] = line["upgrade"], 0.0       # the upgrade column is Patrika Nidhi
            if _PATRIKA.search(line["note"]):
                line["patrika"], line["donation"] = line["patrika"] + line["donation"], 0.0
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
            shared.append({"fy": key[0], "number": key[1], "date": first_date, "members": [g["cus_no"] for g in on_first]})
        for ln in group:
            if ln["date"] != first_date:
                ln["kind"] = "NUMBER_TAKEN"
                conflicts.append({**ln, "fy": key[0], "why": f"number {key[1]} is used on {first_date:%d-%m-%Y} in the same financial year"})

    dummies = []
    seq = defaultdict(int, dummy_used)
    for m, ln in sorted(importable, key=lambda p: (p[1]["date"], p[1]["cus_no"], p[1]["slot"])):
        if ln["kind"] in ("NUMBER_TAKEN",) or not ln["number"]:
            if ln["kind"] != "NUMBER_TAKEN":
                ln["kind"] = "NO_NUMBER"
            code = f"{financial_year_start(ln['date']) % 100:02d}"
            seq[code] += 1
            ln["dummy"] = f"FY{code}-{seq[code]:03d}"
            dummies.append({**ln, "reason": ("number already used on another date" if ln["kind"] == "NUMBER_TAKEN"
                                             else "no receipt number" + (", no amount" if not (ln["membership"] or ln["upgrade"] or ln["other"]) else ""))})
        elif not (ln["membership"] or ln["upgrade"] or ln["other"] or ln["patrika"]):
            ln["kind"] = "NO_AMOUNT"

    zero_amount = [ln for _m, ln in importable if ln["kind"] == "NO_AMOUNT"]

    # --- payments: the price on the date of the latest receipt against what was paid
    mismatches, no_receipt, no_price = [], [], []
    for m in members:
        if m["deleted"] or m["type"] is None:
            continue
        good = [ln for ln in m["lines"] if ln["kind"] not in ("WRONG_DATE", "NO_DATE")]
        if not good:
            no_receipt.append({"cus_no": m["cus_no"], "old_no": m["old_no"] or "", "name": m["name"], "type": m["type"].name_en})
            continue
        ref = max(ln["date"] for ln in good)
        row = membership_credit._price_on(prices, m["type"].id, ref)
        paid = sum(ln["membership"] + ln["upgrade"] for ln in good)
        info = {"cus_no": m["cus_no"], "old_no": m["old_no"] or "", "name": m["name"], "type": m["type"].name_en,
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
                dup_mobile.append({"mobile": mob, "cus_no": x["cus_no"], "old_no": x["old_no"] or "", "name": x["name"], "pin": x["pin"],
                                   "same_name_in_group": "YES" if same else ""})
    for nm, g in by_name.items():
        if len(g) > 1 and nm:
            mobiles = Counter(x["mobile"] for x in g if x["mobile"])
            for x in g:
                dup_name.append({"name": x["name"], "cus_no": x["cus_no"], "old_no": x["old_no"] or "", "mobile": x["mobile"] or "", "pin": x["pin"],
                                 "same_mobile": "YES" if x["mobile"] and mobiles[x["mobile"]] > 1 else ""})

    counts = Counter()
    for m in members:
        counts["members"] += 1
        counts["deleted"] += m["deleted"]
        counts["expired"] += m["expired"]
        counts["with_old_number"] += bool(m["old_no"])
        counts["without_old_number"] += not m["old_no"]
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
    counts["members_with_problems"] = len({p["cus_no"] for p in problems})

    return {
        "counts": dict(counts), "problems": problems, "dummies": dummies, "zero_amount": zero_amount, "shared": shared,
        "conflicts": conflicts, "wrong_dates": wrong_dates, "no_dates": no_dates, "mismatches": mismatches,
        "no_receipt": no_receipt, "no_price": no_price, "dup_mobile": dup_mobile, "dup_name": dup_name,
        "members": members,   # the members with their classified receipt lines, for the receipts import
    }


def _line_row(ln: dict) -> list:
    return [ln["cus_no"], ln["name"], ln["slot"], ln.get("number") or "", ln.get("dummy") or "", ln["date"] or ln.get("raw_date") or "",
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
    line_head = ["Membership no", "Name", "Slot", "Receipt no (sheet)", "Dummy no", "Date", "Membership amt", "Upgrade amt", "Other amt"]
    sheet("Dummy receipts", line_head + ["Reason"], [_line_row(d) + [d["reason"]] for d in plan["dummies"]])
    sheet("Zero amount", line_head, [_line_row(d) for d in plan["zero_amount"]])
    sheet("Shared receipts", ["Financial year", "Receipt no", "Date", "Members (old no)"],
          [[f"{s['fy']}-{str(s['fy'] + 1)[-2:]}", s["number"], s["date"], ", ".join(str(x) for x in s["members"])] for s in plan["shared"]])
    sheet("Number used twice", line_head + ["Why"], [_line_row(d) + [d["why"]] for d in plan["conflicts"]])
    sheet("Wrong dates", line_head + ["Why"], [_line_row(d) + [d["why"]] for d in plan["wrong_dates"]])
    sheet("No date", line_head, [_line_row(d) for d in plan["no_dates"]])
    sheet("Payment mismatch", ["Membership no", "Old no", "Name", "Type", "Last receipt", "Price then", "Paid", "Short by"],
          [[x["cus_no"], x["old_no"], x["name"], x["type"], x["last_receipt"], x["price_then"], x["paid"], x["short_by"]] for x in plan["mismatches"]])
    sheet("No receipt", ["Membership no", "Old no", "Name", "Type"], [[x["cus_no"], x["old_no"], x["name"], x["type"]] for x in plan["no_receipt"]])
    sheet("No price for date", ["Membership no", "Old no", "Name", "Type", "Last receipt", "Paid"],
          [[x["cus_no"], x["old_no"], x["name"], x["type"], x["last_receipt"], x["paid"]] for x in plan["no_price"]])
    sheet("Duplicate mobile", ["Mobile", "Membership no", "Old no", "Name", "PIN", "Same name in group"],
          [[x["mobile"], x["cus_no"], x["old_no"], x["name"], x["pin"], x["same_name_in_group"]] for x in sorted(plan["dup_mobile"], key=lambda x: x["mobile"])])
    sheet("Duplicate name", ["Name", "Membership no", "Old no", "Mobile", "PIN", "Same mobile"],
          [[x["name"], x["cus_no"], x["old_no"], x["mobile"], x["pin"], x["same_mobile"]] for x in sorted(plan["dup_name"], key=lambda x: x["name"].upper())])
    sheet("Member problems", ["Membership no", "Old no", "Name", "Problem"], [[p["cus_no"], p["old_no"], p["name"], p["problem"]] for p in plan["problems"]])
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
    have_no = {n for (n,) in db.query(Member.membership_number).filter(Member.registration_source == "MIGRATION", Member.membership_number != None).all()}  # noqa: E711
    taken = {n.strip().upper() for (n,) in db.query(Member.membership_number).filter(Member.membership_number != None).all()}  # noqa: E711
    taken |= {n.strip().upper() for (n,) in db.query(MemberMembership.membership_number).filter(MemberMembership.membership_number != None).all()}  # noqa: E711

    created, skipped, warnings = 0, [], []
    deleted = expired = 0
    for n, r in enumerate(rows, 1):
        cus_no_raw = _num(r.get("CusNo"))
        old_no_raw = _num(r.get("CusNoOld"))
        if cus_no_raw == 0 and old_no_raw != 0:
            cus_no = str(int(old_no_raw))
        else:
            cus_no = str(int(cus_no_raw))
        old_no = str(int(old_no_raw)) if old_no_raw else None
        if cus_no in have_no:
            skipped.append({"membership_number": cus_no, "reason": "Already imported (membership number exists)"})
            continue
        name = _clean_import_name(r.get("CusName"))
        if not name:
            skipped.append({"membership_number": cus_no, "reason": "No name"})
            continue
        raw_type = _s(r.get("CusMemberType")).upper()
        mtype = types.get(TYPE_FIXES.get(raw_type, raw_type))
        if mtype is None:
            skipped.append({"membership_number": cus_no, "reason": f"Membership type '{raw_type}' is not in the system"})
            continue
        notes, warn = [], []
        number = cus_no
        if number.upper() in taken:
            warn.append(f"Membership number {number} is already used by another member: left blank")
            notes.append(f"Old register membership number {number} could not be used (already taken)")
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
            elif gotras.get(_gotra_key("GENERAL")):
                master = gotras[_gotra_key("GENERAL")]
                gotra_id, gotra_text = master.id, master.name_en
                warn.append(f"Gotra '{g}' is not in the Gotra master: set to GENERAL")
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
        member = Member(
            membership_number=number, old_membership_number=old_no,
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
            skipped.append({"membership_number": cus_no, "reason": f"Could not be saved: {str(exc)[:160]}"})
            continue
        have_no.add(cus_no)
        if number:
            taken.add(number.upper())
        created += 1
        deleted += is_deleted
        expired += status_text == "expired"
        for w in warn:
            warnings.append({"membership_number": cus_no, "warning": w})
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
    patrika_nidhi = find("Patrika Nidhi", donation.id) or make("Patrika Nidhi", donation.id)
    scholarship = find("Scholarship") or make("Scholarship")
    general_scholarship = find("General", scholarship.id) or make("General", scholarship.id)
    return {"membership": membership, "donation": donation, "general_donation": general_donation, "patrika_nidhi": patrika_nidhi,
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
    ids = {mno: (i, mno, nm) for i, mno, nm in
           db.query(Member.id, Member.membership_number, Member.full_name_en).filter(Member.registration_source == "MIGRATION", Member.membership_number != None).all()}  # noqa: E711
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
        mid = ids.get(str(m["cus_no"]))
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
            key = (financial_year_start(ln["date"]), ln["number"], ln["date"]) if real else ("dummy", ln["cus_no"], ln["slot"])
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
        pat = sum(l["patrika"] for _m, l in members)
        total = mem + up + sch + don + pat
        if mem > 0 or total == 0:
            rtype = "MEMBERSHIP"
        else:
            rtype = "SCHOLARSHIP" if sch > 0 and don == 0 and pat == 0 else "GENERAL_DONATION"
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
                        own = ln["membership"] + ln["upgrade"] + ln["scholarship"] + ln["donation"] + ln["patrika"]
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

                # the Membership line is the membership amount only; the upgrade column is the Patrika Nidhi line below
                if mem > 0 or total == 0:
                    item("MEMBERSHIP", p["membership"], None, mem, "Shared by %d members" % len(members) if len(members) > 1 else None)
                if sch > 0:
                    item("SCHOLARSHIP", p["scholarship"], p["general_scholarship"], sch, notes or None)
                if don > 0:
                    item("DONATION", p["donation"], p["general_donation"], don, notes or None)
                if pat > 0:
                    item("DONATION", p["donation"], p["patrika_nidhi"], pat, notes or "Old register: upgrade column (Patrika Nidhi)")
                for (mid, mno, _name), ln in members:
                    own = ln["membership"] + ln["upgrade"] + ln["scholarship"] + ln["donation"] + ln["patrika"]
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
    from api.v1.endpoints.members import _GOTRA_ALIAS_KEYS, _NO_GOTRA, _clean_import_name, _gotra_key
    from models.masters import Gotra
    from models.members import Member

    done = untouched = missing = 0
    gotras = {}
    for g in db.query(Gotra).filter(Gotra.is_deleted == False, Gotra.status == True).all():  # noqa: E712
        gotras.setdefault(_gotra_key(g.name_en), g)
    unmatched = Counter()
    by_no = {o: i for o, i in db.query(Member.membership_number, Member.id).filter(Member.registration_source == "MIGRATION", Member.membership_number != None).all()}  # noqa: E711
    for n, r in enumerate(rows, 1):
        mid = by_no.get(_s(r.get("CusNo")))
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
        raw = _clean_import_name(r.get("CusGotra"))
        if raw and raw.upper() not in _NO_GOTRA and not m.gotra_id:
            k = _gotra_key(raw)
            master = gotras.get(_GOTRA_ALIAS_KEYS.get(k, k))
            master = master or gotras.get(_gotra_key("GENERAL"))   # a gotra the master does not have is GENERAL
            if master:
                m.gotra_id, m.gotra_text, changed = master.id, master.name_en, True
            else:
                unmatched[raw] += 1
        done += changed
        untouched += not changed
        if n % batch == 0:
            db.commit()
    db.commit()
    return {"updated": done, "unchanged": untouched, "not_found": missing, "gotra_not_in_master": dict(unmatched)}


def renumber_imported(db, rows: list) -> dict:
    """One-time correction of members imported when CusNo was wrongly taken as the OLD number: the membership number is CusNo,
    the old number is CusNoOld, CusNoNew is not used. Members are found by the old number they were given then (CusNo).
    Receipts of the import carry the payer's membership number, so those are fixed too, and the membership number counter
    is moved past the highest number. All or nothing; refuses to run again once every imported member has a number."""
    from datetime import date as _date
    from sqlalchemy import func
    from models.members import Member, MemberMembership
    from models.receipts import Receipt, ReceiptAllocation
    from services import numbering

    base = db.query(Member).filter(Member.registration_source == "MIGRATION", Member.is_deleted == False)  # noqa: E712
    if base.filter(Member.membership_number == None).count() == 0:  # noqa: E711
        raise RuntimeError("Every imported member already has a membership number: the correction was already made")
    by_cus = {m.old_membership_number: m for m in base.filter(Member.old_membership_number != None).all()}  # noqa: E711
    wanted = {}
    for r in rows:
        cus = _s(r.get("CusNo"))
        if cus and cus in by_cus:
            wanted[by_cus[cus].id] = (str(int(_num(r.get("CusNo")))), str(int(_num(r.get("CusNoOld")))) if _num(r.get("CusNoOld")) else None)
    ids = list(wanted)
    others = {n.strip().upper() for (n,) in db.query(Member.membership_number).filter(Member.membership_number != None, Member.id.notin_(ids)).all()}  # noqa: E711
    clash = sorted(n for n, _o in wanted.values() if n.upper() in others)
    if clash:
        raise RuntimeError(f"These membership numbers are already used by other members: {clash[:20]}")
    # step 1 clears the numbers (a number moving from one member to another would meet the unique index half way)
    for i in range(0, len(ids), 1000):
        part = ids[i:i + 1000]
        db.query(MemberMembership).filter(MemberMembership.member_id.in_(part), MemberMembership.is_deleted == False).update({"membership_number": None}, synchronize_session=False)  # noqa: E712
        db.query(Member).filter(Member.id.in_(part)).update({"membership_number": None}, synchronize_session=False)
    db.flush()
    db.expire_all()      # the rows were changed behind the session's back
    for i in range(0, len(ids), 1000):
        for m in db.query(Member).filter(Member.id.in_(ids[i:i + 1000])).all():
            no, old = wanted[m.id]
            m.membership_number, m.old_membership_number, m.legacy_ref_number = no, old, None
        for ms in db.query(MemberMembership).filter(MemberMembership.member_id.in_(ids[i:i + 1000]), MemberMembership.is_deleted == False).all():  # noqa: E712
            ms.membership_number = wanted[ms.member_id][0]
        db.flush()
    # the payer on a receipt of the import is its first member
    first = (db.query(ReceiptAllocation.receipt_id, func.min(ReceiptAllocation.id).label("a")).join(Receipt, Receipt.id == ReceiptAllocation.receipt_id)
             .filter(Receipt.source == SOURCE).group_by(ReceiptAllocation.receipt_id).subquery())
    fixed = 0
    for rid, mid in db.query(ReceiptAllocation.receipt_id, ReceiptAllocation.member_id).join(first, first.c.a == ReceiptAllocation.id).all():
        if mid in wanted:
            fixed += db.query(Receipt).filter(Receipt.id == rid).update({"payer_membership_no": wanted[mid][0]}, synchronize_session=False)
    top = max(int(n) for n, _o in wanted.values())
    numbering.note_used(db, "MEMBER_CODE", str(top), _date.today())
    db.commit()
    nxt = numbering.peek_number(db, "MEMBER_CODE")      # peeking ends the transaction, so only after the commit
    return {"members": len(ids), "with_old_number": sum(1 for _n, o in wanted.values() if o), "receipts_payer_fixed": fixed, "highest_number": top,
            "next_new_member_number": nxt}


def backfill_kannada(db, rows: list, *, batch: int = 2000) -> dict:
    """Put the Kannada name of the Unicode register on the members already imported (matched by the membership number).
    A name that is not Kannada script (the old font's encoding shows as junk symbols) is replaced; a member the Unicode
    file has no Kannada name for gets the junk cleared. Safe to repeat."""
    from models.members import Member

    by_no = {o: i for o, i in db.query(Member.membership_number, Member.id).filter(Member.registration_source == "MIGRATION", Member.membership_number != None).all()}  # noqa: E711
    set_, same, cleared, missing, no_name = 0, 0, 0, 0, 0
    for n, r in enumerate(rows, 1):
        mid = by_no.get(_s(r.get("CusNo")))
        if mid is None:
            missing += 1
            continue
        m = db.get(Member, mid)
        name = _s(r.get("CusNameKannada"))
        if name and _KANNADA.search(name):
            if m.full_name_kn == name:
                same += 1
            else:
                m.full_name_kn = name[:250]
                set_ += 1
        else:
            no_name += 1
            if m.full_name_kn and not _KANNADA.search(m.full_name_kn):
                m.full_name_kn = None
                cleared += 1
        if n % batch == 0:
            db.commit()
    db.commit()
    return {"updated": set_, "already_right": same, "no_kannada_in_file": no_name, "junk_cleared": cleared, "not_found": missing}


def merge_same_particular_lines(db) -> dict:
    """Receipts of the old register made before the importer joined them have two lines of one particular (Membership +
    the upgrade amount, or one line per member of a shared receipt). The Receipt Entry screen allows a particular once
    per receipt, so such a receipt could not be edited. The lines become one: the first keeps the sum, the others are marked
    deleted. The receipt totals do not change. Safe to repeat."""
    from collections import defaultdict as _dd
    from datetime import timezone
    from models.receipts import Receipt, ReceiptItem

    groups = _dd(list)
    q = (db.query(ReceiptItem).join(Receipt, Receipt.id == ReceiptItem.receipt_id)
         .filter(Receipt.source == SOURCE, Receipt.is_deleted == False, ReceiptItem.is_deleted == False)  # noqa: E712
         .order_by(ReceiptItem.receipt_id, ReceiptItem.line_no, ReceiptItem.id))
    for it in q.all():
        groups[(it.receipt_id, it.particular_name, it.sub_particular_name or "")].append(it)
    now = datetime.now(timezone.utc)
    receipts = lines_removed = 0
    seen_receipts = set()
    for items in groups.values():
        if len(items) < 2:
            continue
        keep, rest = items[0], items[1:]
        upgrade = sum(float(i.amount) for i in items if (i.item_type or "").upper() == "TYPE_CHANGE")
        shared = any("Shared by" in (i.description or "") or "same receipt" in (i.description or "") for i in items)
        note = []
        if shared:
            note.append("Shared by several members")
        if upgrade > 0:
            note.append("includes upgrade amount %s" % f"{upgrade:g}")
        keep.amount = sum(float(i.amount) for i in items)
        keep.item_type = "MEMBERSHIP" if (keep.item_type or "").upper() in ("MEMBERSHIP", "TYPE_CHANGE") else keep.item_type
        keep.description = "; ".join(note) or keep.description
        for i in rest:
            i.is_deleted, i.deleted_at = True, now
        lines_removed += len(rest)
        seen_receipts.add(keep.receipt_id)
    receipts = len(seen_receipts)
    db.commit()
    return {"receipts_changed": receipts, "lines_removed": lines_removed}


def retag_patrika_receipts(db, rows: list, user_id: int) -> dict:
    """Receipts already imported whose register row carries a Patrika Fund / Patrika Nidhi note: the upgrade or donation money of
    that row moves to Donation > Patrika Nidhi (it was counted as membership, or as a general donation). Totals do not change.
    Found by receipt number and date; a shared receipt is split by row. Safe to repeat."""
    from datetime import timezone
    from models.receipts import Receipt, ReceiptItem

    p = _particulars(db, user_id)
    pat_sub = p["patrika_nidhi"]
    now = datetime.now(timezone.utc)
    fixed, moved, missing = 0, 0.0, 0
    for r in rows:
        for j in SLOTS:
            if not _PATRIKA.search(_s(r.get(f"CusReceiptNote{j}"))):
                continue
            number, d = _s(r.get(f"CusReceiptNo{j}")), _as_date(r.get(f"CusReceiptDate{j}"))
            up = _num(r.get(f"CusMemUpAmt{j}"))
            don = sum(_num(r.get(f"CusDon{k}Amt{j}")) for k in (1, 2, 3))
            if not number or d is None or not (up or don):
                continue
            rec = (db.query(Receipt).filter(Receipt.receipt_number == number, Receipt.receipt_date == d, Receipt.source == SOURCE,
                                            Receipt.is_deleted == False).first())  # noqa: E712
            if rec is None:
                missing += 1
                continue
            items = db.query(ReceiptItem).filter(ReceiptItem.receipt_id == rec.id, ReceiptItem.is_deleted == False).order_by(ReceiptItem.line_no).all()  # noqa: E712
            if any(i.particular_name == "Donation" and i.sub_particular_id == pat_sub.id for i in items) and not up and not don:
                continue

            def take(match, amount):
                left = amount
                for i in items:
                    if left <= 0:
                        break
                    if i.is_deleted or not match(i):
                        continue
                    cut = min(float(i.amount), left)
                    left -= cut
                    i.amount = float(i.amount) - cut
                    if i.amount <= 0.0001:
                        i.is_deleted, i.deleted_at = True, now
                return amount - left

            got = take(lambda i: i.particular_name == "Membership" and (i.item_type or "").upper() in ("TYPE_CHANGE", "MEMBERSHIP"), up)
            got += take(lambda i: i.particular_name == "Donation" and i.sub_particular_id != pat_sub.id, don)
            if got <= 0:
                continue
            line_no = max([i.line_no or 0 for i in items] + [0]) + 1
            existing = next((i for i in items if not i.is_deleted and i.particular_name == "Donation" and i.sub_particular_id == pat_sub.id), None)
            if existing is not None:
                existing.amount = float(existing.amount) + got
            else:
                db.add(ReceiptItem(receipt_id=rec.id, item_type="DONATION", particular_id=p["donation"].id, particular_name=p["donation"].name_en,
                                   sub_particular_id=pat_sub.id, sub_particular_name=pat_sub.name_en, description=_s(r.get(f"CusReceiptNote{j}")) or None,
                                   amount=got, line_no=line_no, pays_for_membership=bool(p["donation"].pays_for_membership), created_by=user_id))
            if not any(not i.is_deleted and (i.item_type or "").upper() in ("MEMBERSHIP", "TYPE_CHANGE") for i in items):
                rec.receipt_type = "GENERAL_DONATION"
            fixed += 1
            moved += got
    db.commit()
    return {"receipts_changed": fixed, "amount_moved_to_patrika_nidhi": moved, "receipts_not_found": missing}


def split_upgrade_into_patrika(db, rows: list, user_id: int) -> dict:
    """Receipts already imported with the upgrade column inside the Membership line (or as an upgrade-only line): that money is
    Patrika Nidhi. Each receipt's Membership money goes down by it and a Donation > Patrika Nidhi line takes it; a receipt left
    with no membership money becomes a General Donation receipt. Receipt totals do not change. Slots are matched to receipts by
    member and date (a shared receipt gets the upgrade money of all its members). Safe to repeat: a receipt that already holds
    its Patrika Nidhi amount is left alone."""
    from collections import defaultdict as _dd
    from datetime import timezone
    from models.members import Member
    from models.receipts import Receipt, ReceiptAllocation, ReceiptItem

    p = _particulars(db, user_id)
    pat = p["patrika_nidhi"]
    now = datetime.now(timezone.utc)
    by_no = {n: i for n, i in db.query(Member.membership_number, Member.id).filter(Member.registration_source == "MIGRATION", Member.membership_number != None).all()}  # noqa: E711
    wanted, missing = _dd(float), 0
    for r in rows:
        mid = by_no.get(_s(r.get("CusNo")))
        for j in SLOTS:
            up = _num(r.get(f"CusMemUpAmt{j}"))
            note_money = _num(r.get(f"CusMemUpAmt{j}")) + sum(_num(r.get(f"CusDon{k}Amt{j}")) for k in (1, 2, 3)) if _PATRIKA.search(_s(r.get(f"CusReceiptNote{j}"))) else up
            d = _as_date(r.get(f"CusReceiptDate{j}"))
            if not note_money or d is None or mid is None:
                continue
            number = _s(r.get(f"CusReceiptNo{j}"))
            q = (db.query(Receipt).join(ReceiptAllocation, ReceiptAllocation.receipt_id == Receipt.id)
                 .filter(ReceiptAllocation.member_id == mid, ReceiptAllocation.is_deleted == False, Receipt.receipt_date == d,  # noqa: E712
                         Receipt.source == SOURCE, Receipt.is_deleted == False))  # noqa: E712
            found = q.all()
            rec = next((x for x in found if x.receipt_number == number), None) or (found[0] if found else None)
            if rec is None:
                missing += 1
                continue
            wanted[rec.id] += note_money
    changed, moved = 0, 0.0
    for rid, want in wanted.items():
        items = db.query(ReceiptItem).filter(ReceiptItem.receipt_id == rid, ReceiptItem.is_deleted == False).order_by(ReceiptItem.line_no).all()  # noqa: E712
        have = sum(float(i.amount) for i in items if i.particular_name == "Donation" and i.sub_particular_id == pat.id)
        delta = round(want - have, 2)
        if delta <= 0.005:
            continue
        left = delta
        for kind in ("TYPE_CHANGE", "MEMBERSHIP"):
            for i in items:
                if left <= 0:
                    break
                if i.is_deleted or i.particular_name != "Membership" or (i.item_type or "").upper() != kind:
                    continue
                cut = min(float(i.amount), left)
                left -= cut
                i.amount = float(i.amount) - cut
                if i.amount <= 0.0001:
                    i.is_deleted, i.deleted_at = True, now
                elif "includes upgrade" in (i.description or ""):
                    i.description = "Shared by several members" if "Shared by" in (i.description or "") else None
        took = delta - left
        if took <= 0:
            continue
        existing = next((i for i in items if not i.is_deleted and i.particular_name == "Donation" and i.sub_particular_id == pat.id), None)
        if existing is not None:
            existing.amount = float(existing.amount) + took
        else:
            db.add(ReceiptItem(receipt_id=rid, item_type="DONATION", particular_id=p["donation"].id, particular_name=p["donation"].name_en,
                               sub_particular_id=pat.id, sub_particular_name=pat.name_en, description="Old register: upgrade column (Patrika Nidhi)",
                               amount=took, line_no=max([i.line_no or 0 for i in items] + [0]) + 1, pays_for_membership=bool(p["donation"].pays_for_membership), created_by=user_id))
        if not any(not i.is_deleted and i.particular_name == "Membership" for i in items):
            db.query(Receipt).filter(Receipt.id == rid).update({"receipt_type": "GENERAL_DONATION"}, synchronize_session=False)
        changed += 1
        moved += took
    db.commit()
    return {"receipts_changed": changed, "amount_moved_to_patrika_nidhi": round(moved, 2), "slots_without_a_receipt": missing}


def reimport_shared_members(db, rows: list, user_id: int) -> dict:
    """Make the receipts of the members who share a number in the register again with the current rule: the old-register receipts of those
    members are set aside (deleted, number renamed SETASIDE-<id>) and the members are imported again. Nothing else is touched."""
    from models.members import Member
    from models.receipts import Receipt, ReceiptAllocation

    numbers = {str(int(c)) for g in build_plan(db, rows)["shared"] for c in g["members"]}
    if not numbers:
        return {"set_aside": 0}
    ids = [i for (i,) in db.query(Member.id).filter(Member.membership_number.in_(numbers)).all()]
    rids = [r for (r,) in db.query(ReceiptAllocation.receipt_id).join(Receipt, Receipt.id == ReceiptAllocation.receipt_id)
            .filter(ReceiptAllocation.member_id.in_(ids), Receipt.source == SOURCE, Receipt.is_deleted == False).distinct().all()]  # noqa: E712
    for rid in rids:
        r = db.get(Receipt, rid)
        r.receipt_number = f"SETASIDE-{rid}"
        r.is_deleted = True
        db.query(ReceiptAllocation).filter(ReceiptAllocation.receipt_id == rid).delete(synchronize_session=False)
    db.commit()
    out = import_receipts(db, [r for r in rows if str(int(r["CusNo"])) in numbers], user_id)
    return {"set_aside": len(rids), "members": len(numbers), "created": out["created"], "shared": out["shared"], "dummy": out["dummy"], "skipped": out["skipped"]}
