"""Receipt numbers the register used more than once.

A number used again keeps the earliest record and the others get a tail: 32170, 32170/2, 32170/3 ... This lists such numbers,
one group per number (and financial year), so the office can compare the records. Nothing is merged or changed."""
import io
import re
from collections import defaultdict
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.members import Member
from models.receipts import Receipt, ReceiptAllocation

_TAIL = re.compile(r"^(.+)/([0-9]+)$")
KINDS = ("ALL", "2", "3", "4PLUS")   # the highest tail a number reached: /2, /3, /4 or more


def split_number(number: Optional[str]):
    m = _TAIL.match(number or "")
    return (m.group(1), int(m.group(2))) if m else (number, None)


def _kind_ok(kind: str, top: int) -> bool:
    return kind == "ALL" or (kind == "2" and top == 2) or (kind == "3" and top == 3) or (kind == "4PLUS" and top >= 4)


def find_groups(db: Session, kind: str = "ALL", search: Optional[str] = None, fy: Optional[str] = None, page: int = 1, limit: int = 50, everything: bool = False) -> dict:
    """``groups`` is the requested slice (all of them for ``everything``); ``counts`` is how many numbers reached each tail level
    under the search and year, whatever kind was asked for."""
    kind = (kind or "ALL").upper()
    if kind not in KINDS:
        raise ValueError("kind must be ALL, 2, 3 or 4PLUS")
    live = [Receipt.is_deleted == False]  # noqa: E712
    if fy:
        live.append(Receipt.financial_year == fy)

    # every repeat record, then the numbers they belong to (a few thousand rows at most)
    tails = defaultdict(dict)   # (financial year, base) -> {tail: receipt id}
    for rid, year, number in db.query(Receipt.id, Receipt.financial_year, Receipt.receipt_number).filter(*live, Receipt.receipt_number.contains("/")):
        base, tail = split_number(number)
        if tail is not None:
            tails[(year, base)][tail] = rid

    wanted = (search or "").strip()
    if wanted and tails:
        like = f"%{wanted}%"
        by_payee = (
            db.query(ReceiptAllocation.receipt_id).join(Member, Member.id == ReceiptAllocation.member_id)
            .filter(ReceiptAllocation.is_deleted == False, or_(Member.full_name_en.ilike(like), Member.first_name_en.ilike(like), Member.last_name_en.ilike(like), Member.mobile.ilike(like)))  # noqa: E712
        )
        hit = set()
        for year, number in db.query(Receipt.financial_year, Receipt.receipt_number).filter(
            *live, or_(Receipt.receipt_number.ilike(like), Receipt.payer_name.ilike(like), Receipt.payer_mobile.ilike(like), Receipt.id.in_(by_payee))
        ):
            hit.add((year, split_number(number)[0]))
        tails = {k: v for k, v in tails.items() if k in hit}

    level = lambda v: max(v)  # noqa: E731
    counts = {"ALL": len(tails), "2": 0, "3": 0, "4PLUS": 0}
    for v in tails.values():
        top = level(v)
        if top >= 2:
            counts["2" if top == 2 else "3" if top == 3 else "4PLUS"] += 1
    keys = sorted((k for k, v in tails.items() if _kind_ok(kind, level(v))), key=lambda k: (k[0] or "", k[1] or ""), reverse=True)
    total = len(keys)
    page_keys = keys if everything else keys[(max(1, page) - 1) * limit: max(1, page) * limit]

    # the records of the numbers on this page: the original (no tail) and its repeats
    ids = {rid for k in page_keys for rid in tails[k].values()}
    originals = {}
    if page_keys:
        for r in db.query(Receipt).filter(*live, Receipt.receipt_number.in_({k[1] for k in page_keys})):
            originals[(r.financial_year, r.receipt_number)] = r
    records = {r.id: r for r in db.query(Receipt).filter(Receipt.id.in_(ids))} if ids else {}
    members = {}
    want_ids = list(ids | {r.id for r in originals.values()})
    if want_ids:
        for rid, mid, name in (
            db.query(ReceiptAllocation.receipt_id, Member.id, Member.full_name_en).join(Member, Member.id == ReceiptAllocation.member_id)
            .filter(ReceiptAllocation.receipt_id.in_(want_ids), ReceiptAllocation.is_deleted == False).order_by(ReceiptAllocation.id)  # noqa: E712
        ):
            members.setdefault(rid, (mid, name))

    def row(r: Receipt) -> dict:
        mid, mname = members.get(r.id, (None, None))
        return {
            "id": r.id, "receipt_number": r.receipt_number, "receipt_date": r.receipt_date, "name": r.payer_name or mname,
            "amount": float(r.net_amount), "payment_mode": r.payment_mode, "receipt_status": r.receipt_status,
            "member_id": mid, "member_name": mname, "repeat_no": split_number(r.receipt_number)[1],
        }

    groups = []
    for key in page_keys:
        year, base = key
        items = ([row(originals[key])] if key in originals else []) + [row(records[tails[key][t]]) for t in sorted(tails[key]) if tails[key][t] in records]
        first = items[0] if items and items[0]["repeat_no"] is None else None
        # same name and amount as the original: the likeliest true duplicates
        alike = [i["receipt_number"] for i in items[1:] if first and (i["name"] or "").strip().lower() == (first["name"] or "").strip().lower()
                 and i["amount"] == first["amount"] and first["name"]]
        groups.append({"number": base, "financial_year": year, "count": len(items), "has_original": first is not None, "alike": alike, "items": items})
    return {"groups": groups, "total": total, "counts": counts}


def groups_xlsx(groups: list) -> bytes:
    from openpyxl import Workbook

    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Repeated receipt numbers")
    ws.append(["Number", "Financial year", "Times used", "Receipt no", "Which use", "Date", "Name", "Amount", "Payment mode", "Status", "Same name and amount as the first"])
    for g in groups:
        for i in g["items"]:
            ws.append([g["number"], g["financial_year"], g["count"], i["receipt_number"], i["repeat_no"] or 1, i["receipt_date"], i["name"], i["amount"],
                       i["payment_mode"], i["receipt_status"], "Yes" if i["receipt_number"] in g["alike"] else ""])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
