"""Tests for Magazine Module end-to-end workflow:
1. Registration with custom magazine delivery address.
2. Member edit: changing magazine_needed to True starts/restarts subscription; False stops it.
3. Receipt assignment creates active subscription for magazine_needed=True member (inline, manual allocate, bulk allocate).
4. Unsubscribed paid members listing and backfill subscriptions endpoint.
5. All-recipients endpoint including Member, Affiliation, Associate, Press.
6. Label generation with only_paid filtering and custom delivery address usage.
"""

from datetime import date

from test_frontend_contract import API, _approve_member, _send_label_batch, _sfx
from test_receipt_entry_flow import _entry_payload


def test_member_registration_stores_magazine_delivery_address(client, admin_headers):
    h, s = admin_headers, _sfx()
    custom_addr = f"Flat 402, Magazine Tower, Sirsi {s}"
    res = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"MagReg{s}",
        "mobile": "94" + s.zfill(8),
        "magazine_needed": True,
        "magazine_delivery_address": custom_addr,
    })
    assert res.status_code in (200, 201), res.text
    mid = res.json()["id"]

    # Verify field on member and in profile
    m = client.get(f"{API}/members/{mid}", headers=h).json()
    assert m["magazine_needed"] is True
    assert m["magazine_delivery_address"] == custom_addr

    prof = client.get(f"{API}/members/{mid}/profile", headers=h).json()
    assert prof["personal"]["magazine_needed"] is True
    assert prof["personal"]["magazine_delivery_address"] == custom_addr
    # An applicant who says Yes has no subscription yet: it starts at final approval
    assert prof["services"]["magazine"] == []
    _approve_member(client, h, mid)
    prof = client.get(f"{API}/members/{mid}/profile", headers=h).json()
    assert len(prof["services"]["magazine"]) == 1
    assert prof["services"]["magazine"][0]["delivery_status"] == "ACTIVE"
    assert prof["services"]["magazine"][0]["address_override"] == custom_addr


def test_member_edit_starts_and_stops_subscription(client, admin_headers):
    h, s = admin_headers, _sfx()
    custom_addr = f"Branch Office, Hubli {s}"
    res = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"EditSub{s}",
        "mobile": "94" + s.zfill(8),
        "magazine_needed": False,
        "magazine_delivery_address": custom_addr,
    })
    assert res.status_code in (200, 201), res.text
    mid = res.json()["id"]
    _approve_member(client, h, mid)   # a subscription only exists for an approved member

    # Turn magazine_needed to True
    upd1 = client.put(f"{API}/members/{mid}", headers=h, json={"magazine_needed": True})
    assert upd1.status_code == 200, upd1.text

    # Subscription must be created and ACTIVE with address_override
    subs = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"]
    assert len(subs) == 1
    assert subs[0]["delivery_status"] == "ACTIVE"
    assert subs[0]["address_override"] == custom_addr

    # Service opt-in must be synced and ACTIVE
    prof1 = client.get(f"{API}/members/{mid}/profile/magazine", headers=h).json()
    optins1 = [o for o in prof1["services"] if o["service_code"] == "MAGAZINE"]
    assert len(optins1) == 1
    assert optins1[0]["status"] == "ACTIVE"

    # Turn magazine_needed to False
    upd2 = client.put(f"{API}/members/{mid}", headers=h, json={"magazine_needed": False})
    assert upd2.status_code == 200, upd2.text

    subs2 = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"]
    assert len(subs2) == 1
    assert subs2[0]["delivery_status"] == "STOPPED"

    prof2 = client.get(f"{API}/members/{mid}/profile/magazine", headers=h).json()
    optins2 = [o for o in prof2["services"] if o["service_code"] == "MAGAZINE"]
    assert len(optins2) == 0  # ACTIVE opt-ins queried, cancelled is excluded from active list


def test_receipt_assignment_creates_active_subscription(client, admin_headers):
    h, s = admin_headers, _sfx()
    custom_addr = f"Home Villa, Kumta {s}"

    # 1. Inline allocation at receipt creation
    m1 = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"RecAssign1{s}",
        "mobile": "94" + s.zfill(8),
        "magazine_needed": True,
        "magazine_delivery_address": custom_addr,
    }).json()
    _approve_member(client, h, m1["id"])

    body1 = _entry_payload(f"RC1-{s}", "Inline Payer", payment_mode="CASH",
                           allocations=[{"member_id": m1["id"], "allocated_amount": 500}])
    r1 = client.post(f"{API}/receipts/", headers=h, json=body1)
    assert r1.status_code in (200, 201), r1.text

    subs1 = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": m1["id"]}).json()["data"]
    assert len(subs1) == 1
    assert subs1[0]["delivery_status"] == "ACTIVE"
    assert subs1[0]["address_override"] == custom_addr

    # 2. Manual allocation via POST /receipts/{id}/allocate
    s2 = _sfx()
    m2 = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"RecAssign2{s2}",
        "mobile": "94" + s2.zfill(8),
        "magazine_needed": True,
        "magazine_delivery_address": f"Address 2 {s2}",
    }).json()
    _approve_member(client, h, m2["id"])

    body2 = _entry_payload(f"RC2-{s2}", "Manual Payer", payment_mode="CASH", allocations=[])
    r2 = client.post(f"{API}/receipts/", headers=h, json=body2).json()

    alloc_res = client.post(f"{API}/receipts/{r2['id']}/allocate", headers=h, json={
        "member_id": m2["id"],
        "allocated_amount": 500,
    })
    assert alloc_res.status_code in (200, 201), alloc_res.text

    subs2 = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": m2["id"]}).json()["data"]
    assert len(subs2) == 1
    assert subs2[0]["delivery_status"] == "ACTIVE"
    assert subs2[0]["address_override"] == f"Address 2 {s2}"

    # 3. Bulk allocation via POST /receipts/bulk-allocate
    s3 = _sfx()
    m3 = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"RecAssign3{s3}",
        "mobile": "94" + s3.zfill(8),
        "magazine_needed": True,
        "magazine_delivery_address": f"Address 3 {s3}",
    }).json()
    _approve_member(client, h, m3["id"])

    body3 = _entry_payload(f"RC3-{s3}", "Bulk Payer", payment_mode="CASH", allocations=[])
    r3 = client.post(f"{API}/receipts/", headers=h, json=body3).json()

    bulk_res = client.post(f"{API}/receipts/bulk-allocate", headers=h, json={
        "allocations": [{"receipt_id": r3["id"], "member_id": m3["id"], "allocated_amount": 500}]
    })
    assert bulk_res.status_code == 200, bulk_res.text
    assert bulk_res.json()["allocated_count"] == 1

    subs3 = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": m3["id"]}).json()["data"]
    assert len(subs3) == 1
    assert subs3[0]["delivery_status"] == "ACTIVE"


def test_unsubscribed_paid_members_and_backfill(client, admin_headers):
    h, s = admin_headers, _sfx()
    # Create member with magazine_needed=True and a receipt allocation directly on database or simulate
    m = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"Backfill{s}",
        "mobile": "94" + s.zfill(8),
        "magazine_needed": True,
        "magazine_delivery_address": f"Backfill Addr {s}",
    }).json()
    _approve_member(client, h, m["id"])

    # Pay a receipt for this member
    body = _entry_payload(f"BF-{s}", "BF Payer", payment_mode="CASH",
                          allocations=[{"member_id": m["id"], "allocated_amount": 600}])
    client.post(f"{API}/receipts/", headers=h, json=body)

    # Now member has subscription because of receipt assignment. Delete the subscription to simulate legacy member!
    subs = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": m["id"]}).json()["data"]
    assert len(subs) == 1
    from db.session import SessionLocal
    from models.magazines import MagazineSubscription
    with SessionLocal() as db:   # deleting it through the API would also switch the member's Yes off, so remove the row itself
        db.query(MagazineSubscription).filter(MagazineSubscription.id == subs[0]["id"]).update({"is_deleted": True})
        db.commit()

    # Now verify GET /magazines/unsubscribed-paid-members finds this member
    unsub = client.get(f"{API}/magazines/unsubscribed-paid-members", headers=h, params={"limit": 200}).json()
    unsub_mids = [u["member_id"] for u in unsub["data"]]
    assert m["id"] in unsub_mids and unsub["total"] >= 1 and unsub["limit"] == 200
    # the list is paged and searchable on the server: a page of one still reports the whole total
    one = client.get(f"{API}/magazines/unsubscribed-paid-members", headers=h, params={"limit": 1}).json()
    assert len(one["data"]) == 1 and one["total"] == unsub["total"]

    # Run backfill
    bf_res = client.post(f"{API}/magazines/backfill-subscriptions", headers=h, json={
        "member_ids": [m["id"]]
    })
    assert bf_res.status_code == 200, bf_res.text
    assert bf_res.json()["created_count"] == 1

    # Verify subscription is now active again
    subs_after = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": m["id"]}).json()["data"]
    assert len(subs_after) == 1
    assert subs_after[0]["delivery_status"] == "ACTIVE"


def test_all_recipients_and_labels_paid_filtering(client, admin_headers):
    h, s = admin_headers, _sfx()

    # Create an affiliation, associate, and press with magazine enabled
    aff = client.post(f"{API}/engagements/affiliations", headers=h, json={
        "group_name": f"Affiliate {s}",
        "contact_person": "Secretary",
        "contact_number": "9800000001",
        "address": "Affiliate Bhavan, Sirsi",
        "magazine_enabled": True,
    }).json()

    assoc = client.post(f"{API}/engagements/associates", headers=h, json={
        "name": f"Associate {s}",
        "organization": "Trust",
        "mobile": "9800000002",
        "address": "Trust Office, Yellapur",
        "magazine_enabled": True,
    }).json()

    press = client.post(f"{API}/engagements/press-media", headers=h, json={
        "organization_name": f"Press Daily {s}",
        "reporter_name": "Editor",
        "mobile": "9800000003",
        "address": "Press Enclave, Karwar",
        "magazine_enabled": True,
    }).json()

    # Create a paid member with active subscription
    m_paid = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"Paid{s}",
        "mobile": "94" + s.zfill(8),
        "magazine_needed": True,
        "address_line1": "Paid Street 1",
    }).json()
    _approve_member(client, h, m_paid["id"])
    client.post(f"{API}/receipts/", headers=h, json=_entry_payload(
        f"LBL-{s}", "Paid Member", payment_mode="CASH", allocations=[{"member_id": m_paid["id"], "allocated_amount": 500}]
    ))

    # Test GET /magazines/all-recipients
    recipients = client.get(f"{API}/magazines/all-recipients", headers=h).json()
    types = {r["recipient_type"] for r in recipients}
    assert "MEMBER" in types
    assert "AFFILIATION" in types
    assert "ASSOCIATE" in types
    assert "PRESS" in types

    # Test generate labels with only_paid=True
    gen = client.post(f"{API}/magazines/generate-labels", headers=h, params={
        "issue_month_year": "2026-07",
        "only_paid": True,
        "force": True,
    })
    assert gen.status_code == 200, gen.text
    batch_id = gen.json()["batch_id"]
    batch_items = client.get(f"{API}/magazines/label-batches/{batch_id}", headers=h).json()["data"]

    # Verify member and non-members are in the generated batch
    batch_recip_types = {item["recipient_type"] for item in batch_items}
    assert "MEMBER" in batch_recip_types
    assert "AFFILIATION" in batch_recip_types
    assert "ASSOCIATE" in batch_recip_types
    assert "PRESS" in batch_recip_types


def _register(client, h, s, approve=False, **extra):
    res = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"MagKind{s}", "mobile": "93" + s.zfill(8), "magazine_needed": True, **extra,
    })
    if approve and res.status_code in (200, 201):
        _approve_member(client, h, res.json()["id"])
    return res


def test_yes_puts_the_member_on_the_subscription_with_the_kind(client, admin_headers):
    h, s = admin_headers, _sfx()
    res = _register(client, h, s, magazine_kind="EMAIL", magazine_email="reader@example.com")
    assert res.status_code in (200, 201), res.text
    mid = res.json()["id"]
    m = client.get(f"{API}/members/{mid}", headers=h).json()
    assert (m["magazine_kind"], m["magazine_email"]) == ("EMAIL", None)    # the magazine needs no email: a typed one is not kept
    assert client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"] == []  # not before approval
    _approve_member(client, h, mid)
    subs = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"]
    assert len(subs) == 1 and subs[0]["delivery_status"] == "ACTIVE"
    prof = client.get(f"{API}/members/{mid}/profile/magazine", headers=h).json()
    assert prof["magazine_kind"] == "EMAIL" and "magazine_email" not in prof


def test_a_physical_copy_is_the_default_and_needs_no_email(client, admin_headers):
    h, s = admin_headers, _sfx()
    res = _register(client, h, s)
    assert res.status_code in (200, 201), res.text
    m = client.get(f"{API}/members/{res.json()['id']}", headers=h).json()
    assert m["magazine_kind"] == "PHYSICAL" and m["magazine_email"] is None


def test_an_e_copy_has_no_address_and_the_email_is_optional(client, admin_headers):
    h, s = admin_headers, _sfx()
    plain = _register(client, h, s, magazine_kind="EMAIL")      # read online: no email needed
    assert plain.status_code in (200, 201), plain.text
    s = _sfx()
    bad = _register(client, h, s, magazine_kind="PAPER")
    assert bad.status_code == 400
    ok = _register(client, h, s, magazine_kind="EMAIL", magazine_email="e@example.com", magazine_delivery_address="Ignored St")
    assert ok.status_code in (200, 201), ok.text
    m = client.get(f"{API}/members/{ok.json()['id']}", headers=h).json()
    assert m["magazine_kind"] == "EMAIL" and m["magazine_delivery_address"] is None


def _label_members(client, h, batch_id):
    body = client.get(f"{API}/magazines/label-batches/{batch_id}", headers=h).json()
    return [i["recipient_id"] for i in body["data"] if i["recipient_type"] == "MEMBER"]


def test_an_e_copy_member_gets_no_posted_label(client, admin_headers):
    h, s = admin_headers, _sfx()
    mid = _register(client, h, s, approve=True, magazine_kind="EMAIL", magazine_email="e@example.com").json()["id"]
    labels = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": "2026-07", "only_paid": False, "force": True})
    assert labels.status_code in (200, 201), labels.text
    assert mid not in _label_members(client, h, labels.json()["batch_id"])
    # switching the same member to a posted copy puts them on the next list
    assert client.put(f"{API}/members/{mid}", headers=h, json={"magazine_kind": "PHYSICAL"}).status_code == 200
    again = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": "2026-08", "only_paid": False, "force": True})
    assert mid in _label_members(client, h, again.json()["batch_id"])


def test_the_profile_lists_the_members_pauses(client, admin_headers):
    h, s = admin_headers, _sfx()
    mid = _register(client, h, s, approve=True, magazine_kind="PHYSICAL").json()["id"]
    sub = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"][0]
    made = client.post(f"{API}/magazines/pauses", headers=h, json={
        "subscription_id": sub["id"], "pause_start_date": "2026-10-01", "pause_end_date": None, "reason": "returned twice",
    })
    assert made.status_code in (200, 201), made.text
    prof = client.get(f"{API}/members/{mid}/profile/magazine", headers=h).json()
    assert [p["reason"] for p in prof["pauses"]] == ["returned twice"]
    assert prof["pauses"][0]["pause_end_date"] is None


def test_printing_the_labels_sends_the_issue(client, admin_headers):
    """Printing is sending: the batch is Sent on the print day, the issue shows S at once, and a return can be marked straight away."""
    h, s = admin_headers, _sfx()
    mid = _register(client, h, s, approve=True, magazine_kind="PHYSICAL").json()["id"]
    sub = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"][0]
    year = 1990 + int(s) % 9      # a year no other test uses, so older batches cannot interfere
    issue = f"{year}-05"
    made = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": issue, "only_paid": False, "force": True})
    assert made.status_code in (200, 201), made.text
    batch_id = made.json()["batch_id"]
    row = {b["id"]: b for b in client.get(f"{API}/magazines/label-batches", headers=h, params={"limit": 200}).json()["data"]}[batch_id]
    assert row["status"] == "SENT" and row["sent_date"] == date.today().isoformat()

    def may():
        grid = client.get(f"{API}/magazines/subscriptions/{sub['id']}/monthly", headers=h, params={"year": year}).json()
        return grid["months"][4]

    assert may()["mark"] == "S" and may()["sent"] is True          # printed = sent, no second step
    # the same filters again is refused unless forced; a cancelled batch no longer counts
    again = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": issue, "only_paid": False})
    assert again.status_code == 409 and "already exists" in again.json()["detail"]
    forced = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": issue, "only_paid": False, "force": True})
    assert forced.status_code == 200
    assert client.post(f"{API}/magazines/label-batches/{forced.json()['batch_id']}/cancel", headers=h).json()["status"] == "CANCELLED"
    # a return wins over the send, and once one is marked the batch cannot be cancelled
    assert client.post(f"{API}/magazines/returns", headers=h, json={
        "subscription_id": sub["id"], "issue_month_year": issue, "return_date": f"{year}-05-20",
    }).status_code in (200, 201)
    assert may()["mark"] == "R"
    assert client.post(f"{API}/magazines/label-batches/{batch_id}/cancel", headers=h).status_code == 409


def test_cancelling_a_wrong_print_and_correcting_the_posted_date(client, admin_headers):
    h, s = admin_headers, _sfx()
    _register(client, h, s, approve=True, magazine_kind="PHYSICAL")
    issue = f"{1960 + int(s) % 9}-02"
    batch_id = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": issue, "only_paid": False, "force": True}).json()["batch_id"]
    assert client.post(f"{API}/magazines/label-batches/{batch_id}/send", headers=h, params={"sent_date": "2999-01-01"}).status_code == 400   # not in the future
    fixed = client.post(f"{API}/magazines/label-batches/{batch_id}/send", headers=h, params={"sent_date": "2020-02-06"})
    assert fixed.status_code == 200 and fixed.json()["status"] == "SENT" and fixed.json()["sent_date"] == "2020-02-06"   # posted on another day
    assert client.post(f"{API}/magazines/label-batches/{batch_id}/undo-send", headers=h).status_code in (404, 405)       # there is no such step now
    cancelled = client.post(f"{API}/magazines/label-batches/{batch_id}/cancel", headers=h, params={"reason": "printed for the wrong taluk"})
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"
    assert cancelled.json()["cancel_reason"] == "printed for the wrong taluk"
    assert client.post(f"{API}/magazines/label-batches/{batch_id}/send", headers=h).status_code == 409   # a cancelled batch cannot be changed
    assert client.post(f"{API}/magazines/label-batches/{batch_id}/cancel", headers=h).status_code == 409
    listed = {b["id"]: b for b in client.get(f"{API}/magazines/label-batches", headers=h, params={"limit": 200}).json()["data"]}
    assert listed[batch_id]["status"] == "CANCELLED"


def test_an_applicant_is_on_the_list_once_a_receipt_is_assigned_and_leaves_when_rejected(client, admin_headers):
    """An unapproved applicant gets the magazine from the day a receipt is assigned to them (not before, not after a rejection)."""
    h, s = admin_headers, _sfx()
    mid = _register(client, h, s, magazine_kind="PHYSICAL").json()["id"]
    subs_url, year = f"{API}/magazines/subscriptions", 1970 + int(s) % 9
    assert client.get(subs_url, headers=h, params={"member_id": mid}).json()["data"] == []   # no receipt yet: nothing
    body = _entry_payload(f"UNAP-{s}", "Applicant Payer", payment_mode="CASH", allocations=[{"member_id": mid, "allocated_amount": 500}])
    assert client.post(f"{API}/receipts/", headers=h, json=body).status_code in (200, 201)
    subs = client.get(subs_url, headers=h, params={"member_id": mid}).json()["data"]
    assert len(subs) == 1 and subs[0]["delivery_status"] == "ACTIVE"          # the receipt started it, approved or not
    gen = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": f"{year}-06", "force": True}).json()
    labelled = {i["recipient_id"] for i in client.get(f"{API}/magazines/label-batches/{gen['batch_id']}", headers=h).json()["data"] if i["recipient_type"] == "MEMBER"}
    assert mid in labelled                                                      # and the label list carries the applicant
    rej = client.put(f"{API}/members/{mid}/reject", headers=h, params={"reason": "not agreed"})
    assert rej.status_code == 200, rej.text
    assert client.get(subs_url, headers=h, params={"member_id": mid}).json()["data"][0]["delivery_status"] == "STOPPED"   # rejected: off the list


def test_an_approved_member_can_stop_and_start_the_magazine(client, admin_headers):
    h, s = admin_headers, _sfx()
    mid = _register(client, h, s, magazine_kind="PHYSICAL").json()["id"]
    body = _entry_payload(f"UNAP2-{s}", "Applicant Payer", payment_mode="CASH", allocations=[{"member_id": mid, "allocated_amount": 500}])
    assert client.post(f"{API}/receipts/", headers=h, json=body).status_code in (200, 201)
    _approve_member(client, h, mid)
    subs = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"]
    assert len(subs) == 1 and subs[0]["delivery_status"] == "ACTIVE"
    # stopping it on the Magazine page switches the member's Yes off, and a later edit does not bring it back
    assert client.put(f"{API}/magazines/subscriptions/{subs[0]['id']}", headers=h, json={"delivery_status": "STOPPED"}).status_code == 200
    assert client.get(f"{API}/members/{mid}", headers=h).json()["magazine_needed"] is False
    assert client.put(f"{API}/members/{mid}", headers=h, json={"magazine_delivery_address": "New Address"}).status_code == 200
    assert client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"][0]["delivery_status"] == "STOPPED"
    assert client.put(f"{API}/magazines/subscriptions/{subs[0]['id']}", headers=h, json={"delivery_status": "CANCELLED"}).status_code == 400   # merged into Stopped
    assert client.put(f"{API}/magazines/subscriptions/{subs[0]['id']}", headers=h, json={"delivery_status": "ACTIVE"}).status_code == 200
    assert client.get(f"{API}/members/{mid}", headers=h).json()["magazine_needed"] is True


def test_a_district_run_has_no_affiliates_and_labels_print_in_postal_order(client, admin_headers):
    """Affiliations, associates and press join a full run only; the labels come in district, taluk, pincode order."""
    h, s = admin_headers, _sfx()
    year = 1960 + int(s) % 9
    full = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": f"{year}-02", "force": True}).json()
    types_full = {i["recipient_type"] for i in client.get(f"{API}/magazines/label-batches/{full['batch_id']}", headers=h).json()["data"]}
    part = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": f"{year}-03", "state_id": 987654, "force": True}).json()
    types_part = {i["recipient_type"] for i in client.get(f"{API}/magazines/label-batches/{part['batch_id']}", headers=h).json()["data"]}
    assert not (types_part & {"AFFILIATION", "ASSOCIATE", "PRESS"}), types_part
    assert full["total_labels"] >= part["total_labels"]


def test_postal_order_sorts_by_district_taluk_pincode_then_name(client):
    from types import SimpleNamespace as N
    from db.session import SessionLocal
    from models.masters import District, State, Taluk
    from api.v1.endpoints.magazines import _in_postal_order

    db = SessionLocal()
    try:
        st = State(name_en="PostalSt" + _sfx()[-4:], code="PS" + _sfx()[-4:], status=True)
        db.add(st)
        db.flush()
        da, dz = District(name_en="Adistrict" + _sfx()[-4:], state_id=st.id, status=True), District(name_en="Zdistrict" + _sfx()[-4:], state_id=st.id, status=True)
        db.add_all([da, dz])
        db.flush()
        rows = [(None, N(district_id=dz.id, taluk_id=None, pincode_id=None, full_name_en="Zed")),
                (None, N(district_id=da.id, taluk_id=None, pincode_id=None, full_name_en="Bee")),
                (None, N(district_id=da.id, taluk_id=None, pincode_id=None, full_name_en="Ant")),
                (None, N(district_id=None, taluk_id=None, pincode_id=None, full_name_en="No place"))]
        assert [m.full_name_en for _s, m in _in_postal_order(db, rows)] == ["Ant", "Bee", "Zed", "No place"]
    finally:
        db.rollback()
        db.close()


def test_the_delivery_history_lists_each_issue(client, admin_headers):
    h, s = admin_headers, _sfx()
    mid = _register(client, h, s, approve=True, magazine_kind="PHYSICAL").json()["id"]
    sub = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"][0]
    year = 1980 + int(s) % 9
    made = {}
    for month in (3, 4, 5):
        gen = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": f"{year}-{month:02d}", "only_paid": False, "force": True})
        assert gen.status_code in (200, 201)
        made[month] = gen.json()["batch_id"]
    _send_label_batch(client, h, made[3], f"{year}-03-04")
    _send_label_batch(client, h, made[4], f"{year}-04-04")
    assert client.post(f"{API}/magazines/returns", headers=h, json={
        "subscription_id": sub["id"], "issue_month_year": f"{year}-04", "return_date": f"{year}-04-20", "return_reason": "address wrong"}).status_code in (200, 201)
    got = client.get(f"{API}/magazines/subscriptions/{sub['id']}/history", headers=h).json()["issues"]
    by_issue = {i["issue_month_year"]: i for i in got if i["issue_month_year"].startswith(str(year))}
    assert by_issue[f"{year}-03"]["result"] == "SENT"
    assert by_issue[f"{year}-04"]["result"] == "RETURNED" and by_issue[f"{year}-04"]["detail"] == "address wrong"
    assert by_issue[f"{year}-05"]["result"] == "SENT"          # printed is sent: no issue waits as "listed" any more
    assert [i["issue_month_year"] for i in got] == sorted((i["issue_month_year"] for i in got), reverse=True)
    prof = client.get(f"{API}/members/{mid}/profile/magazine", headers=h).json()
    assert {i["issue_month_year"] for i in prof["issues"]} >= {f"{year}-03", f"{year}-04", f"{year}-05"}


def test_the_summary_lists_the_top_districts(client, admin_headers):
    body = client.get(f"{API}/reports/summary", headers=admin_headers).json()
    top = body["members"]["top_districts"]
    assert isinstance(top, list) and len(top) <= 5
    assert all({"name", "count"} <= set(row) for row in top)
    assert [r["count"] for r in top] == sorted((r["count"] for r in top), reverse=True)


def test_recipients_are_paged_with_their_subscription_pause_and_returns(client, admin_headers):
    h, s = admin_headers, _sfx()
    mid = _register(client, h, s, approve=True, magazine_kind="PHYSICAL").json()["id"]
    sub = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"][0]
    gen = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": "2031-02", "only_paid": False, "force": True})
    _send_label_batch(client, h, gen.json()["batch_id"])
    assert client.post(f"{API}/magazines/returns", headers=h, json={
        "subscription_id": sub["id"], "issue_month_year": "2031-02", "return_date": "2031-02-20",
    }).status_code in (200, 201)

    page = client.get(f"{API}/magazines/recipients", headers=h, params={"limit": 5000, "page": 1}).json()
    assert page["limit"] == 200                                   # never more than 200 in one request
    assert {"total", "active", "paused", "stopped"} <= set(page["summary"])
    row = next(r for r in client.get(f"{API}/magazines/recipients", headers=h, params={"type": "MEMBER", "recipient_type": "MEMBER", "limit": 200}).json()["data"]
               if r["recipient_id"] == mid)
    assert row["subscription"]["id"] == sub["id"] and row["return_count"] == 1 and row["active_pause"] is None

    # the filters run on every recipient, not on a page
    returned = client.get(f"{API}/magazines/recipients", headers=h, params={"with_returns": True, "limit": 200}).json()
    assert mid in [r["recipient_id"] for r in returned["data"]] and all(r["return_count"] >= 1 for r in returned["data"])
    assert client.get(f"{API}/magazines/recipients", headers=h, params={"search": "zzz-nobody-zzz"}).json()["total"] == 0
    # a page really is a slice
    two = client.get(f"{API}/magazines/recipients", headers=h, params={"limit": 1, "page": 2}).json()
    assert len(two["data"]) <= 1 and two["total"] >= 1 and two["pages"] == two["total"]
    # the lists the screen reads next are capped as well
    for path in ("subscriptions", "pauses", "returns", "label-batches", "delivery-batches"):  # the old delivery batches stay readable
        assert client.get(f"{API}/magazines/{path}", headers=h, params={"limit": 5000}).json()["limit"] == 200, path


def test_inactive_member_is_never_listed_or_started(client, admin_headers):
    """An expired or deleted (inactive) member never gets a subscription started: not listed to be started, and not started by the backfill either."""
    h, s = admin_headers, _sfx()
    m = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"Inactive{s}", "mobile": "93" + s.zfill(8), "magazine_needed": True, "magazine_delivery_address": f"Inactive Addr {s}",
    }).json()
    _approve_member(client, h, m["id"])
    body = _entry_payload(f"IN-{s}", "IN Payer", payment_mode="CASH", allocations=[{"member_id": m["id"], "allocated_amount": 600}])
    client.post(f"{API}/receipts/", headers=h, json=body)
    from db.session import SessionLocal
    from models.magazines import MagazineSubscription
    from models.members import Member
    with SessionLocal() as db:       # the member expires in the old register; their subscription row is gone
        db.query(Member).filter(Member.id == m["id"]).update({"member_status": "INACTIVE"})
        db.query(MagazineSubscription).filter(MagazineSubscription.member_id == m["id"]).update({"is_deleted": True})
        db.commit()
    unsub = client.get(f"{API}/magazines/unsubscribed-paid-members", headers=h, params={"limit": 200}).json()
    assert m["id"] not in [u["member_id"] for u in unsub["data"]]
    bf = client.post(f"{API}/magazines/backfill-subscriptions", headers=h, json={"member_ids": [m["id"]]})
    assert bf.status_code == 200 and bf.json()["created_count"] == 0
    assert client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": m["id"]}).json()["data"] == []


def test_nobody_can_start_the_magazine_for_an_inactive_member(client, admin_headers):
    """Not even by hand: starting a subscription for an expired or deleted (inactive) member is refused."""
    h, s = admin_headers, _sfx()
    m = client.post(f"{API}/members/", headers=h, json={"first_name_en": f"InactiveHand{s}", "mobile": "92" + s.zfill(8), "magazine_needed": True}).json()
    from db.session import SessionLocal
    from models.members import Member
    with SessionLocal() as db:
        db.query(Member).filter(Member.id == m["id"]).update({"member_status": "INACTIVE"})
        db.commit()
    made = client.post(f"{API}/magazines/subscriptions", headers=h, json={"member_id": m["id"], "delivery_status": "ACTIVE"})
    assert made.status_code == 400 and "expired or deleted" in made.text


def test_recipients_list_groups_and_filters(client, admin_headers):
    """The recipients list: approved members, applicants (paid or not), affiliations ...; filters for copy, status, place and receipt."""
    h, s = admin_headers, _sfx()
    applicant = _register(client, h, s, magazine_kind="PHYSICAL").json()["id"]            # said Yes, not approved, no receipt
    online = _register(client, h, s + "9", approve=True, magazine_kind="EMAIL").json()["id"]

    def listed(**p):
        r = client.get(f"{API}/magazines/recipients", headers=h, params={"limit": 200, **p})
        assert r.status_code == 200, r.text
        return {(x["recipient_type"], x["recipient_id"]): x for x in r.json()["data"]}, r.json()["summary"]

    app_rows, _ = listed(recipient_type="APPLICANT")
    assert ("APPLICANT", applicant) in app_rows and app_rows[("APPLICANT", applicant)]["delivery_status"] == "NOT_STARTED"
    assert app_rows[("APPLICANT", applicant)]["has_receipt"] is False
    assert ("MEMBER", applicant) not in listed(recipient_type="MEMBER")[0]
    body = _entry_payload(f"GRP-{s}", "Group Payer", payment_mode="CASH", allocations=[{"member_id": applicant, "allocated_amount": 500}])
    assert client.post(f"{API}/receipts/", headers=h, json=body).status_code in (200, 201)
    paid_rows, summary = listed(recipient_type="APPLICANT", receipt="PAID")
    assert paid_rows[("APPLICANT", applicant)]["delivery_status"] == "ACTIVE" and paid_rows[("APPLICANT", applicant)]["has_receipt"] is True
    assert ("APPLICANT", applicant) not in listed(recipient_type="APPLICANT", receipt="NO_RECEIPT")[0]
    online_rows, _ = listed(copy="ONLINE")
    assert ("MEMBER", online) in online_rows and ("APPLICANT", applicant) not in online_rows
    assert all(k[0] in ("MEMBER", "APPLICANT") for k in online_rows), "an online filter lists people only"
    printed_rows, _ = listed(copy="PRINTED")
    assert ("MEMBER", online) not in printed_rows
    assert {"total", "active", "paused", "stopped", "not_started"} <= set(summary)
    assert listed(district_id=987654)[0] == {}, "a place filter with no one in it lists nobody, not the affiliations"
