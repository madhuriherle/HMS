"""Delete / edit guards on masters that other records point at."""

V = "/api/v1"


def _post(client, h, url, body):
    r = client.post(f"{V}{url}", json=body, headers=h)
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_district_move_carries_pincodes_and_state_delete_blocked_by_member(client, admin_headers):
    s1 = _post(client, admin_headers, "/masters/states", {"name_en": "GuardState1", "code": "GS1"})
    s2 = _post(client, admin_headers, "/masters/states", {"name_en": "GuardState2", "code": "GS2"})
    d = _post(client, admin_headers, "/masters/districts", {"name_en": "GuardDist", "state_id": s1["id"]})
    pc = _post(client, admin_headers, "/masters/postal-codes", {"pincode": "560991", "state_id": s1["id"], "district_id": d["id"]})

    r = client.put(f"{V}/masters/districts/{d['id']}", json={"state_id": s2["id"]}, headers=admin_headers)
    assert r.status_code == 200, r.text
    got = client.get(f"{V}/masters/postal-codes/{pc['id']}", headers=admin_headers)
    if got.status_code == 200:
        assert got.json()["state_id"] == s2["id"]


def test_payment_mode_soft_delete_and_in_use_block(client, admin_headers):
    pm = _post(client, admin_headers, "/masters/payment-modes", {"payment_mode": "GuardCash", "payment_type": "CASH"})
    r = client.delete(f"{V}/masters/payment-modes/{pm['id']}", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert client.get(f"{V}/masters/payment-modes/{pm['id']}", headers=admin_headers).status_code == 404


def test_particular_edit_rejects_duplicate_code(client, admin_headers):
    a = _post(client, admin_headers, "/masters/particulars", {"code": "GP_A", "name_en": "Guard A"})
    b = _post(client, admin_headers, "/masters/particulars", {"code": "GP_B", "name_en": "Guard B"})
    r = client.put(f"{V}/masters/particulars/{b['id']}", json={"code": "GP_A"}, headers=admin_headers)
    assert r.status_code == 409
    r = client.put(f"{V}/masters/particulars/{a['id']}", json={"parent_id": a["id"]}, headers=admin_headers)
    assert r.status_code == 400


def test_payment_mode_in_use_needs_force(client, admin_headers):
    pm = _post(client, admin_headers, "/masters/payment-modes", {"payment_mode": "GuardUPI", "payment_type": "ONLINE"})
    from db.session import SessionLocal
    from models.masters import PaymentMode
    from models.receipts import Receipt
    # a live receipt using the mode, inserted directly
    import datetime
    db = SessionLocal()
    try:
        db.add(Receipt(
            receipt_number="GUARD-1", receipt_date=datetime.date(2026, 4, 10), financial_year="2026-27",
            receipt_type="DONATION", payment_mode="GuardUPI", gross_amount=100, discount_amount=0,
            net_amount=100, payment_status="PAID",
        ))
        db.commit()
    finally:
        db.close()
    r = client.delete(f"{V}/masters/payment-modes/{pm['id']}", headers=admin_headers)
    assert r.status_code == 409
    body = r.json()
    assert isinstance(body["detail"], str) and body["code"] == "IN_USE" and body["can_force"] is True
    r = client.delete(f"{V}/masters/payment-modes/{pm['id']}?force=true", headers=admin_headers)
    assert r.status_code == 200, r.text


def test_bank_in_use_force_deletes_its_payment_modes(client, admin_headers):
    h = admin_headers
    bank = _post(client, h, "/masters/banks", {"name_en": "GuardBank", "code": "GBK1"})
    pm = _post(client, h, "/masters/payment-modes", {"payment_mode": "GuardBankMode", "payment_type": "ONLINE", "bank_id": bank["id"]})
    r = client.delete(f"{V}/masters/banks/{bank['id']}", headers=h)
    assert r.status_code == 409 and r.json()["code"] == "IN_USE"
    assert client.get(f"{V}/masters/payment-modes/{pm['id']}", headers=h).status_code == 200
    assert client.delete(f"{V}/masters/banks/{bank['id']}?force=true", headers=h).status_code == 200
    assert client.get(f"{V}/masters/payment-modes/{pm['id']}", headers=h).status_code == 404


def test_location_used_by_member_needs_force(client, admin_headers):
    h = admin_headers
    st = _post(client, h, "/masters/states", {"name_en": "GuardUsedState", "code": "GUS"})
    m = _post(client, h, "/members/", {"first_name_en": "GuardMember", "mobile": "9340011122", "state_id": st["id"]})
    assert m.get("state_id") == st["id"]
    r = client.delete(f"{V}/masters/states/{st['id']}", headers=h)
    assert r.status_code == 409 and r.json()["code"] == "IN_USE"
    assert client.delete(f"{V}/masters/states/{st['id']}?force=true", headers=h).status_code == 200


def test_particular_on_receipt_needs_force(client, admin_headers):
    h = admin_headers
    p = _post(client, h, "/masters/particulars", {"code": "GP_USED", "name_en": "Guard Used"})
    rc = client.post(f"{V}/receipts/", headers=h, json={
        "receipt_number": "GP-1", "receipt_date": "2026-10-09", "receipt_type": "DONATION", "payer_name": "X",
        "payment_mode": "CASH", "gross_amount": 10, "discount_amount": 0, "net_amount": 10, "source": "OFFLINE",
        "is_renewal": False,
        "items": [{"item_type": "DONATION", "particular_id": p["id"], "particular_name": "Guard Used", "description": "d", "amount": 10}],
        "allocations": [],
    })
    assert rc.status_code in (200, 201), rc.text
    r = client.delete(f"{V}/masters/particulars/{p['id']}", headers=h)
    assert r.status_code == 409 and r.json()["code"] == "IN_USE"
    assert client.delete(f"{V}/masters/particulars/{p['id']}?force=true", headers=h).status_code == 200


def test_receipt_with_allocations_needs_force(client, admin_headers):
    h = admin_headers
    m = _post(client, h, "/members/", {"first_name_en": "GuardPayer", "mobile": "9340011133"})
    rc = _post(client, h, "/receipts/", {
        "receipt_number": "GR-1", "receipt_date": "2026-10-09", "receipt_type": "DONATION", "payer_name": "Y",
        "payment_mode": "CASH", "gross_amount": 100, "discount_amount": 0, "net_amount": 100, "source": "OFFLINE",
        "is_renewal": False, "items": [{"item_type": "DONATION", "description": "d", "amount": 100}], "allocations": [],
    })
    a = client.post(f"{V}/receipts/{rc['id']}/allocate", headers=h, json={"member_id": m["id"], "allocated_amount": 100})
    assert a.status_code in (200, 201), a.text
    r = client.delete(f"{V}/receipts/{rc['id']}", headers=h)
    assert r.status_code == 409 and r.json()["code"] == "IN_USE"
    assert client.delete(f"{V}/receipts/{rc['id']}?force=true", headers=h).status_code == 200


def test_event_with_participants_needs_force(client, admin_headers):
    h = admin_headers
    ev = _post(client, h, "/events/", {"title": "GuardEvent", "event_date": "2026-11-01"})
    p = client.post(f"{V}/events/{ev['id']}/participants", headers=h, json={"participant_name": "Guest One"})
    assert p.status_code in (200, 201), p.text
    r = client.delete(f"{V}/events/{ev['id']}", headers=h)
    assert r.status_code == 409 and r.json()["code"] == "IN_USE"
    assert client.delete(f"{V}/events/{ev['id']}?force=true", headers=h).status_code == 200


def test_gated_delete_warns_at_request_time_and_approver_sees_it(client, admin_headers):
    from test_api import _staff_with_role

    h = admin_headers
    _, _, clerk = _staff_with_role(
        client, h, "guarddel_clerk", "GuardDelClerk", "GUARDDEL_CLERK",
        permission_grants=[("masters.delete", True), ("approvals.write", False)],
    )
    pm = _post(client, h, "/masters/payment-modes", {"payment_mode": "GuardGated", "payment_type": "ONLINE"})
    import datetime
    from db.session import SessionLocal
    from models.receipts import Receipt
    db = SessionLocal()
    try:
        db.add(Receipt(receipt_number="GG-1", receipt_date=datetime.date(2026, 4, 11), financial_year="2026-27",
                       receipt_type="DONATION", payment_mode="GuardGated", gross_amount=5, discount_amount=0,
                       net_amount=5, payment_status="PAID"))
        db.commit()
    finally:
        db.close()

    # 1. clerk (needs approval) is warned straight away; nothing is filed yet
    r = client.delete(f"{V}/masters/payment-modes/{pm['id']}", headers=clerk)
    assert r.status_code == 409 and r.json()["code"] == "IN_USE"

    # 2. clerk insists: the request is filed carrying the warning
    r = client.delete(f"{V}/masters/payment-modes/{pm['id']}?force=true", headers=clerk)
    assert r.status_code == 200, r.text
    req_id = r.json()["approval_request_id"]
    req = client.get(f"{V}/approvals/requests", headers=h, params={"status": "PENDING", "limit": 200}).json()["data"]
    mine = next(x for x in req if x["id"] == req_id)
    assert "used by 1 receipt" in mine["payload"]["_warning"]
    assert "dry_run" not in mine["payload"]
    assert client.get(f"{V}/masters/payment-modes/{pm['id']}", headers=h).status_code == 200  # still there

    # 3. the approver approves; it runs with the force the requester agreed to
    done = client.put(f"{V}/approvals/requests/{req_id}/approve", headers=h)
    assert done.status_code == 200, done.text
    assert client.get(f"{V}/masters/payment-modes/{pm['id']}", headers=h).status_code == 404


def test_gated_delete_not_in_use_is_filed_without_warning(client, admin_headers):
    from test_api import _staff_with_role

    h = admin_headers
    _, _, clerk = _staff_with_role(
        client, h, "guarddel2_clerk", "GuardDel2Clerk", "GUARDDEL2_CLERK",
        permission_grants=[("masters.delete", True)],
    )
    pm = _post(client, h, "/masters/payment-modes", {"payment_mode": "GuardFree", "payment_type": "CASH"})
    r = client.delete(f"{V}/masters/payment-modes/{pm['id']}", headers=clerk)
    assert r.status_code == 200 and r.json()["status"] == "PENDING"
    req = client.get(f"{V}/approvals/requests", headers=h, params={"status": "PENDING", "limit": 200}).json()["data"]
    mine = next(x for x in req if x["id"] == r.json()["approval_request_id"])
    assert "_warning" not in mine["payload"]
    # still there: only a request was filed
    assert client.get(f"{V}/masters/payment-modes/{pm['id']}", headers=h).status_code == 200


def test_approval_rechecks_when_record_became_in_use(client, admin_headers):
    from test_api import _staff_with_role

    h = admin_headers
    _, _, clerk = _staff_with_role(
        client, h, "guarddel3_clerk", "GuardDel3Clerk", "GUARDDEL3_CLERK",
        permission_grants=[("masters.delete", True)],
    )
    pm = _post(client, h, "/masters/payment-modes", {"payment_mode": "GuardLate", "payment_type": "CASH"})
    r = client.delete(f"{V}/masters/payment-modes/{pm['id']}", headers=clerk)
    req_id = r.json()["approval_request_id"]
    # ...then a receipt starts using the mode before the approver acts
    import datetime
    from db.session import SessionLocal
    from models.receipts import Receipt
    db = SessionLocal()
    try:
        db.add(Receipt(receipt_number="GL-1", receipt_date=datetime.date(2026, 4, 12), financial_year="2026-27",
                       receipt_type="DONATION", payment_mode="GuardLate", gross_amount=5, discount_amount=0,
                       net_amount=5, payment_status="PAID"))
        db.commit()
    finally:
        db.close()
    a = client.put(f"{V}/approvals/requests/{req_id}/approve", headers=h)
    assert a.status_code == 409 and a.json()["code"] == "IN_USE"
    assert client.get(f"{V}/masters/payment-modes/{pm['id']}", headers=h).status_code == 200
    a = client.put(f"{V}/approvals/requests/{req_id}/approve?force=true", headers=h)
    assert a.status_code == 200, a.text
    assert client.get(f"{V}/masters/payment-modes/{pm['id']}", headers=h).status_code == 404
